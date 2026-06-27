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
};

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
          remote_addr TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_contact_submissions_received_at
        ON contact_submissions (received_at DESC)
      `);
    });
  }

  recordContact(record: ContactRecord): number {
    const result = this.ctx.storage.sql.exec<{ id: number }>(
      `INSERT INTO contact_submissions
        (received_at, source, name, company, email, subject, message, remote_addr)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      record.received_at,
      record.source,
      record.name,
      record.company,
      record.email,
      record.subject,
      record.message,
      record.remote_addr,
    );
    return result.one().id;
  }

  recentContacts(limit = 5): Array<Omit<ContactRecord, "message"> & { id: number }> {
    return this.ctx.storage.sql.exec<Omit<ContactRecord, "message"> & { id: number }>(
      `SELECT id, received_at, source, name, company, email, subject, remote_addr
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
    id: "worker-management",
    name: "Worker API Management",
    method: "GET",
    path: "/api/management.php",
    auth: "Bearer ADMIN_API_TOKEN or NOTIFICATION_API_TOKEN",
    status: "active",
    consumer: "Operations and deployment checks",
    description: "Returns the Worker API catalog and runtime configuration health without exposing secrets.",
    backup_log: null,
    required_fields: [],
    optional_fields: [],
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

async function storeContactSubmission(env: Env, payload: ContactPayload, request: Request): Promise<void> {
  const record = {
    received_at: new Date().toISOString(),
    remote_addr: request.headers.get("cf-connecting-ip") || "",
    ...payload,
  };

  await contactStateStub(env).recordContact(record);

  if (!env.CONTACT_SUBMISSIONS) {
    return;
  }

  const id = `${record.received_at}-${crypto.randomUUID()}`;
  await env.CONTACT_SUBMISSIONS.put(id, JSON.stringify(record), {
    metadata: {
      email: payload.email,
      source: payload.source,
      subject: payload.subject,
    },
  });
}

async function notifyBackend(env: Env, payload: ContactPayload): Promise<void> {
  if (!env.NOTIFICATION_API_URL || !env.NOTIFICATION_API_TOKEN) {
    throw new Error("notification API is not configured");
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
    const acceptsJson = (request.headers.get("accept") || "").includes("application/json");
    if (acceptsJson) {
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

  await storeContactSubmission(env, notificationPayload, request);
  ctx.waitUntil(
    notifyBackend(env, notificationPayload).catch((error) => {
      console.error(JSON.stringify({
        event: "contact_notification_failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    }),
  );

  const acceptsJson = (request.headers.get("accept") || "").includes("application/json");
  if (acceptsJson) {
    return jsonResponse({ ok: true });
  }
  return Response.redirect(new URL("/?submitted=1#contact", request.url).toString(), 303);
}

async function handleManagement(request: Request, env: Env): Promise<Response> {
  if (!apiAuthorized(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const stub = contactStateStub(env);
  const includeLogs = new URL(request.url).searchParams.get("include_logs") === "1";
  const [stateStats, recentContacts] = await Promise.all([
    stub.stats(),
    includeLogs ? stub.recentContacts(5) : Promise.resolve([]),
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

    if (request.method === "POST" && url.pathname === "/contact") {
      return handleContact(request, env, ctx);
    }

    if (request.method === "POST" && url.pathname === "/api/contact-notification.php") {
      return handleContact(request, env, ctx);
    }

    if (request.method === "GET" && url.pathname === "/api/management.php") {
      return handleManagement(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
