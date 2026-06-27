<?php
declare(strict_types=1);

require __DIR__ . '/lib/api-common.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    api_json_response(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

$config = api_read_config();
api_require_auth($config);

$catalog = require __DIR__ . '/api-catalog.php';
$checks = [
    'config_readable' => is_readable('/etc/gkworks-contact-mail.ini'),
    'smtp_host_configured' => ($config['smtp_host'] ?? '') !== '',
    'smtp_username_configured' => ($config['smtp_username'] ?? '') !== '',
    'smtp_password_configured' => ($config['smtp_password'] ?? '') !== '',
    'smtp_from_configured' => ($config['smtp_from'] ?? '') !== '',
    'notify_to_configured' => ($config['notify_to'] ?? '') !== '',
    'notify_api_token_configured' => ($config['notify_api_token'] ?? '') !== '',
    'openssl_loaded' => extension_loaded('openssl'),
    'contact_api_log_exists' => file_exists(dirname(__DIR__) . '/instance/contact_api_notifications.jsonl'),
];

$recent = [];
if (($_GET['include_logs'] ?? '') === '1') {
    $logPath = dirname(__DIR__) . '/instance/contact_api_notifications.jsonl';
    if (is_readable($logPath)) {
        $lines = file($logPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (is_array($lines)) {
            foreach (array_slice($lines, -5) as $line) {
                $item = json_decode($line, true);
                if (is_array($item)) {
                    unset($item['message']);
                    $recent[] = $item;
                }
            }
        }
    }
}

api_json_response(200, [
    'ok' => true,
    'service' => 'gkworks-api-management',
    'generated_at' => gmdate('c'),
    'checks' => $checks,
    'apis' => $catalog,
    'recent_contact_notifications' => $recent,
]);
