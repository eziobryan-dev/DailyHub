// Called by moderate.html (on GitHub Pages) when the maintainer confirms Accept / Deny.
// Body: { id, action: "approve" | "deny", sig, check?: boolean }
//  - check: true  -> only returns the game and its current status (to show the confirmation page)
//  - otherwise    -> approves (status = approved) or denies (deletes the pending row)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REST = `${SUPABASE_URL}/rest/v1`;
const DB_HEADERS = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

const ALLOWED_ORIGINS = ["https://eziobryan-dev.github.io", "http://localhost:5173"];

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    Vary: "Origin",
  };
}

function json(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json" },
  });
}

async function moderationSecret(): Promise<string> {
  const res = await fetch(`${REST}/rpc/get_moderation_config`, { method: "POST", headers: DB_HEADERS, body: "{}" });
  if (!res.ok) throw new Error(`config: HTTP ${res.status}`);
  return (await res.json()).moderation_secret;
}

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findGame(id: string) {
  const res = await fetch(`${REST}/games?id=eq.${id}&select=name,url,status`, { headers: DB_HEADERS });
  if (!res.ok) throw new Error(`select: HTTP ${res.status}`);
  const rows = await res.json();
  return rows[0] as { name: string; url: string; status: string } | undefined;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed" });

  let body: { id?: unknown; action?: unknown; sig?: unknown; check?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "bad_request" });
  }
  const { id, action, sig, check } = body;
  if (typeof id !== "string" || !UUID.test(id) || (action !== "approve" && action !== "deny") || typeof sig !== "string") {
    return json(req, 400, { error: "bad_request" });
  }

  try {
    const expected = await sign(await moderationSecret(), `${id}:${action}`);
    if (!safeEqual(sig, expected)) return json(req, 403, { error: "invalid_signature" });

    const game = await findGame(id);
    if (check) return json(req, 200, { game: game ?? null });
    if (!game) return json(req, 200, { result: "not_found" });
    if (game.status !== "pending") return json(req, 200, { result: "already_approved", game });

    if (action === "approve") {
      const res = await fetch(`${REST}/games?id=eq.${id}&status=eq.pending`, {
        method: "PATCH",
        headers: { ...DB_HEADERS, Prefer: "return=minimal" },
        body: JSON.stringify({ status: "approved" }),
      });
      if (!res.ok) throw new Error(`update: HTTP ${res.status}`);
      return json(req, 200, { result: "approved", game });
    }

    const res = await fetch(`${REST}/games?id=eq.${id}&status=eq.pending`, {
      method: "DELETE",
      headers: { ...DB_HEADERS, Prefer: "return=minimal" },
    });
    if (!res.ok) throw new Error(`delete: HTTP ${res.status}`);
    return json(req, 200, { result: "denied", game });
  } catch (err) {
    console.error(err);
    return json(req, 500, { error: "server_error" });
  }
});
