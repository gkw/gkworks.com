# GK Works Website Development Instructions

This document records the working direction used for the GK Works, Inc. website rebuild.

## Audience

The website is prepared for external business review, including Japanese banking review workflows. Public website content should remain in English so that any translation is handled by the reviewing party's tools.

## Content Direction

- Present GK Works, Inc. as a California Corporation since 2012.
- Emphasize AI-first software consulting.
- Focus on AI integrations, AI automations, Security Consulting, scalable architecture, Linux server systems, secure local LLM deployments, AI-assisted legacy refactoring, and AI-enhanced practical business systems.
- Include mobile application development and embedded systems capability.
- Avoid naming internal application products on the public site.
- Keep claims practical, professional, and suitable for bank review.
- Avoid guarantees for cost reductions; present cost graphics as illustrative planning examples only.

## Design Direction

- Keep the visual style clean, modern, and infrastructure-focused.
- Use an orange-accented, Cloudflare-inspired visual direction without copying proprietary assets.
- Use the original background image as part of the site identity.
- Keep headings in title case where appropriate.
- Keep the first viewport readable and avoid overlapping hero content, buttons, and service cards.

## Privacy And Public Content

- Do not publish the company street address as crawlable text.
- The company location is displayed through `static/assets/location.png`.
- Do not place the street address in public Markdown, HTML, templates, or README files.
- Do not expose notification email credentials in the repository.

## Public Markdown

- The top navigation includes a single `Markdown File` link.
- The public Markdown page is `docs/company-information.md`.
- This file summarizes the company profile, services, AI enhancement model, technologies, location image, website, and contact process.

## Contact Form

- Contact submissions are saved as JSON Lines for operational backup.
- Flask/Docker path: `/app/instance/contact_submissions.jsonl`.
- Production PHP compatibility path: `/var/www/html/instance/contact_submissions.jsonl`.
- Production email notifications are sent through Gmail SMTP when `/etc/gkworks-contact-mail.ini` is present and readable by the web server user.
- Gmail SMTP credentials must be configured with a Google App Password, not a regular Google account password.
- Future Cloudflare Worker contact forms can call `POST /api/contact-notification.php` with a Bearer token.
- The notification API sends through Gmail SMTP and stores backup records in `/var/www/html/instance/contact_api_notifications.jsonl`.
- API management is available through `GET /api/management.php` with the same Bearer token.
- New Cloudflare Worker support APIs should be registered in `api/api-catalog.php` and should reuse `api/lib/api-common.php`.
- The Docker/Flask deployment mirrors the same API paths for local and container verification.

## Production Notes

- The live server currently uses a PHP compatibility deployment under `/var/www/html`.
- The repository keeps the Flask/Docker implementation as the maintainable application source.
- The helper script `scripts/setup-gmail-smtp.sh` configures `/etc/gkworks-contact-mail.ini` on the production server.
- The same config file also stores `notify_to` and `notify_api_token` for the authenticated notification API.
- The production helper `/root/api-management.sh` can list registered APIs, show redacted recent notification logs, and send a test notification.
- SMTP config ownership should allow the web runtime to read it while keeping it private:

```text
root:www-data 640 /etc/gkworks-contact-mail.ini
```

## Verification Checklist

- Public pages are English-only.
- Contact form returns success redirect after valid POST.
- Latest contact submission appears in JSONL storage.
- Gmail SMTP authentication succeeds.
- Production mail queue remains empty after contact form testing.
- The Markdown File link opens `docs/company-information.md`.
- No crawlable street address appears in repository text.
