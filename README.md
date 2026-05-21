# GET A JOB — Job Board

Local job collation for Salem, OR area (security + general roles), sorted by pay, with an interactive map.

**Subtitle:** *Get to it, boy!*

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
