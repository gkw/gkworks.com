<?php
declare(strict_types=1);

return [
    [
        'id' => 'contact-notification',
        'name' => 'Contact Notification API',
        'method' => 'POST',
        'path' => '/api/contact-notification.php',
        'auth' => 'Bearer notify_api_token',
        'status' => 'active',
        'consumer' => 'Cloudflare Worker contact form',
        'description' => 'Sends contact form notifications through the Gmail SMTP backend and stores a JSONL backup record.',
        'backup_log' => '/var/www/html/instance/contact_api_notifications.jsonl',
        'required_fields' => ['name', 'email', 'message'],
        'optional_fields' => ['company', 'subject', 'source'],
    ],
    [
        'id' => 'api-management',
        'name' => 'API Management API',
        'method' => 'GET',
        'path' => '/api/management.php',
        'auth' => 'Bearer notify_api_token',
        'status' => 'active',
        'consumer' => 'Operations and deployment checks',
        'description' => 'Returns the protected API catalog and runtime configuration health without exposing secrets.',
        'backup_log' => null,
        'required_fields' => [],
        'optional_fields' => ['include_logs'],
    ],
];
