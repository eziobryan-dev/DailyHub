# DailyHub

A browser start page that gathers your daily games into cards sorted by your last visit, plus a catalog of dailies to discover and a form to suggest new ones.

## Features

- **My dailies** — games you've opened from DailyHub, sorted by your most recent visit, with a "played today" badge and a daily progress counter.
- **Discover** — every approved game you haven't played yet (GeoGuessr Daily Challenge, TimeGuessr, Metrodoku, …).
- **Suggest a game** — anyone can submit a name and URL. Suggestions are stored as `pending` and only appear for everyone once the maintainer approves them.
- **No account needed** — your visit history stays in your browser (`localStorage`).
- Light and dark themes, follows your system setting.

## Architecture

```
Browser (static HTML/CSS/JS) ──GET approved games──▶ Supabase REST API (Postgres + RLS)
                             ──POST pending suggestion──▶
Maintainer ──approves in the Supabase dashboard (status = 'approved')──▶
```

| Part | Choice |
|---|---|
| Front end | Plain HTML/CSS/JS, no build step, hosted on GitHub Pages |
| Database | Supabase, a single `games` table, called through its REST API with `fetch` |
| Visit history | `localStorage` in the user's browser |
| Previews | `preview_url` if set, otherwise a [Microlink](https://microlink.io) screenshot, otherwise the site's favicon |
| Moderation | Manual, in the Supabase Table Editor |

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

## Project layout

```
index.html                     page structure and card template
style.css                      styles (light + dark)
app.js                         data loading, rendering, visits, suggestion form
config.js                      Supabase URL and publishable key
supabase/migrations/           table + RLS policies
supabase/seed.sql              starter catalog
```

## Reviewing suggestions

1. Open the Supabase dashboard → **Table Editor** → `games`.
2. Filter on `status = pending`.
3. To accept: set `status` to `approved` (optionally fill `preview_url`). To refuse: delete the row.

## Run locally

```bash
python -m http.server 5173
```

Then open <http://localhost:5173>.

## Using it as your start page

- **Chrome / Opera:** Settings → On startup → Open a specific page → paste your DailyHub URL.
- **New tab (Chrome):** a small companion extension that redirects new tabs to DailyHub may come later. Opera doesn't let extensions replace its Speed Dial page.

## Setting up your own instance

1. Create a Supabase project and run `supabase/migrations/0001_games.sql`, then `supabase/seed.sql`, in the SQL editor.
2. Put your project URL and publishable key in `config.js`.
3. Publish the repository with GitHub Pages (Settings → Pages → Deploy from a branch → `main` / root).

## License

TBD
