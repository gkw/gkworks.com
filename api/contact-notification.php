<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=UTF-8');

function json_response(int $status, array $payload): void {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES) . "\n";
    exit;
}

function read_config(): array {
    $path = '/etc/gkworks-contact-mail.ini';
    if (!is_readable($path)) {
        json_response(500, ['ok' => false, 'error' => 'mail_config_unavailable']);
    }

    $config = parse_ini_file($path);
    if (!is_array($config)) {
        json_response(500, ['ok' => false, 'error' => 'mail_config_invalid']);
    }

    return $config;
}

function bearer_token(): string {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if ($header === '' && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        $header = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    }

    if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
        return '';
    }

    return trim($matches[1]);
}

function smtp_expect($socket, array $codes): string {
    $response = '';
    while (($line = fgets($socket, 515)) !== false) {
        $response .= $line;
        if (strlen($line) >= 4 && $line[3] === ' ') {
            break;
        }
    }

    $code = substr($response, 0, 3);
    if (!in_array($code, $codes, true)) {
        throw new RuntimeException('SMTP error: ' . trim($response));
    }

    return $response;
}

function smtp_command($socket, string $command, array $codes): string {
    fwrite($socket, $command . "\r\n");
    return smtp_expect($socket, $codes);
}

function smtp_send(array $config, string $to, string $subject, string $body, string $replyTo): bool {
    $host = $config['smtp_host'] ?? '';
    $port = (int)($config['smtp_port'] ?? 587);
    $username = $config['smtp_username'] ?? '';
    $password = $config['smtp_password'] ?? '';
    $from = $config['smtp_from'] ?? $username;

    if ($host === '' || $username === '' || $password === '' || $from === '') {
        throw new RuntimeException('SMTP configuration is incomplete');
    }

    $socket = stream_socket_client('tcp://' . $host . ':' . $port, $errno, $errstr, 15);
    if (!$socket) {
        throw new RuntimeException('SMTP connection failed: ' . $errstr);
    }
    stream_set_timeout($socket, 15);

    smtp_expect($socket, ['220']);
    smtp_command($socket, 'EHLO gkworks.com', ['250']);
    smtp_command($socket, 'STARTTLS', ['220']);
    if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
        throw new RuntimeException('SMTP TLS negotiation failed');
    }
    smtp_command($socket, 'EHLO gkworks.com', ['250']);
    smtp_command($socket, 'AUTH LOGIN', ['334']);
    smtp_command($socket, base64_encode($username), ['334']);
    smtp_command($socket, base64_encode($password), ['235']);
    smtp_command($socket, 'MAIL FROM:<' . $from . '>', ['250']);
    smtp_command($socket, 'RCPT TO:<' . $to . '>', ['250', '251']);
    smtp_command($socket, 'DATA', ['354']);

    $headers = [
        'From: ' . $from,
        'To: ' . $to,
        'Reply-To: ' . $replyTo,
        'Subject: ' . $subject,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
    ];
    $data = implode("\r\n", $headers) . "\r\n\r\n" . $body;
    $data = preg_replace('/^\./m', '..', str_replace(["\r\n", "\r"], "\n", $data));
    fwrite($socket, str_replace("\n", "\r\n", $data) . "\r\n.\r\n");
    smtp_expect($socket, ['250']);
    smtp_command($socket, 'QUIT', ['221']);
    fclose($socket);

    return true;
}

function clean_string($value, int $limit): string {
    if (!is_string($value)) {
        return '';
    }

    $value = trim(str_replace(["\r", "\0"], '', $value));
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $limit);
    }

    return substr($value, 0, $limit);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 20000) {
    json_response(413, ['ok' => false, 'error' => 'payload_too_large']);
}

$config = read_config();
$expectedToken = $config['notify_api_token'] ?? '';
if ($expectedToken === '' || !hash_equals($expectedToken, bearer_token())) {
    json_response(401, ['ok' => false, 'error' => 'unauthorized']);
}

$payload = json_decode(file_get_contents('php://input'), true);
if (!is_array($payload)) {
    json_response(400, ['ok' => false, 'error' => 'invalid_json']);
}

$name = clean_string($payload['name'] ?? '', 120);
$company = clean_string($payload['company'] ?? '', 160);
$email = clean_string($payload['email'] ?? '', 180);
$subject = clean_string($payload['subject'] ?? '', 180);
$message = clean_string($payload['message'] ?? '', 5000);
$source = clean_string($payload['source'] ?? 'cloudflare-worker', 80);

if ($name === '' || $message === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_response(422, ['ok' => false, 'error' => 'validation_failed']);
}

$record = [
    'received_at' => gmdate('c'),
    'source' => $source,
    'name' => $name,
    'company' => $company,
    'email' => $email,
    'subject' => $subject,
    'message' => $message,
    'remote_addr' => $_SERVER['REMOTE_ADDR'] ?? '',
];

$dir = dirname(__DIR__) . '/instance';
if (!is_dir($dir)) {
    mkdir($dir, 0750, true);
}
file_put_contents(
    $dir . '/contact_api_notifications.jsonl',
    json_encode($record, JSON_UNESCAPED_SLASHES) . PHP_EOL,
    FILE_APPEND | LOCK_EX
);

$notifyTo = $config['notify_to'] ?? 'gen@gkworks.com';
$mailSubject = 'GK Works inquiry: ' . ($subject !== '' ? $subject : 'Website inquiry');
$mailBody = implode("\n", [
    'New inquiry from gkworks.com',
    '',
    'Source: ' . $source,
    'Name: ' . $name,
    'Company: ' . $company,
    'Email: ' . $email,
    'Subject: ' . ($subject !== '' ? $subject : 'Website inquiry'),
    '',
    'Message:',
    $message,
]);

try {
    smtp_send($config, $notifyTo, $mailSubject, $mailBody, $email);
} catch (Throwable $exc) {
    error_log('GK Works notification API SMTP failed: ' . $exc->getMessage());
    json_response(502, ['ok' => false, 'error' => 'notification_failed']);
}

json_response(200, ['ok' => true]);
