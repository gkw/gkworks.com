FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV HOST=0.0.0.0
ENV PORT=8099
ENV CONTACT_SUBMISSIONS_PATH=/app/instance/contact_submissions.jsonl

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN mkdir -p /app/instance

EXPOSE 8099

CMD ["gunicorn", "--bind", "0.0.0.0:8099", "--workers", "2", "--access-logfile", "-", "--error-logfile", "-", "app:app"]
