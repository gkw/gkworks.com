# GK Works, Inc. Website

Flask website for GK Works, Inc., California Corporation since 2012.

## Run With Docker

Build and run directly:

```bash
docker build -t gkworks-site:latest .
docker run --rm -p 8099:8099 -v gkworks_instance:/app/instance gkworks-site:latest
```

Or run with Docker Compose:

```bash
docker-compose up --build
```

Then open:

```text
http://127.0.0.1:8099/
```

Contact form submissions are stored at:

```text
/app/instance/contact_submissions.jsonl
```

When using Docker Compose, that path is backed by the `gkworks_instance` volume.

By default, contact notifications are addressed to:

```text
gen@gkworks.com
```

The server still stores every submission in JSONL as a backup. For reliable delivery through Gmail, use a Google App Password and configure authenticated SMTP with these environment variables:

```text
CONTACT_NOTIFY_EMAIL=gen@gkworks.com
CONTACT_FROM_EMAIL=<gmail-address>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USE_TLS=1
SMTP_USERNAME=<gmail-address>
SMTP_PASSWORD=<google-app-password>
```

The PHP compatibility deployment on `gkworks.com` reads SMTP settings from `/etc/gkworks-contact-mail.ini`:

```ini
smtp_host=smtp.gmail.com
smtp_port=587
smtp_username=<gmail-address>
smtp_password=<google-app-password>
smtp_from=<gmail-address>
```

The helper script can be uploaded to the production server and run as root:

```bash
/root/setup-gmail-smtp.sh genkikuroda@gmail.com
```

## HTTP Email Notification API

The production PHP compatibility deployment includes an authenticated HTTP endpoint for future Cloudflare Worker contact-form submissions:

```text
POST /api/contact-notification.php
Authorization: Bearer <notify_api_token>
Content-Type: application/json
```

Example payload:

```json
{
  "name": "Example Sender",
  "company": "Example Company",
  "email": "sender@example.com",
  "subject": "Website inquiry",
  "message": "Hello from the contact form",
  "source": "cloudflare-worker"
}
```

The endpoint sends notification email through the Gmail SMTP settings in `/etc/gkworks-contact-mail.ini` and stores backup records in:

```text
/var/www/html/instance/contact_api_notifications.jsonl
```
