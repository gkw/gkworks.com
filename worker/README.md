# GK Works Cloudflare Worker

Cloudflare Workers version of the GK Works website.

## Structure

```text
src/index.ts              Worker routes and API handlers
public/                   Static assets served by Workers Static Assets
public/index.html         Static website entrypoint
public/docs/              Public Markdown file
wrangler.jsonc            Worker configuration
.dev.vars.example         Local secret template
```

## Local Setup

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and set:

```text
NOTIFICATION_API_TOKEN=<production notify_api_token>
ADMIN_API_TOKEN=<local admin token>
```

Run locally:

```bash
npm run dev
```

Then open:

```text
http://127.0.0.1:8787/
```

## API Paths

The Worker mirrors the current production API paths:

```text
POST /contact
POST /api/contact-notification.php
GET /api/management.php
```

The public contact form posts to `/contact`. The Worker forwards notifications to the protected VPS endpoint configured by `NOTIFICATION_API_URL`.

## Durable Objects

The Worker uses the `ApiState` Durable Object for strongly consistent contact submission records and API management state.

Contact submissions are sharded by month:

```text
contacts-YYYY-MM
```

This keeps one global object from becoming a long-term bottleneck while still giving each month an ordered, queryable log.

## Production Secrets

Set secrets with Wrangler:

```bash
npx wrangler secret put NOTIFICATION_API_TOKEN
npx wrangler secret put ADMIN_API_TOKEN
```

Do not commit `.dev.vars`, Gmail passwords, or API tokens.

## Preview Deployment Before Domain Cutover

`wrangler.jsonc` is safe for partial rollout by default. Custom domain routes for `gkworks.com` and `www.gkworks.com` are commented out, so deploys go to the Worker preview domain first:

```bash
npm run deploy
```

This lets the Worker use the existing VPS notification API through the API hostname while the main website remains on the current hosting:

```text
NOTIFICATION_API_URL=https://api.gkworks.com/api/contact-notification.php
```

Only uncomment the `routes` entries in `wrangler.jsonc` when ready to move public traffic for `gkworks.com` to Cloudflare Workers.

## Optional KV Backup

Durable Objects are the primary Worker-side contact log. Optional KV backup can also be enabled by creating a namespace and adding it to `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  { "binding": "CONTACT_SUBMISSIONS", "id": "<KV_NAMESPACE_ID>" }
]
```

Without KV, contact notification still works through the protected HTTP notification API.
