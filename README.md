# Chongqingga

Trip poll for our Chongqing and Chengdu trip (29 Dec – 5 Jan). Friends open the link, tap their name and vote where to go.

| Part | Where | What it does |
|---|---|---|
| Friends' site | `site/` | Published to GitHub Pages on every push to `main`. Plain HTML/JS, no build. |
| Database | Supabase, tables `cq_*` (`supabase/schema.sql`) | Friends can only read, sign in by name (`cq_join`) and vote (`cq_vote`). |
| Admin app | `admin/` + `admin-app/` (Electron) | Results, who voted, add/edit places and photos, friends, settings. Runs on the PC only. |
| Local helper | `server.mjs` | Serves the admin page to the Electron app and hands it the service key from `data/supabase-admin.json` (never committed). Also a full offline preview: open `http://127.0.0.1:5197/?local`. |

```bash
npm run admin   # open the admin app
```
