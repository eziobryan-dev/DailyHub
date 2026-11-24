(() => {
  "use strict";

  const { supabaseUrl, supabaseKey } = window.DAILYHUB_CONFIG;
  const API = `${supabaseUrl}/rest/v1/games`;
  const HEADERS = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  const VISITS_KEY = "dailyhub.visits";
  const COOLDOWN_KEY = "dailyhub.lastSuggestion";
  const COOLDOWN_MS = 60 * 1000;

  const $ = (id) => document.getElementById(id);
  const els = {
    mine: $("mine"), discover: $("discover"),
    mineEmpty: $("mine-empty"), discoverEmpty: $("discover-empty"),
    mineProgress: $("mine-progress"), discoverCount: $("discover-count"),
    search: $("search"), status: $("status"),
    form: $("suggest-form"), formMsg: $("form-msg"),
    tpl: $("card-tpl"),
  };

  let games = [];

  // ---------- storage (never trusted to be available) ----------
  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
    },
  };
  let visits = store.get(VISITS_KEY, {});

  // ---------- helpers ----------
  const isToday = (ts) => new Date(ts).toDateString() === new Date().toDateString();
  const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

  const relTime = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  function lastVisitLabel(ts) {
    const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
    if (days === 0) return "Visité aujourd'hui à " + new Date(ts).toLocaleTimeString("fr", { hour: "2-digit", minute: "2-digit" });
    return "Visité " + relTime.format(-days, "day");
  }
  function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }

  // ---------- rendering ----------
  function buildCard(game) {
    const node = els.tpl.content.firstElementChild.cloneNode(true);
    const link = node.querySelector(".card-link");
    const thumb = node.querySelector(".thumb");
    const preview = thumb.querySelector(":scope > img");
    const visitedAt = visits[game.id];

    link.href = game.url;
    node.querySelector("h3").textContent = game.name;
    node.querySelector(".domain").textContent = domainOf(game.url);
    node.querySelector(".favicon").src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domainOf(game.url))}&sz=64`;
    if (visitedAt) node.querySelector(".last").textContent = lastVisitLabel(visitedAt);
    if (visitedAt && isToday(visitedAt)) node.classList.add("played");

    // Custom image if one is set in the database, otherwise the site's logo (favicon).
    if (game.preview_url) {
      preview.addEventListener("load", () => thumb.classList.add("has-preview"));
      preview.addEventListener("error", () => preview.remove());
      preview.src = game.preview_url;
    } else {
      preview.remove();
    }

    const onOpen = () => recordVisit(game.id);
    link.addEventListener("click", onOpen);
    link.addEventListener("auxclick", (e) => { if (e.button === 1) onOpen(); });

    node.querySelector(".remove").addEventListener("click", () => forget(game.id));
    return node;
  }

  function render() {
    const q = els.search.value.trim().toLowerCase();
    const match = (g) => !q || g.name.toLowerCase().includes(q) || g.url.toLowerCase().includes(q);

    const mine = games.filter((g) => visits[g.id]).sort((a, b) => visits[b.id] - visits[a.id]);
    const discover = games.filter((g) => !visits[g.id]);
    const mineShown = mine.filter(match);
    const discoverShown = discover.filter(match);

    els.mine.replaceChildren(...mineShown.map(buildCard));
    els.discover.replaceChildren(...discoverShown.map(buildCard));

    const playedToday = mine.filter((g) => isToday(visits[g.id])).length;
    els.mineProgress.textContent = mine.length ? `${playedToday}/${mine.length} joués aujourd'hui` : "";
    els.discoverCount.textContent = discover.length ? `${discover.length} jeu${discover.length > 1 ? "x" : ""}` : "";

    els.mineEmpty.classList.toggle("show", mineShown.length === 0 && !q);
    els.discoverEmpty.classList.toggle("show", discover.length === 0 && games.length > 0);
  }

  function recordVisit(id) {
    visits = { ...visits, [id]: Date.now() };
    store.set(VISITS_KEY, visits);
    // Let the browser start opening the tab before the card moves.
    setTimeout(render, 300);
  }

  function forget(id) {
    const { [id]: _, ...rest } = visits;
    visits = rest;
    store.set(VISITS_KEY, visits);
    render();
  }

  // ---------- data ----------
  async function loadGames() {
    try {
      const res = await fetch(`${API}?select=id,name,url,preview_url&status=eq.approved&order=name.asc`, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      games = await res.json();
      // Drop visits for games that no longer exist
      const ids = new Set(games.map((g) => g.id));
      visits = Object.fromEntries(Object.entries(visits).filter(([id]) => ids.has(id)));
      store.set(VISITS_KEY, visits);
      els.status.textContent = "";
      render();
    } catch (err) {
      console.error(err);
      els.status.textContent = "Impossible de charger les jeux. Réessaie dans un instant.";
      els.status.classList.add("err");
    }
  }

  // ---------- suggestion form ----------
  function showFormMsg(text, kind) {
    els.formMsg.textContent = text;
    els.formMsg.className = `form-msg ${kind}`;
  }

  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(els.form);
    const name = String(data.get("name") || "").trim();
    let url = String(data.get("url") || "").trim();

    if (data.get("website")) return showFormMsg("Merci !", "ok"); // bot
    if (name.length < 2) return showFormMsg("Indique le nom du jeu.", "err");
    if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
    try { new URL(url); } catch { return showFormMsg("L'adresse du jeu n'est pas valide.", "err"); }

    // One daily per site: reject any URL whose domain (www. ignored) is already in the catalog.
    const domain = domainOf(url);
    if (games.some((g) => domainOf(g.url) === domain)) {
      return showFormMsg("Ce daily est déjà dans le catalogue.", "err");
    }
    const last = store.get(COOLDOWN_KEY, 0);
    if (Date.now() - last < COOLDOWN_MS) return showFormMsg("Patiente une minute avant une nouvelle proposition.", "err");

    const button = els.form.querySelector("button");
    button.disabled = true;
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { ...HEADERS, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ name, url }),
      });
      if (res.status === 409) return showFormMsg("Ce jeu a déjà été proposé, merci !", "ok");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      store.set(COOLDOWN_KEY, Date.now());
      els.form.reset();
      showFormMsg("Merci ! Ta proposition sera examinée bientôt.", "ok");
    } catch (err) {
      console.error(err);
      showFormMsg("L'envoi a échoué. Réessaie plus tard.", "err");
    } finally {
      button.disabled = false;
    }
  });

  // ---------- boot ----------
  $("today").textContent = new Date().toLocaleDateString("fr", { weekday: "long", day: "numeric", month: "long" });
  els.search.addEventListener("input", render);
  // Refresh "played today" badges when coming back to the tab (e.g. the next morning).
  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
  loadGames();
})();
