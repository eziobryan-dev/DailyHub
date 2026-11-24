// Called by the database trigger for each new pending game.
// Emails the maintainer with signed Accept / Deny links.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

type Config = {
  webhook_secret: string;
  moderation_secret: string;
  site_url: string;
  admin_email: string;
};

async function getConfig(): Promise<Config> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_moderation_config`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`config: HTTP ${res.status}`);
  return await res.json();
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function button(href: string, label: string, color: string) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 28px;margin:0 6px;border-radius:10px;background:${color};color:#ffffff;font-weight:600;text-decoration:none;font-family:Arial,sans-serif">${label}</a>`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let cfg: Config;
  try {
    cfg = await getConfig();
  } catch (err) {
    console.error(err);
    return new Response("Config unavailable", { status: 500 });
  }

  if (!safeEqual(req.headers.get("x-webhook-secret") ?? "", cfg.webhook_secret)) {
    return new Response("Forbidden", { status: 403 });
  }

  const { id, name, url } = await req.json();
  if (typeof id !== "string" || typeof name !== "string" || typeof url !== "string") {
    return new Response("Bad payload", { status: 400 });
  }

  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set: no email sent for", id);
    return new Response("Email not configured", { status: 503 });
  }

  const link = async (action: "approve" | "deny") =>
    `${cfg.site_url}/moderate.html?id=${id}&action=${action}&sig=${await sign(cfg.moderation_secret, `${id}:${action}`)}`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1b1b24">
      <h2 style="margin:0 0 4px">Nouvelle proposition sur DailyHub</h2>
      <p style="margin:0 0 20px;color:#6b6b7b">Quelqu'un propose d'ajouter un jeu au catalogue.</p>
      <table style="border-collapse:collapse;margin-bottom:24px">
        <tr><td style="padding:4px 12px 4px 0;color:#6b6b7b">Nom</td><td style="padding:4px 0"><strong>${escapeHtml(name)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b6b7b">Lien</td><td style="padding:4px 0"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></td></tr>
      </table>
      <div style="text-align:center;margin-bottom:20px">
        ${button(await link("approve"), "Accept", "#1f9d55")}
        ${button(await link("deny"), "Deny", "#d64545")}
      </div>
      <p style="font-size:12px;color:#9a9aab;text-align:center">Chaque bouton ouvre une page de confirmation avant d'agir.</p>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "DailyHub <onboarding@resend.dev>",
      to: [cfg.admin_email],
      subject: `DailyHub : nouvelle proposition « ${name} »`,
      html,
    }),
  });

  if (!res.ok) {
    console.error("Resend error", res.status, await res.text());
    return new Response("Email failed", { status: 502 });
  }
  return new Response("Sent", { status: 200 });
});
