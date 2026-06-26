from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, redirect, render_template, request, send_from_directory, url_for


app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-change-in-production")

BASE_DIR = Path(__file__).resolve().parent
SUBMISSIONS_PATH = Path(os.environ.get("CONTACT_SUBMISSIONS_PATH", BASE_DIR / "instance" / "contact_submissions.jsonl"))


def save_contact_submission(payload: dict[str, str]) -> None:
    SUBMISSIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "received_at": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    with SUBMISSIONS_PATH.open("a", encoding="utf-8") as fp:
        fp.write(json.dumps(record, ensure_ascii=True) + "\n")


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
