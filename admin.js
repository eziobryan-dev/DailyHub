(() => {
  "use strict";

  // Security model: this page holds no secret. Every read/write is checked by
  // Postgres RLS, which only allows listed admins with a 2FA-verified (aal2) session.
  const { supabaseUrl, supabaseKey } = window.DAILYHUB_CONFIG;
  const AUTH = `${supabaseUrl}/auth/v1`;
  const GAMES = `${supabaseUrl}/rest/v1/games`;
  const SESSION_KEY = "dailyhub.admin.session"; // sessionStorage: gone when the tab closes
  const IDLE_LIMIT_MS = 30 * 60 * 1000;

  const $ = (id) => document.getElementById(id);
  const views = { login: $("login-view"), mfa: $("mfa-view"), dashboard: $("dashboard") };

  // ---------- session ----------
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { session = null; }

  function saveSession(data) {
    session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* ignore */ }
  }

  function clearSession() {
    session = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  function claims() {
    try {
      const part = session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(part));
    } catch { return {}; }
  }

  // ---------- HTTP helpers ----------
  class ApiError extends Error {
    constructor(status, body) {
      super(body?.msg || body?.message || body?.error_description || `HTTP ${status}`);
      this.status = status;
      this.code = body?.error_code || body?.code || body?.error;
    }
  }

  async function request(url, { method = "GET", body, auth = true, headers = {} } = {}) {
    const h = { apikey: supabaseKey, ...headers };
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (auth && session) h.Authorization = `Bearer ${session.access_token}`;
    const res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  async function refreshIfNeeded() {
    if (!session) throw new ApiError(401, { msg: "no session" });
    if (Date.now() < session.expires_at - 60_000) return;
    const data = await request(`${AUTH}/token?grant_type=refresh_token`, {
      method: "POST", auth: false, body: { refresh_token: session.refresh_token },
    });
    saveSession(data);
  }

  // Authenticated call; signs out on an expired/invalid session.
  async function authed(url, opts) {
    try {
      await refreshIfNeeded();
      return await request(url, opts);
    } catch (err) {
      if (err.status === 401) { await signOut("Session expirée, reconnecte-toi."); }
      throw err;
    }
  }

  // ---------- views ----------
  function show(name) {
    for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
    $("logout").hidden = name === "login";
  }

  function setMsg(id, text, kind = "err") {
    const el = $(id);
    el.textContent = text;
    el.className = `msg ${kind}${id === "dash-msg" ? " banner" : ""}`;
  }

  function busy(form, on) {
    for (const el of form.querySelectorAll("button, input")) el.disabled = on;
  }

  const safeUrl = (value) => {
    try {
      const u = new URL(value);
      return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
    } catch { return null; }
  };

  const normalizeUrl = (value) => {
    const v = String(value || "").trim();
    if (!v) return "";
    return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  };

  // ---------- step 1: password ----------
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) return setMsg("login-msg", "Email et mot de passe requis.");

    busy(form, true);
    setMsg("login-msg", "");
    try {
      const data = await request(`${AUTH}/token?grant_type=password`, {
        method: "POST", auth: false, body: { email, password },
      });
      form.reset();
      saveSession(data);
      await startMfa();
    } catch (err) {
      console.error(err);
      form.password.value = "";
      setMsg("login-msg",
        err.status === 400 || err.code === "invalid_credentials" ? "Email ou mot de passe incorrect."
        : err.status === 429 ? "Trop de tentatives. Réessaie dans quelques minutes."
        : "Connexion impossible. Réessaie plus tard.");
    } finally {
      busy(form, false);
    }
  });

  // ---------- step 2: TOTP ----------
  let factorId = null;

  async function startMfa() {
    show("mfa");
    setMsg("mfa-msg", "");
    const user = await authed(`${AUTH}/user`);
    const totp = (user.factors || []).filter((f) => f.factor_type === "totp");
    const verified = totp.find((f) => f.status === "verified");

    if (verified) {
      factorId = verified.id;
      $("enroll").hidden = true;
      $("mfa-hint").hidden = false;
    } else {
      // First login: drop abandoned enrollments, then enroll a new authenticator.
      for (const f of totp) await authed(`${AUTH}/factors/${f.id}`, { method: "DELETE" });
      const enrolled = await authed(`${AUTH}/factors`, {
        method: "POST",
        body: { factor_type: "totp", friendly_name: `DailyHub ${new Date().toISOString()}` },
      });
      factorId = enrolled.id;
      const qr = String(enrolled.totp.qr_code || "");
      const svgPrefix = /^data:image\/svg\+xml;utf-8,/;
      $("qr").src = svgPrefix.test(qr)
        ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qr.replace(svgPrefix, ""))
        : qr;
      $("secret").textContent = enrolled.totp.secret;
      $("enroll").hidden = false;
      $("mfa-hint").hidden = true;
    }
    $("mfa-form").code.focus();
  }

  $("mfa-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const code = form.code.value.replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) return setMsg("mfa-msg", "Le code fait 6 chiffres.");

    busy(form, true);
    try {
      const challenge = await authed(`${AUTH}/factors/${factorId}/challenge`, { method: "POST", body: {} });
      const data = await authed(`${AUTH}/factors/${factorId}/verify`, {
        method: "POST", body: { challenge_id: challenge.id, code },
      });
      saveSession(data);
      form.reset();
      $("qr").removeAttribute("src");
      $("secret").textContent = "";
      await openDashboard();
    } catch (err) {
      console.error(err);
      if (err.status === 401 && !session) return; // signed out by authed()
      setMsg("mfa-msg", err.status === 429 ? "Trop de tentatives. Patiente un peu." : "Code incorrect ou expiré.");
    } finally {
      busy(form, false);
    }
  });

  // ---------- step 3: dashboard ----------
  async function openDashboard() {
    if (claims().aal !== "aal2") return startMfa();
    show("dashboard");
    await loadGames();
  }

  async function loadGames() {
    try {
      const games = await authed(`${GAMES}?select=id,name,url,preview_url,status,created_at&order=created_at.desc`);
      renderPending(games.filter((g) => g.status === "pending"));
      renderCatalog(games.filter((g) => g.status === "approved").sort((a, b) => a.name.localeCompare(b.name, "fr")));
    } catch (err) {
      console.error(err);
      if (session) setMsg("dash-msg", "Impossible de charger les jeux.");
    }
  }

  function renderPending(list) {
    const tpl = $("pending-tpl");
    const nodes = list.map((game) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.querySelector(".row-name").textContent = game.name;
      const link = node.querySelector(".row-url");
      link.textContent = game.url;
      const href = safeUrl(game.url);
      if (href) link.href = href; else link.removeAttribute("href");
      node.querySelector(".row-date").textContent =
        "Proposé le " + new Date(game.created_at).toLocaleString("fr", { dateStyle: "medium", timeStyle: "short" });
      node.querySelector('[data-act="approve"]').addEventListener("click", (e) => approve(game, e.currentTarget));
      node.querySelector('[data-act="deny"]').addEventListener("click", (e) => deny(game, e.currentTarget));
      return node;
    });
    $("pending").replaceChildren(...nodes);
    $("pending-count").textContent = list.length ? String(list.length) : "";
    $("pending-empty").classList.toggle("show", list.length === 0);
  }

  function renderCatalog(list) {
    const tpl = $("catalog-tpl");
    const nodes = list.map((game) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      const form = node.querySelector("form");
      form.name.value = game.name;
      form.url.value = game.url;
      form.preview_url.value = game.preview_url || "";
      form.addEventListener("submit", (e) => { e.preventDefault(); save(game, form); });
      form.querySelector('[data-act="delete"]').addEventListener("click", () => remove(game, form));
      return node;
    });
    $("catalog").replaceChildren(...nodes);
    $("catalog-count").textContent = `${list.length} jeu${list.length > 1 ? "x" : ""}`;
  }

  // Writes return the affected rows: an empty array means RLS refused the change.
  async function write(url, opts, okText) {
    try {
      const rows = await authed(url, { ...opts, headers: { Prefer: "return=representation" } });
      if (!Array.isArray(rows) || rows.length === 0) {
        setMsg("dash-msg", "Action refusée : ce compte n'a pas les droits d'administration.");
        return false;
      }
      setMsg("dash-msg", okText, "ok");
      return true;
    } catch (err) {
      console.error(err);
      if (!session) return false;
      setMsg("dash-msg",
        err.code === "23505" ? "Un jeu avec ce lien existe déjà."
        : err.code === "23514" ? "Valeur invalide (nom de 2 à 80 caractères, liens en http(s))."
        : "L'action a échoué.");
      return false;
    }
  }

  async function approve(game, button) {
    button.disabled = true;
    await write(`${GAMES}?id=eq.${game.id}`, { method: "PATCH", body: { status: "approved" } }, `« ${game.name} » ajouté au catalogue.`);
    await loadGames();
  }

  async function deny(game, button) {
    if (!confirm(`Refuser et supprimer « ${game.name} » ?`)) return;
    button.disabled = true;
    await write(`${GAMES}?id=eq.${game.id}`, { method: "DELETE" }, `« ${game.name} » refusé.`);
    await loadGames();
  }

  function readGameForm(form) {
    const name = form.name.value.trim();
    const url = normalizeUrl(form.url.value);
    const preview = normalizeUrl(form.preview_url.value);
    if (name.length < 2) return { error: "Le nom doit faire au moins 2 caractères." };
    if (!safeUrl(url)) return { error: "Le lien du jeu n'est pas valide." };
    if (preview && (!safeUrl(preview) || !preview.startsWith("https://"))) return { error: "L'image doit être une adresse https://." };
    return { data: { name, url, preview_url: preview || null } };
  }

  async function save(game, form) {
    const { data, error } = readGameForm(form);
    if (error) return setMsg("dash-msg", error);
    busy(form, true);
    await write(`${GAMES}?id=eq.${game.id}`, { method: "PATCH", body: data }, `« ${data.name} » enregistré.`);
    await loadGames();
  }

  async function remove(game, form) {
    if (!confirm(`Supprimer « ${game.name} » du catalogue ?`)) return;
    busy(form, true);
    await write(`${GAMES}?id=eq.${game.id}`, { method: "DELETE" }, `« ${game.name} » supprimé.`);
    await loadGames();
  }

  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const { data, error } = readGameForm(form);
    if (error) return setMsg("dash-msg", error);
    busy(form, true);
    const ok = await write(GAMES, { method: "POST", body: { ...data, status: "approved" } }, `« ${data.name} » ajouté.`);
    busy(form, false);
    if (ok) form.reset();
    await loadGames();
  });

  // ---------- sign out ----------
  async function signOut(reason) {
    const token = session?.access_token;
    clearSession();
    if (token) {
      fetch(`${AUTH}/logout`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${token}` } })
        .catch(() => {});
    }
    $("pending").replaceChildren();
    $("catalog").replaceChildren();
    show("login");
    setMsg("login-msg", reason || "", reason ? "err" : "ok");
  }

  $("logout").addEventListener("click", () => signOut());

  // Sign out after 30 minutes without activity.
  let idleTimer;
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (session) signOut("Déconnecté après 30 minutes d'inactivité."); }, IDLE_LIMIT_MS);
  }
  for (const evt of ["click", "keydown", "pointermove"]) document.addEventListener(evt, resetIdle, { passive: true });
  resetIdle();

  // ---------- boot ----------
  (async () => {
    if (!session) return show("login");
    try {
      await refreshIfNeeded();
      await openDashboard();
    } catch (err) {
      console.error(err);
      await signOut();
    }
  })();
})();
