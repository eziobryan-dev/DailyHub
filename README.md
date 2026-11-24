# DailyHub

A browser start page that gathers your daily games into cards sorted by your last visit, plus a catalog of dailies to discover and a form to suggest new ones.

## Features

- **My dailies** — games you've opened from DailyHub, sorted by your most recent visit, with a "played today" badge and a daily progress counter.
- **Discover** — every approved game you haven't played yet (GeoGuessr Daily Challenge, TimeGuessr, Metrodoku, …).
- **Suggest a game** — anyone can submit a name and URL. Suggestions are stored as `pending` until the admin approves them.
- **Admin page** (`admin.html`) — email + password login. Review suggestions, add, edit or delete games.
- **No account needed** for players — your visit history stays in your browser (`localStorage`).
- Light and dark themes, follows your system setting.

## Architecture

```
Browser (static HTML/CSS/JS) ──GET approved games──────▶ Supabase REST API (Postgres + RLS)
                             ──POST pending suggestion──▶
admin.html ──Supabase Auth (email + password)──▶ session ──approve / edit / delete──▶ (RLS: admins only)
```

| Part | Choice |
|---|---|
| Front end | Plain HTML/CSS/JS, no build step, no third-party script, hosted on GitHub Pages |
| Database | Supabase, a single `games` table, called through its REST API with `fetch` |
| Visit history | `localStorage` in the user's browser |
| Previews | The site's logo (favicon), or a custom image if `preview_url` is set |
| Moderation | `admin.html`, Supabase Auth with email + password |

### `games` table

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `name` | `text` | 2–80 characters |
| `url` | `text` | Unique, must start with `http(s)://` |
| `preview_url` | `text` | Optional preview image (`https://` only) |
| `status` | `text` | `pending` or `approved` |
| `created_at` | `timestamptz` | Defaults to `now()` |

## Security

All access control lives in the database (Row Level Security). The admin page holds no secret: anyone can open it, but nobody else can do anything with it.

**Visitors (anon key)**
- Can **select** only rows where `status = 'approved'`.
- Can **insert** only rows where `status = 'pending'` and `preview_url` is empty.
- Cannot update or delete. The publishable key in `config.js` is therefore safe to commit.
- The suggestion form also has a honeypot field and a one-minute client-side cooldown.

**Admin**
- `private.is_admin()` is true only when the signed-in user's email is listed in `private.admins` and confirmed.
- Only then can the user see pending rows and insert, update or delete games. Any other account gets the same rights as a visitor.
- Sign-ups are disabled in Supabase Auth, and Supabase rate-limits login attempts.
- `private` isn't exposed by the REST API; `private.admins` isn't readable by any API role.

**Admin page hardening**
- Strict Content-Security-Policy: own scripts and styles only, network calls only to the Supabase project, no inline script.
- No third-party library: auth and data calls use `fetch` on the Supabase REST endpoints.
- Session kept in `sessionStorage` (gone when the tab closes) and signed out after 30 minutes of inactivity.
- User content is always rendered as text; only `http(s)` links are made clickable.
- `noindex`, `no-referrer`, and no link to it from the public page.

## Project layout

```
index.html                     page structure and card template
style.css                      styles (light + dark)
app.js                         data loading, rendering, visits, suggestion form
admin.html / admin.css / admin.js   admin page (login, moderation)
config.js                      Supabase URL and publishable key
supabase/migrations/           table, RLS policies, admin role
supabase/seed.sql              starter catalog
```

## Admin

1. Open `admin.html` (e.g. `https://<user>.github.io/DailyHub/admin.html`).
2. Sign in with your email and password.
3. Accept or refuse pending suggestions, add games directly, edit or delete catalog entries.

## Run locally

```bash
python -m http.server 5173
```

Then open <http://localhost:5173>.

## Using it as your start page

- **Chrome / Opera:** Settings → On startup → Open a specific page → paste your DailyHub URL.
- **New tab (Chrome):** a small companion extension that redirects new tabs to DailyHub may come later. Opera doesn't let extensions replace its Speed Dial page.

## Setting up your own instance

1. Create a Supabase project and run the files in `supabase/migrations/` in order, then `supabase/seed.sql`, in the SQL editor.
2. Create your admin account: **Authentication → Users → Add user → Create new user**, with *Auto Confirm User* checked.
3. Allow it as admin: `insert into private.admins values ('you@example.com');`
4. Disable sign-ups: **Authentication → Sign In / Providers → Allow new users to sign up** off.
5. Put your project URL and publishable key in `config.js`, and your project URL in the `connect-src` of the CSP in `admin.html`.
6. Publish the repository with GitHub Pages (Settings → Pages → Deploy from a branch → `main` / root).

## License

TBD
