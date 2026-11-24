# DailyHub

A browser start page that gathers your daily games into cards sorted by your last visit, plus a catalog of dailies to discover and a form to suggest new ones.

## Features

- **My dailies** — games you've opened from DailyHub, sorted by your most recent visit, with a "played today" badge and a daily progress counter.
- **Discover** — every approved game you haven't played yet (GeoGuessr Daily Challenge, TimeGuessr, Metrodoku, …).
- **Suggest a game** — anyone can submit a name and URL. Suggestions are stored as `pending`, the maintainer gets an email with **Accept** / **Deny** buttons, and approved games appear for everyone.
- **No account needed** — your visit history stays in your browser (`localStorage`).
- Light and dark themes, follows your system setting.

## Architecture

```
Browser (static HTML/CSS/JS) ──GET approved games──▶ Supabase REST API (Postgres + RLS)
                             ──POST pending suggestion──▶

New pending row ──trigger (pg_net)──▶ Edge Function notify-suggestion ──Resend──▶ maintainer email
Email button ──▶ moderate.html (GitHub Pages) ──confirm──▶ Edge Function moderate ──▶ approve / delete
```

| Part | Choice |
|---|---|
| Front end | Plain HTML/CSS/JS, no build step, hosted on GitHub Pages |
| Database | Supabase, a single `games` table, called through its REST API with `fetch` |
| Visit history | `localStorage` in the user's browser |
| Previews | The site's logo (favicon), or a custom image if `preview_url` is set |
| Moderation | Email with signed Accept/Deny links (Resend), or manually in the Supabase Table Editor |

### `games` table

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `name` | `text` | 2–80 characters |
| `url` | `text` | Unique, must start with `http(s)://` |
| `preview_url` | `text` | Optional preview image (`https://` only) |
| `status` | `text` | `pending` or `approved` |
| `created_at` | `timestamptz` | Defaults to `now()` |

### Security (Row Level Security)

- Anonymous users can **select** only rows where `status = 'approved'`.
- Anonymous users can **insert** only rows where `status = 'pending'` and `preview_url` is empty.
- No update or delete from the client. The publishable key in `config.js` is therefore safe to commit.
- The form also has a honeypot field and a one-minute client-side cooldown.

### Moderation security

- Secrets (`webhook_secret`, `moderation_secret`) and the admin email live in `private.config`, a schema that the REST API doesn't expose. They are generated inside the database and never committed.
- Edge Functions read them through `get_moderation_config()`, which only the service role can execute.
- `notify-suggestion` only accepts calls carrying the webhook secret (sent by the trigger).
- Email links are signed with HMAC-SHA256 over `id:action`. A link can't be forged or reused for another game.
- The email buttons open a confirmation page; nothing changes until you click **Confirm**. This protects against mail scanners that pre-open links.

## Project layout

```
index.html                     page structure and card template
style.css                      styles (light + dark)
app.js                         data loading, rendering, visits, suggestion form
config.js                      Supabase URL and publishable key
moderate.html                  confirmation page opened from the email buttons
supabase/migrations/           table, RLS policies, moderation trigger and config
supabase/functions/            Edge Functions notify-suggestion and moderate
supabase/seed.sql              starter catalog
```

## Reviewing suggestions

**By email:** each suggestion sends an email to the admin address with **Accept** and **Deny** buttons. Click one, then confirm on the page that opens.

**Manually:** Supabase dashboard → **Table Editor** → `games` → filter on `status = pending`. Set `status` to `approved` to accept, delete the row to refuse.

## Run locally

```bash
python -m http.server 5173
```

Then open <http://localhost:5173>.

## Using it as your start page

- **Chrome / Opera:** Settings → On startup → Open a specific page → paste your DailyHub URL.
- **New tab (Chrome):** a small companion extension that redirects new tabs to DailyHub may come later. Opera doesn't let extensions replace its Speed Dial page.

## Setting up your own instance

1. Create a Supabase project and run the files in `supabase/migrations/` in order, then `supabase/seed.sql`, in the SQL editor. Adjust `functions_url` and `site_url` in `0002_moderation.sql` to your project.
2. Add your email: `insert into private.config values ('admin_email', 'you@example.com');`
3. Deploy the Edge Functions in `supabase/functions/` with JWT verification **off** (they authenticate requests themselves).
4. Create a [Resend](https://resend.com) API key and add it as the Edge Function secret `RESEND_API_KEY`. Without a custom domain, Resend only delivers to the email of your Resend account.
5. Put your project URL and publishable key in `config.js`, and your Pages origin in `ALLOWED_ORIGINS` in `supabase/functions/moderate/index.ts`.
6. Publish the repository with GitHub Pages (Settings → Pages → Deploy from a branch → `main` / root).

## License

TBD
