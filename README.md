# GK Works, Inc. Website

Python/Flask website and API backend for GK Works, Inc., California Corporation since 2012.

## Cloudflare Worker Branch

Cloudflare Workers development lives in:

```text
worker/
```

That version serves static assets from `worker/public`, handles the public contact form at `/contact`, and forwards notifications to the protected HTTP notification API backed by Gmail SMTP.

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

Cloudflare Worker style API notification submissions are stored at:

```text
/app/instance/contact_api_notifications.jsonl
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
CONTACT_NOTIFY_API_TOKEN=<strong-shared-token>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USE_TLS=1
SMTP_USERNAME=<gmail-address>
SMTP_PASSWORD=<google-app-password>
```

The Python API deployment reads SMTP settings from environment variables. The production helper can also write shared server settings to `/etc/gkworks-contact-mail.ini`:

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

## Python HTTP Email Notification API

The Python/Flask deployment includes an authenticated HTTP endpoint for Cloudflare Worker contact-form submissions:

```text
POST /api/contact-notification
Authorization: Bearer <notify_api_token>
Content-Type: application/json
```

Temporary compatibility alias:

```text
POST /api/contact-notification.php
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

The Docker/Flask deployment uses `CONTACT_NOTIFY_API_TOKEN` for the Bearer token:

```bash
curl -sS -X POST http://127.0.0.1:8099/api/contact-notification \
  -H "Authorization: Bearer dev-change-me" \
  -H "Content-Type: application/json" \
  -d '{"name":"Docker Test","email":"docker@example.com","message":"Hello","source":"docker"}'
```

## API Management

Protected API catalog and runtime checks are available at:

```text
GET /api/management
Authorization: Bearer <notify_api_token>
```

Temporary compatibility alias:

```text
GET /api/management.php
```

The historical PHP compatibility files are still under `api/` for the old VPS deployment path. New implementation work should go into `app.py`, the Worker under `worker/`, and Docker deployment files.

Use the helper on the production server:

```bash
/root/api-management.sh list
/root/api-management.sh logs
/root/api-management.sh test-notification
```

When adding APIs for Cloudflare Workers, add the Python endpoint in `app.py`, add the Worker route in `worker/src/index.ts`, and update the API catalogs in both places.

The Docker/Flask deployment exposes the management path:

```bash
curl -sS http://127.0.0.1:8099/api/management \
  -H "Authorization: Bearer dev-change-me"
```
