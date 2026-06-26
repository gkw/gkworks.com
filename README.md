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

The server still stores every submission in JSONL as a backup. For reliable delivery to a hosted mailbox such as Zoho, configure authenticated SMTP with these environment variables:

```text
CONTACT_NOTIFY_EMAIL=gen@gkworks.com
CONTACT_FROM_EMAIL=gen@gkworks.com
SMTP_HOST=smtp.zoho.com
SMTP_PORT=587
SMTP_USE_TLS=1
SMTP_USERNAME=gen@gkworks.com
SMTP_PASSWORD=<app-password>
```
