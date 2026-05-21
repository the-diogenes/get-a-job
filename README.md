# GET A JOB — Job Board

Local job collation for Salem, OR area (security + general roles), sorted by pay, with an interactive map.

**Subtitle:** *Get to it, boy!*

## Sign-in (two users)

| Username | Password | Who |
|----------|----------|-----|
| `master` | `master` | You (admin view) |
| `drJobless` | `thanksJack` | Your friend |

Progress (Applied / Called / Interview / notes) is tied to your **username** and can sync across phone, PC, and browsers via **Supabase** (free cloud database).

**Note:** Login is client-side only (not true security). Anyone can view passwords in the site source. Fine for a personal job board; don’t use for secrets.

## Cloud sync (phone + PC)

Without setup, progress only saves in **this browser** (localStorage). To sync everywhere:

1. Create a free project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run the script in `supabase/schema.sql`.
3. Copy `config.example.js` → `config.js`.
4. In Supabase **Settings → API**, paste **Project URL** and **anon public** key into `config.js`:

   ```javascript
   window.GAJ_CONFIG = {
     supabaseUrl: "https://xxxxx.supabase.co",
     supabaseAnonKey: "eyJhbG...",
   };
   ```

5. Commit `config.js` and push (the anon key is meant to be public; the table only holds job checkboxes).

After login you should see **“Synced across devices”** under the header. Both `master` and `drJobless` get separate rows in the cloud — same login name = same data everywhere.

Re-run `supabase/schema.sql` if you already ran an older version — it now adds **message board** and **Talk to Jack** chat tables.

## Message board + Talk to Jack (live chat)

Requires the same Supabase setup as tracker sync (`config.js` + `schema.sql`).

| Who | Login | What they see |
|-----|-------|----------------|
| Jack (`drJobless`) | Board tab — post notes · **Jack** tab — “Talk to Jack” live chat |
| You (`master`) | **Inbox** tab on the main site, or **`inbox.html`** (desktop console) |

- **Board:** Jack leaves threads; you reply and mark resolved from Inbox.
- **Live chat:** Jack’s first message creates/opens a session and can email you (see below). You reply from Inbox; Jack gets an on-page toast + badge when you’re not on the chat tab (polling + Supabase Realtime).
- **Email ping:** Optional [EmailJS](https://www.emailjs.com) — add `emailjsPublicKey`, `emailjsServiceId`, `emailjsTemplateId` to `config.js`. Template variables: `{{to_email}}`, `{{from_name}}`, `{{message}}`, `{{session_id}}`, `{{reply_url}}`. Set `notifyEmail` to `john.raymond.jr@gmail.com` (default in example).

## Live job aggregator (`live.html`)

The **main board** is hand-curated (some links may be old). The **Live feed** pulls real postings from the last **14 days only**.

### Setup (one time, ~10 min)

1. Sign up free at [developer.adzuna.com](https://developer.adzuna.com/signup) → get `app_id` + `app_key`.
2. (Optional) [USAJobs API key](https://developer.usajobs.gov/apirequest/) for federal posts.
3. Add to `.env` (see `.env.example`).
4. Run locally:
   ```powershell
   python scripts/fetch_live_jobs.py
   ```
5. Commit `data/live-jobs.json` and push.

### Automatic daily updates (GitHub)

In your repo **Settings → Secrets → Actions**, add:

| Secret | Value |
|--------|--------|
| `ADZUNA_APP_ID` | From Adzuna |
| `ADZUNA_API_KEY` | From Adzuna |
| `USAJOBS_API_KEY` | Optional |
| `USAJOBS_USER_AGENT` | Your email (required by USAJobs) |

Workflow `.github/workflows/fetch-live-jobs.yml` runs daily and commits fresh `data/live-jobs.json`.

### What it searches

Security officer, guard, loss prevention, armed, corrections, warehouse, forklift, driver, custodian, retail — within **25 miles of Salem, OR**, sorted by match score and pay.

Open **Live feed** from the button on the main board header, or go to `/live.html`.

## Host on GitHub (share a link with him)

Use **GitHub Pages** — free, static, no server needed.

1. Create a new **public** repo on GitHub (e.g. `get-a-job`). Avoid spaces in the repo name.
2. In this folder, push the project:

   ```powershell
   cd "d:\Projects\Cursor\doni job"
   git init
   git add index.html css js data README.md
   git commit -m "Add Salem job board"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/get-a-job.git
   git push -u origin main
   ```

3. On GitHub: **Settings → Pages → Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: **main** / folder **/ (root)**
   - Save

4. After 1–2 minutes the site is live at:

   `https://YOUR_USERNAME.github.io/get-a-job/`

Send him that URL. Updates: edit `data/jobs.json`, commit, push — Pages refreshes in a minute or two.

**Note:** A public repo means anyone with the link can view the board. For a private list, use a private repo and share only with collaborators, or keep hosting local.

## Quick start (local)

Browsers block `fetch()` when you open `index.html` directly as a file. Use a tiny local server:

### Python (if installed)

```bash
cd "d:\Projects\Cursor\doni job"
python -m http.server 8080
```

Then open: **http://localhost:8080**

### PowerShell alternative

```powershell
cd "d:\Projects\Cursor\doni job"
python -m http.server 8080
```

## What's included

- **51 jobs** in `data/jobs.json` (target was 50; one extra included)
- Sorted by **highest pay first** (annualized for comparison)
- **Leaflet map** — click a job card to fly to the pin; click a pin to highlight the card
- Filters: security focus, south Salem, has contact, call today, listed open
- **Follow-up playbook** for when online applications get no response
- **License/requirement** notes on each card

## Easy push (no token in files)

After your first successful `git push`, Windows usually **remembers** your login.

1. Edit `data/jobs.json` (or any files).
2. Double-click **`push.bat`** or in PowerShell:

   ```powershell
   cd "d:\Projects\Cursor\doni job"
   .\push.ps1 "Describe what you changed"
   ```

Copy `.env.example` to `.env` and put your token there. **`.env` is gitignored** — never commit it.

`push.ps1` reads `GITHUB_TOKEN` from `.env` so you are not prompted every time.

## Updating jobs (batch 2: +50 more)

1. Copy an existing entry in `data/jobs.json` as a template.
2. Set `pay_min`, `pay_max`, `pay_type` (`hourly` | `monthly` | `annual`).
3. Add `lat` / `lng` (Google Maps → right-click → coordinates, or [openstreetmap.org](https://www.openstreetmap.org)).
4. Set `status`: `open` if confirmed active, `verify` if needs checking.
5. Set `priority_call: true` for jobs with a real phone/email worth calling.
6. Update `meta.verified_on` date.

## File layout

```
index.html      — main page
css/styles.css
js/app.js
data/jobs.json  — all job data + resources
README.md
```

## Notes

- Pay marked “verify” or “estimate” should be confirmed on the employer site before applying.
- Contacts marked unverified are public main lines, not guaranteed hiring managers.
- Government job URLs and closing dates change frequently — always check the official posting.
