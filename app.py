from __future__ import annotations

import json
import os
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

from flask import Flask, redirect, render_template, request, send_from_directory, url_for


app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-change-in-production")

BASE_DIR = Path(__file__).resolve().parent
SUBMISSIONS_PATH = Path(os.environ.get("CONTACT_SUBMISSIONS_PATH", BASE_DIR / "instance" / "contact_submissions.jsonl"))
CONTACT_NOTIFY_EMAIL = os.environ.get("CONTACT_NOTIFY_EMAIL", "gen@gkworks.com")
CONTACT_FROM_EMAIL = os.environ.get("CONTACT_FROM_EMAIL", "gen@gkworks.com")
SMTP_HOST = os.environ.get("SMTP_HOST", "localhost")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "25"))
SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "0") == "1"


def save_contact_submission(payload: dict[str, str]) -> None:
    SUBMISSIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "received_at": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    with SUBMISSIONS_PATH.open("a", encoding="utf-8") as fp:
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


if __name__ == "__main__":
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8099")),
        debug=os.environ.get("FLASK_DEBUG") == "1",
    )
