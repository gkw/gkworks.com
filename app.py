from __future__ import annotations

import json
import os
import smtplib
import configparser
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

from flask import Flask, jsonify, redirect, render_template, request, send_from_directory, url_for


app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-change-in-production")

BASE_DIR = Path(__file__).resolve().parent
SERVER_MAIL_CONFIG_PATH = Path(os.environ.get("GKWORKS_MAIL_CONFIG_PATH", "/etc/gkworks-contact-mail.ini"))
SUBMISSIONS_PATH = Path(os.environ.get("CONTACT_SUBMISSIONS_PATH", BASE_DIR / "instance" / "contact_submissions.jsonl"))
API_NOTIFICATIONS_PATH = Path(
    os.environ.get("CONTACT_API_NOTIFICATIONS_PATH", BASE_DIR / "instance" / "contact_api_notifications.jsonl")
)


def read_server_mail_config() -> dict[str, str]:
    if not SERVER_MAIL_CONFIG_PATH.exists():
        return {}

    parser = configparser.ConfigParser()
    try:
        raw = SERVER_MAIL_CONFIG_PATH.read_text(encoding="utf-8")
        parser.read_string("[mail]\n" + raw)
    except OSError:
        return {}
    return dict(parser["mail"])


SERVER_MAIL_CONFIG = read_server_mail_config()


def config_value(env_name: str, ini_name: str, default: str = "") -> str:
    return os.environ.get(env_name) or SERVER_MAIL_CONFIG.get(ini_name, default)


CONTACT_NOTIFY_EMAIL = config_value("CONTACT_NOTIFY_EMAIL", "notify_to", "gen@gkworks.com")
CONTACT_FROM_EMAIL = config_value("CONTACT_FROM_EMAIL", "smtp_from", "gen@gkworks.com")
CONTACT_NOTIFY_API_TOKEN = config_value("CONTACT_NOTIFY_API_TOKEN", "notify_api_token")
SMTP_HOST = config_value("SMTP_HOST", "smtp_host", "localhost")
SMTP_PORT = int(config_value("SMTP_PORT", "smtp_port", "25"))
SMTP_USERNAME = config_value("SMTP_USERNAME", "smtp_username")
SMTP_PASSWORD = config_value("SMTP_PASSWORD", "smtp_password")
SMTP_USE_TLS = config_value("SMTP_USE_TLS", "smtp_use_tls", "1" if SMTP_PORT == 587 else "0") == "1"

API_CATALOG = [
    {
        "id": "contact-notification",
        "name": "Contact Notification API",
        "method": "POST",
        "path": "/api/contact-notification",
        "auth": "Bearer notify_api_token",
        "status": "active",
        "consumer": "Cloudflare Worker contact form",
        "description": "Sends contact form notifications through the configured SMTP backend and stores a JSONL backup record.",
        "backup_log": "/app/instance/contact_api_notifications.jsonl",
        "required_fields": ["name", "email", "message"],
        "optional_fields": ["company", "subject", "source"],
        "aliases": ["/api/contact-notification.php"],
    },
    {
        "id": "api-management",
        "name": "API Management API",
        "method": "GET",
        "path": "/api/management",
        "auth": "Bearer notify_api_token",
        "status": "active",
        "consumer": "Operations and deployment checks",
        "description": "Returns the protected API catalog and runtime configuration health without exposing secrets.",
        "backup_log": None,
        "required_fields": [],
        "optional_fields": ["include_logs"],
        "aliases": ["/api/management.php"],
    },
    {
        "id": "api-catalog",
        "name": "API Catalog",
        "method": "GET",
        "path": "/api/catalog",
        "auth": "public metadata",
        "status": "active",
        "consumer": "API management tooling",
        "description": "Returns public API metadata without operational logs or secrets.",
        "backup_log": None,
        "required_fields": [],
        "optional_fields": [],
    },
    {
        "id": "api-health",
        "name": "API Health",
        "method": "GET",
        "path": "/api/health",
        "auth": "public status",
        "status": "active",
        "consumer": "Monitoring and deployment checks",
        "description": "Returns non-sensitive runtime health for the Python API backend.",
        "backup_log": None,
        "required_fields": [],
        "optional_fields": [],
    },
]


def save_contact_submission(payload: dict[str, str]) -> None:
    append_jsonl(SUBMISSIONS_PATH, payload)


def append_jsonl(path: Path, payload: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "received_at": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    with path.open("a", encoding="utf-8") as fp:
        fp.write(json.dumps(record, ensure_ascii=True) + "\n")


def notify_contact_submission(payload: dict[str, str]) -> None:
    if not CONTACT_NOTIFY_EMAIL:
        return

    subject = payload.get("subject") or "Website inquiry"
    msg = EmailMessage()
    msg["To"] = CONTACT_NOTIFY_EMAIL
    msg["From"] = CONTACT_FROM_EMAIL
    msg["Reply-To"] = payload["email"]
    msg["Subject"] = f"GK Works inquiry: {subject}"
    msg.set_content(
        "\n".join(
            [
                "New inquiry from gkworks.com",
                "",
                f"Name: {payload['name']}",
                f"Company: {payload.get('company', '')}",
                f"Email: {payload['email']}",
                f"Subject: {subject}",
                "",
                "Message:",
                payload["message"],
            ]
        )
    )

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as smtp:
            if SMTP_USE_TLS:
                smtp.starttls()
            if SMTP_USERNAME and SMTP_PASSWORD:
                smtp.login(SMTP_USERNAME, SMTP_PASSWORD)
            smtp.send_message(msg)
    except Exception as exc:
        app.logger.warning("contact notification email failed: %s", exc)


def bearer_token() -> str:
    header = request.headers.get("Authorization", "")
    if not header.lower().startswith("bearer "):
        return ""
    return header.split(" ", 1)[1].strip()


def api_authorized() -> bool:
    return bool(CONTACT_NOTIFY_API_TOKEN) and bearer_token() == CONTACT_NOTIFY_API_TOKEN


def clean_text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.replace("\r", "").replace("\x00", "").strip()[:limit]


def recent_jsonl(path: Path, limit: int = 5) -> list[dict[str, str]]:
    if not path.exists():
        return []

    lines = path.read_text(encoding="utf-8").splitlines()[-limit:]
    items: list[dict[str, str]] = []
    for line in lines:
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            item.pop("message", None)
            items.append(item)
    return items


@app.get("/")
def index():
    return render_template("index.html", submitted=request.args.get("submitted") == "1")


@app.post("/contact")
def contact():
    name = request.form.get("name", "").strip()
    company = request.form.get("company", "").strip()
    email = request.form.get("email", "").strip()
    subject = request.form.get("subject", "").strip()
    message = request.form.get("message", "").strip()
    website = request.form.get("website", "").strip()

    if website:
        return redirect(url_for("index", submitted="1") + "#contact")

    errors = []
    if not name:
        errors.append("Name is required.")
    if not email or "@" not in email:
        errors.append("A valid email address is required.")
    if not message:
        errors.append("Message is required.")

    form_data = {
        "name": name,
        "company": company,
        "email": email,
        "subject": subject,
        "message": message,
    }

    if errors:
        return render_template("index.html", errors=errors, form_data=form_data, submitted=False), 400

    save_contact_submission(form_data)
    notify_contact_submission(form_data)
    return redirect(url_for("index", submitted="1") + "#contact")


@app.get("/docs/<path:filename>")
def docs(filename: str):
    return send_from_directory(BASE_DIR / "docs", filename, mimetype="text/markdown")


@app.post("/api/contact-notification")
@app.post("/api/contact-notification.php")
def contact_notification_api():
    if not api_authorized():
        return jsonify(ok=False, error="unauthorized"), 401

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(ok=False, error="invalid_json"), 400

    name = clean_text(payload.get("name"), 120)
    company = clean_text(payload.get("company"), 160)
    email = clean_text(payload.get("email"), 180)
    subject = clean_text(payload.get("subject"), 180)
    message = clean_text(payload.get("message"), 5000)
    source = clean_text(payload.get("source"), 80) or "cloudflare-worker"

    if not name or not message or "@" not in email:
        return jsonify(ok=False, error="validation_failed"), 422

    form_data = {
        "source": source,
        "name": name,
        "company": company,
        "email": email,
        "subject": subject,
        "message": message,
    }
    append_jsonl(API_NOTIFICATIONS_PATH, form_data)
    notify_contact_submission(form_data)
    return jsonify(ok=True)


@app.get("/api/health")
def api_health():
    return jsonify(
        ok=True,
        service="gkworks-python-api",
        generated_at=datetime.now(timezone.utc).isoformat(),
        checks={
            "config_readable": True,
            "server_mail_config_readable": SERVER_MAIL_CONFIG_PATH.exists(),
            "smtp_host_configured": bool(SMTP_HOST),
            "notify_to_configured": bool(CONTACT_NOTIFY_EMAIL),
            "notify_api_token_configured": bool(CONTACT_NOTIFY_API_TOKEN),
            "contact_api_log_exists": API_NOTIFICATIONS_PATH.exists(),
        },
    )


@app.get("/api/catalog")
def api_catalog():
    public_catalog = []
    for api in API_CATALOG:
        item = dict(api)
        if "Bearer" in item.get("auth", ""):
            item["auth"] = "protected"
        public_catalog.append(item)
    return jsonify(
        ok=True,
        service="gkworks-api-catalog",
        generated_at=datetime.now(timezone.utc).isoformat(),
        apis=public_catalog,
    )


@app.get("/api/management")
@app.get("/api/management.php")
def api_management():
    if not api_authorized():
        return jsonify(ok=False, error="unauthorized"), 401

    checks = {
        "config_readable": True,
        "server_mail_config_readable": SERVER_MAIL_CONFIG_PATH.exists(),
        "smtp_host_configured": bool(SMTP_HOST),
        "smtp_username_configured": bool(SMTP_USERNAME),
        "smtp_password_configured": bool(SMTP_PASSWORD),
        "smtp_from_configured": bool(CONTACT_FROM_EMAIL),
        "notify_to_configured": bool(CONTACT_NOTIFY_EMAIL),
        "notify_api_token_configured": bool(CONTACT_NOTIFY_API_TOKEN),
        "contact_api_log_exists": API_NOTIFICATIONS_PATH.exists(),
    }
    recent = recent_jsonl(API_NOTIFICATIONS_PATH) if request.args.get("include_logs") == "1" else []
    return jsonify(
        ok=True,
        service="gkworks-api-management",
        generated_at=datetime.now(timezone.utc).isoformat(),
        checks=checks,
        apis=API_CATALOG,
        recent_contact_notifications=recent,
    )


if __name__ == "__main__":
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8099")),
        debug=os.environ.get("FLASK_DEBUG") == "1",
    )
