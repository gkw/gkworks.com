<?php
declare(strict_types=1);

function api_json_response(int $status, array $payload): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES) . "\n";
    exit;
}

function api_read_config(): array {
    $path = '/etc/gkworks-contact-mail.ini';
    if (!is_readable($path)) {
        api_json_response(500, ['ok' => false, 'error' => 'mail_config_unavailable']);
    }

    $config = parse_ini_file($path);
    if (!is_array($config)) {
        api_json_response(500, ['ok' => false, 'error' => 'mail_config_invalid']);
    }

    return $config;
}

function api_bearer_token(): string {
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

function api_require_auth(array $config): void {
    $expectedToken = $config['notify_api_token'] ?? '';
    if ($expectedToken === '' || !hash_equals($expectedToken, api_bearer_token())) {
        api_json_response(401, ['ok' => false, 'error' => 'unauthorized']);
    }
}

function api_read_json_payload(int $maxBytes = 20000): array {
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > $maxBytes) {
        api_json_response(413, ['ok' => false, 'error' => 'payload_too_large']);
    }

    $payload = json_decode(file_get_contents('php://input'), true);
    if (!is_array($payload)) {
        api_json_response(400, ['ok' => false, 'error' => 'invalid_json']);
    }

    return $payload;
}

function api_clean_string($value, int $limit): string {
    if (!is_string($value)) {
        return '';
    }

    $value = trim(str_replace(["\r", "\0"], '', $value));
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $limit);
    }

    return substr($value, 0, $limit);
}

function api_append_jsonl(string $filename, array $record): void {
    $dir = dirname(__DIR__, 2) . '/instance';
    if (!is_dir($dir)) {
        mkdir($dir, 0750, true);
    }

    file_put_contents(
        $dir . '/' . $filename,
        json_encode($record, JSON_UNESCAPED_SLASHES) . PHP_EOL,
        FILE_APPEND | LOCK_EX
    );
}

function api_smtp_expect($socket, array $codes): string {
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

function api_smtp_command($socket, string $command, array $codes): string {
    fwrite($socket, $command . "\r\n");
    return api_smtp_expect($socket, $codes);
}

function api_smtp_send(array $config, string $to, string $subject, string $body, string $replyTo): bool {
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

    api_smtp_expect($socket, ['220']);
    api_smtp_command($socket, 'EHLO gkworks.com', ['250']);
    api_smtp_command($socket, 'STARTTLS', ['220']);
    if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
        throw new RuntimeException('SMTP TLS negotiation failed');
    }
    api_smtp_command($socket, 'EHLO gkworks.com', ['250']);
    api_smtp_command($socket, 'AUTH LOGIN', ['334']);
    api_smtp_command($socket, base64_encode($username), ['334']);
    api_smtp_command($socket, base64_encode($password), ['235']);
    api_smtp_command($socket, 'MAIL FROM:<' . $from . '>', ['250']);
    api_smtp_command($socket, 'RCPT TO:<' . $to . '>', ['250', '251']);
    api_smtp_command($socket, 'DATA', ['354']);

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
    api_smtp_expect($socket, ['250']);
    api_smtp_command($socket, 'QUIT', ['221']);
    fclose($socket);

    return true;
}
