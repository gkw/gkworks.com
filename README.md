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
