<?php
declare(strict_types=1);

require __DIR__ . '/lib/api-common.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    api_json_response(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

$config = api_read_config();
api_require_auth($config);
$payload = api_read_json_payload();

$name = api_clean_string($payload['name'] ?? '', 120);
$company = api_clean_string($payload['company'] ?? '', 160);
$email = api_clean_string($payload['email'] ?? '', 180);
$subject = api_clean_string($payload['subject'] ?? '', 180);
$message = api_clean_string($payload['message'] ?? '', 5000);
$source = api_clean_string($payload['source'] ?? 'cloudflare-worker', 80);

if ($name === '' || $message === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    api_json_response(422, ['ok' => false, 'error' => 'validation_failed']);
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

api_append_jsonl('contact_api_notifications.jsonl', $record);

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
    api_smtp_send($config, $notifyTo, $mailSubject, $mailBody, $email);
} catch (Throwable $exc) {
    error_log('GK Works notification API SMTP failed: ' . $exc->getMessage());
    api_json_response(502, ['ok' => false, 'error' => 'notification_failed']);
}

api_json_response(200, ['ok' => true]);
