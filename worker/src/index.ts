import { DurableObject } from "cloudflare:workers";

export interface Env {
  ASSETS: Fetcher;
  API_STATE: DurableObjectNamespace<ApiState>;
  CONTACT_SUBMISSIONS?: KVNamespace;
  NOTIFICATION_API_URL: string;
  NOTIFICATION_API_TOKEN: string;
  ADMIN_API_TOKEN?: string;
}

type ContactPayload = {
  name: string;
  company: string;
  email: string;
  subject: string;
  message: string;
  source: string;
};

type ContactRecord = ContactPayload & {
  received_at: string;
  remote_addr: string;
  channel: "public-form" | "protected-api";
};

type ContactSummary = Omit<ContactRecord, "message"> & { id: number };

export class ApiState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS contact_submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          received_at TEXT NOT NULL,
          source TEXT NOT NULL,
          name TEXT NOT NULL,
          company TEXT NOT NULL,
          email TEXT NOT NULL,
          subject TEXT NOT NULL,
          message TEXT NOT NULL,
          remote_addr TEXT NOT NULL,
          channel TEXT NOT NULL DEFAULT 'public-form'
        )
      `);
      try {
        this.ctx.storage.sql.exec(
          "ALTER TABLE contact_submissions ADD COLUMN channel TEXT NOT NULL DEFAULT 'public-form'",
        );
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("duplicate column")) {
          throw error;
        }
      }
      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_contact_submissions_received_at
        ON contact_submissions (received_at DESC)
      `);
    });
  }

  recordContact(record: ContactRecord): number {
    const result = this.ctx.storage.sql.exec<{ id: number }>(
      `INSERT INTO contact_submissions
        (received_at, source, name, company, email, subject, message, remote_addr, channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      record.received_at,
      record.source,
      record.name,
      record.company,
      record.email,
      record.subject,
      record.message,
      record.remote_addr,
      record.channel,
    );
    return result.one().id;
  }

  recentContacts(limit = 5): Array<ContactSummary> {
    return this.ctx.storage.sql.exec<ContactSummary>(
      `SELECT id, received_at, source, name, company, email, subject, remote_addr, channel
       FROM contact_submissions
       ORDER BY id DESC
       LIMIT ?`,
      Math.max(1, Math.min(limit, 25)),
    ).toArray();
  }

  stats(): { total_contacts: number; latest_received_at: string | null } {
    const count = this.ctx.storage.sql.exec<{ total: number }>(
      "SELECT COUNT(*) AS total FROM contact_submissions",
    ).one().total;
    const latest = this.ctx.storage.sql.exec<{ latest: string | null }>(
      "SELECT MAX(received_at) AS latest FROM contact_submissions",
    ).one().latest;
    return { total_contacts: count, latest_received_at: latest };
  }
}

const API_CATALOG = [
  {
    id: "contact",
    name: "Public Contact Form",
    method: "POST",
    path: "/contact",
    auth: "public form with honeypot",
    status: "active",
    consumer: "Website contact form",
    description: "Accepts public contact form submissions, optionally stores a KV backup, and forwards notification to the protected Gmail SMTP API.",
    backup_log: "CONTACT_SUBMISSIONS KV when configured",
    required_fields: ["name", "email", "message"],
    optional_fields: ["company", "subject", "website"],
  },
  {
    id: "contact-notification",
    name: "Protected Contact Notification API",
    method: "POST",
    path: "/api/contact-notification",
    auth: "Bearer NOTIFICATION_API_TOKEN or ADMIN_API_TOKEN",
    status: "active",
    consumer: "Worker API clients and compatibility checks",
    description: "Accepts authenticated JSON contact notification payloads, records them in Durable Objects, and forwards email delivery to the Gmail SMTP backend.",
    backup_log: "API_STATE Durable Object and CONTACT_SUBMISSIONS KV when configured",
    required_fields: ["name", "email", "message"],
    optional_fields: ["company", "subject", "source"],
    aliases: ["/api/contact-notification.php"],
  },
  {
    id: "api-catalog",
    name: "API Catalog",
    method: "GET",
    path: "/api/catalog",
    auth: "public metadata",
    status: "active",
    consumer: "API management tooling",
    description: "Returns public API metadata without operational logs or secrets.",
    backup_log: null,
    required_fields: [],
    optional_fields: [],
  },
  {
    id: "api-health",
    name: "API Health",
    method: "GET",
    path: "/api/health",
    auth: "public status",
    status: "active",
    consumer: "Monitoring and deployment checks",
    description: "Returns non-sensitive runtime health for the Worker API surface.",
    backup_log: null,
    required_fields: [],
    optional_fields: [],
  },
  {
    id: "worker-management",
    name: "Worker API Management",
    method: "GET",
    path: "/api/management",
    auth: "Bearer ADMIN_API_TOKEN or NOTIFICATION_API_TOKEN",
    status: "active",
    consumer: "Operations and deployment checks",
    description: "Returns the Worker API catalog and runtime configuration health without exposing secrets.",
    backup_log: null,
    required_fields: [],
    optional_fields: ["include_logs", "limit"],
    aliases: ["/api/management.php"],
  },
];

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload) + "\n", {
    ...init,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      ...(init.headers || {}),
    },
  });
}

function clean(value: unknown, limit: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\r|\0/g, "").trim().slice(0, limit);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function apiAuthorized(request: Request, env: Env): boolean {
  const token = bearerToken(request);
  return Boolean(token) && (token === env.ADMIN_API_TOKEN || token === env.NOTIFICATION_API_TOKEN);
}

function acceptsJson(request: Request): boolean {
  return (request.headers.get("accept") || "").includes("application/json");
}

function contactStateStub(env: Env, date = new Date()): DurableObjectStub<ApiState> {
  const month = date.toISOString().slice(0, 7);
  return env.API_STATE.getByName(`contacts-${month}`);
}

async function readContactPayload(request: Request): Promise<ContactPayload & { website: string }> {
  const contentType = request.headers.get("content-type") || "";
  let raw: Record<string, unknown> = {};

  if (contentType.includes("application/json")) {
    const parsed = await request.json().catch(() => null);
    if (parsed && typeof parsed === "object") {
      raw = parsed as Record<string, unknown>;
    }
  } else {
    const form = await request.formData();
    raw = Object.fromEntries(form.entries());
  }

  return {
    name: clean(raw.name, 120),
    company: clean(raw.company, 160),
    email: clean(raw.email, 180),
    subject: clean(raw.subject, 180),
    message: clean(raw.message, 5000),
    source: clean(raw.source, 80) || "cloudflare-worker",
    website: clean(raw.website, 200),
  };
}

async function storeContactSubmission(
  env: Env,
  payload: ContactPayload,
  request: Request,
  channel: ContactRecord["channel"],
): Promise<number> {
  const record = {
    received_at: new Date().toISOString(),
    remote_addr: request.headers.get("cf-connecting-ip") || "",
    channel,
    ...payload,
  };

  const durableObjectId = await contactStateStub(env).recordContact(record);

  if (!env.CONTACT_SUBMISSIONS) {
    return durableObjectId;
  }

  const id = `${record.received_at}-${crypto.randomUUID()}`;
  await env.CONTACT_SUBMISSIONS.put(id, JSON.stringify(record), {
    metadata: {
      email: payload.email,
      source: payload.source,
      subject: payload.subject,
    },
  });
  return durableObjectId;
}

async function notifyBackend(env: Env, payload: ContactPayload, requestUrl?: string): Promise<void> {
  if (!env.NOTIFICATION_API_URL || !env.NOTIFICATION_API_TOKEN) {
    throw new Error("notification API is not configured");
  }

  if (requestUrl) {
    const destination = new URL(env.NOTIFICATION_API_URL);
    const requestDestination = new URL(requestUrl);
    if (destination.origin === requestDestination.origin && destination.pathname === requestDestination.pathname) {
      throw new Error("notification API URL points back to this Worker route");
    }
  }

  const response = await fetch(env.NOTIFICATION_API_URL, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.NOTIFICATION_API_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`notification API failed with HTTP ${response.status}`);
  }
}

async function handleContact(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const payload = await readContactPayload(request);

  if (payload.website) {
    return Response.redirect(new URL("/?submitted=1#contact", request.url).toString(), 303);
  }

  if (!payload.name || !payload.message || !isEmail(payload.email)) {
    if (acceptsJson(request)) {
      return jsonResponse({ ok: false, error: "validation_failed" }, { status: 422 });
    }
    return Response.redirect(new URL("/?error=1#contact", request.url).toString(), 303);
  }

  const notificationPayload = {
    name: payload.name,
    company: payload.company,
    email: payload.email,
    subject: payload.subject,
    message: payload.message,
    source: "cloudflare-worker",
  };

  const id = await storeContactSubmission(env, notificationPayload, request, "public-form");
  ctx.waitUntil(
    notifyBackend(env, notificationPayload, request.url).catch((error) => {
      console.error(JSON.stringify({
        event: "contact_notification_failed",
        submission_id: id,
        error: error instanceof Error ? error.message : String(error),
      }));
    }),
  );

  if (acceptsJson(request)) {
    return jsonResponse({ ok: true, id });
  }
  return Response.redirect(new URL("/?submitted=1#contact", request.url).toString(), 303);
}

async function handleProtectedContactNotification(request: Request, env: Env): Promise<Response> {
  if (!apiAuthorized(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return jsonResponse({ ok: false, error: "json_required" }, { status: 415 });
  }

  const payload = await readContactPayload(request);
  if (!payload.name || !payload.message || !isEmail(payload.email)) {
    return jsonResponse({ ok: false, error: "validation_failed" }, { status: 422 });
  }

  const notificationPayload = {
    name: payload.name,
    company: payload.company,
    email: payload.email,
    subject: payload.subject,
    message: payload.message,
    source: payload.source || "worker-protected-api",
  };
  const id = await storeContactSubmission(env, notificationPayload, request, "protected-api");

  try {
    await notifyBackend(env, notificationPayload, request.url);
  } catch (error) {
    console.error(JSON.stringify({
      event: "protected_contact_notification_failed",
      submission_id: id,
      error: error instanceof Error ? error.message : String(error),
    }));
    return jsonResponse({ ok: false, id, error: "notification_failed" }, { status: 502 });
  }

  return jsonResponse({ ok: true, id });
}

function publicApiCatalog() {
  return API_CATALOG.map((api) => ({
    ...api,
    auth: api.auth.includes("Bearer") ? "protected" : api.auth,
  }));
}

async function handleHealth(env: Env): Promise<Response> {
  const stateStats = await contactStateStub(env).stats();
  return jsonResponse({
    ok: true,
    service: "gkworks-cloudflare-worker",
    generated_at: new Date().toISOString(),
    checks: {
      assets_binding_configured: Boolean(env.ASSETS),
      durable_object_configured: Boolean(env.API_STATE),
      notification_api_url_configured: Boolean(env.NOTIFICATION_API_URL),
      notification_api_token_configured: Boolean(env.NOTIFICATION_API_TOKEN),
    },
    durable_object: {
      shard: `contacts-${new Date().toISOString().slice(0, 7)}`,
      ...stateStats,
    },
  });
}

async function handleManagement(request: Request, env: Env): Promise<Response> {
  if (!apiAuthorized(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const stub = contactStateStub(env);
  const searchParams = new URL(request.url).searchParams;
  const includeLogs = searchParams.get("include_logs") === "1";
  const limit = Number.parseInt(searchParams.get("limit") || "5", 10);
  const [stateStats, recentContacts] = await Promise.all([
    stub.stats(),
    includeLogs ? stub.recentContacts(Number.isFinite(limit) ? limit : 5) : Promise.resolve([]),
  ]);

  return jsonResponse({
    ok: true,
    service: "gkworks-cloudflare-worker",
    generated_at: new Date().toISOString(),
    checks: {
      assets_binding_configured: Boolean(env.ASSETS),
      durable_object_configured: Boolean(env.API_STATE),
      contact_kv_configured: Boolean(env.CONTACT_SUBMISSIONS),
      notification_api_url_configured: Boolean(env.NOTIFICATION_API_URL),
      notification_api_token_configured: Boolean(env.NOTIFICATION_API_TOKEN),
      admin_api_token_configured: Boolean(env.ADMIN_API_TOKEN),
    },
    apis: API_CATALOG,
    durable_object: {
      namespace: "API_STATE",
      shard: `contacts-${new Date().toISOString().slice(0, 7)}`,
      ...stateStats,
    },
    recent_contact_notifications: recentContacts,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return handleHealth(env);
    }

    if (request.method === "GET" && url.pathname === "/api/catalog") {
      return jsonResponse({
        ok: true,
        service: "gkworks-api-catalog",
        generated_at: new Date().toISOString(),
        apis: publicApiCatalog(),
      });
    }

    if (request.method === "POST" && url.pathname === "/contact") {
      return handleContact(request, env, ctx);
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/api/contact-notification" || url.pathname === "/api/contact-notification.php")
    ) {
      return handleProtectedContactNotification(request, env);
    }

    if (
      request.method === "GET" &&
      (url.pathname === "/api/management" || url.pathname === "/api/management.php")
    ) {
      return handleManagement(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
