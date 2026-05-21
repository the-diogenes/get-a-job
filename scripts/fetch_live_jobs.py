#!/usr/bin/env python3
"""
Fetch live job listings for Salem-area board.
Sources: Adzuna API (primary), USAJobs API (optional federal).
Requires env vars — see .env.example and README.

Usage:
  python scripts/fetch_live_jobs.py
  python scripts/fetch_live_jobs.py --days 14 --max 120
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "data" / "live-jobs.json"
ENV_PATH = ROOT / ".env"

# Salem metro center (Clark Creek Village area)
SALEM_LAT = 44.9173
SALEM_LNG = -123.0048

SEARCHES = [
    {"what": "security officer", "tags": ["security"], "tier": "security"},
    {"what": "security guard", "tags": ["security"], "tier": "security"},
    {"what": "loss prevention", "tags": ["security", "retail"], "tier": "security"},
    {"what": "armed security", "tags": ["security"], "tier": "security"},
    {"what": "correctional officer", "tags": ["security", "corrections"], "tier": "security"},
    {"what": "warehouse", "tags": ["warehouse"], "tier": "general"},
    {"what": "forklift", "tags": ["warehouse"], "tier": "general"},
    {"what": "delivery driver", "tags": ["driver"], "tier": "general"},
    {"what": "custodian", "tags": ["general"], "tier": "general"},
    {"what": "retail", "tags": ["retail"], "tier": "general"},
]

EXCLUDE_TITLE = re.compile(
    r"\b(RN|LPN|NP|nurse practitioner|physician|surgeon|dentist|"
    r"pharmacist|physical therapist|OTR|SLP|BCBA|"
    r"software engineer|senior developer|data scientist|"
    r"PhD|MD required|licensed psychologist)\b",
    re.I,
)

# Adzuna "security" query also returns cyber/IT/corporate roles
CORPORATE_SECURITY = re.compile(
    r"\b(engineer|architect|analyst|developer|programmer|"
    r"product manager|project manager|branch manager|"
    r"cyber|information security|IT security|cloud security|detection engineer)\b",
    re.I,
)
PHYSICAL_SECURITY = re.compile(
    r"\b(security officer|security guard|patrol|loss prevention|"
    r"armed guard|unarmed|gate guard|access control|safety officer|"
    r"correctional|custody|bailiff|surveillance)\b",
    re.I,
)

ENTRY_LOW = re.compile(
    r"\b(no experience|entry level|entry-level|will train|"
    r"training provided|0-1 year|0 to 1 year|beginner)\b",
    re.I,
)

PAY_HOURLY = re.compile(
    r"\$(\d{1,2}(?:\.\d{2})?)\s*(?:/hr|/hour|per hour|an hour)",
    re.I,
)
PAY_ANNUAL = re.compile(
    r"\$(\d{2,3}(?:,\d{3})?)\s*(?:/yr|/year|per year|annually)",
    re.I,
)


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def http_get_json(url: str, headers: dict | None = None) -> dict | list:
    h = {"User-Agent": "GAJ-JobBoard-LiveFetcher/1.0", **(headers or {})}
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def slug_id(title: str, company: str, url: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", f"{title}-{company}".lower()).strip("-")[:80]
    if url:
        tail = re.sub(r"[^a-z0-9]+", "", url.lower())[-12:]
        return f"live-{base}-{tail}" if tail else f"live-{base}"
    return f"live-{base}"


def parse_pay(text: str) -> tuple[float | None, float | None, str]:
    text = text or ""
    hourly = [float(m.group(1)) for m in PAY_HOURLY.finditer(text)]
    annual = []
    for m in PAY_ANNUAL.finditer(text):
        annual.append(float(m.group(1).replace(",", "")))
    if hourly:
        lo, hi = min(hourly), max(hourly)
        return lo, hi, f"${lo:.0f}–${hi:.0f}/hr"
    if annual:
        lo, hi = min(annual), max(annual)
        return lo, hi, f"${lo:,.0f}–${hi:,.0f}/yr"
    return None, None, "See listing"


def score_job(title: str, description: str, tier: str, pay_min: float | None) -> int:
    score = 50
    blob = f"{title} {description}".lower()
    if tier == "security":
        score += 25
    if ENTRY_LOW.search(blob):
        score += 15
    if pay_min and pay_min >= 22:
        score += 15
    elif pay_min and pay_min >= 18:
        score += 8
    if "license" in blob and "dpsst" in blob:
        score += 5
    if "bachelor" in blob or "master's" in blob:
        score -= 20
    if "5+ years" in blob or "10 years" in blob:
        score -= 10
    return max(0, min(100, score))


def fetch_adzuna(
    app_id: str, app_key: str, what: str, where: str, days: int, page: int = 1
) -> list[dict]:
    params = {
        "app_id": app_id,
        "app_key": app_key,
        "what": what,
        "where": where,
        "distance": 25,
        "max_days_old": days,
        "results_per_page": 50,
        "sort_by": "date",
        "content-type": "application/json",
    }
    url = (
        "https://api.adzuna.com/v1/api/jobs/us/search/"
        + str(page)
        + "?"
        + urllib.parse.urlencode(params)
    )
    data = http_get_json(url)
    return data.get("results", []) if isinstance(data, dict) else []


def adzuna_to_job(raw: dict, search_meta: dict) -> dict | None:
    title = (raw.get("title") or "").strip()
    company = (raw.get("company", {}) or {}).get("display_name") or "Unknown"
    if not title or EXCLUDE_TITLE.search(title):
        return None
    if search_meta.get("tier") == "security":
        if not PHYSICAL_SECURITY.search(title):
            return None
        if CORPORATE_SECURITY.search(title):
            return None
    desc = raw.get("description") or ""
    url = raw.get("redirect_url") or raw.get("url") or ""
    loc = raw.get("location", {}) or {}
    area = loc.get("area", []) or []
    address = ", ".join(str(x) for x in area if x) or "Salem, OR area"
    lat = float(raw.get("latitude") or SALEM_LAT)
    lng = float(raw.get("longitude") or SALEM_LNG)
    created = raw.get("created") or ""
    pay_min, pay_max, pay_display = parse_pay(desc + " " + title)
    if raw.get("salary_min"):
        try:
            pay_min = float(raw["salary_min"])
            pay_max = float(raw.get("salary_max") or pay_min)
            pay_display = f"${pay_min:,.0f}–${pay_max:,.0f}"
        except (TypeError, ValueError):
            pass
    tier = search_meta.get("tier", "general")
    match = score_job(title, desc, tier, pay_min)
    return {
        "id": slug_id(title, company, url),
        "title": title,
        "employer": company,
        "categories": search_meta.get("tags", ["general"]),
        "tags": ["live-feed", "adzuna"] + search_meta.get("tags", []),
        "pay_min": pay_min,
        "pay_max": pay_max,
        "pay_type": "hourly" if pay_min and pay_min < 200 else "annual",
        "pay_display": pay_display,
        "match_score": match,
        "match_tier": "high" if match >= 75 else "medium" if match >= 55 else "bridge",
        "address": address,
        "lat": lat,
        "lng": lng,
        "south_salem": lat < 44.93 and lng > -123.04,
        "apply_url": url,
        "posted": created[:10] if created else None,
        "source": "adzuna",
        "source_query": search_meta.get("what"),
        "status": "open",
        "priority_call": False,
        "experience_pitch": "Live listing — confirm still open before applying.",
        "licenses_required": [],
    }


def fetch_usajobs(api_key: str, user_agent: str, keyword: str, days: int) -> list[dict]:
    """Federal jobs near Salem / Oregon with security-ish keywords."""
    params = {
        "Keyword": keyword,
        "LocationName": "Salem",
        "ResultsPerPage": 25,
        "DatePosted": min(days, 30),
    }
    url = "https://data.usajobs.gov/api/Search?" + urllib.parse.urlencode(params)
    headers = {
        "Host": "data.usajobs.gov",
        "User-Agent": user_agent,
        "Authorization-Key": api_key,
    }
    data = http_get_json(url, headers)
    items = data.get("SearchResult", {}).get("SearchResultItems", []) or []
    jobs = []
    for item in items:
        d = item.get("MatchedObjectDescriptor", {})
        title = d.get("PositionTitle", "")
        if not title or EXCLUDE_TITLE.search(title):
            continue
        org = d.get("OrganizationName", "Federal")
        url = ""
        for link in d.get("PositionURI", []) or []:
            if isinstance(link, str):
                url = link
                break
        if not url:
            url = d.get("ApplyURI") or d.get("PositionFormattedDescription", [{}])[0].get(
                "PositionURL", ""
            )
        rem = d.get("PositionRemuneration", [{}])
        pay_display = "Federal pay scale — see posting"
        pay_min = pay_max = None
        if rem and isinstance(rem[0], dict):
            mn = rem[0].get("MinimumRange")
            mx = rem[0].get("MaximumRange")
            if mn:
                pay_display = f"${mn}–${mx}/yr" if mx else f"from ${mn}/yr"
                try:
                    pay_min = float(str(mn).replace(",", ""))
                    pay_max = float(str(mx or mn).replace(",", ""))
                except ValueError:
                    pass
        locs = d.get("PositionLocationDisplay", ["Salem, OR"]) or ["Salem, OR"]
        address = locs[0] if locs else "Salem, OR"
        pub = d.get("PublicationStartDate", "")
        desc = ""
        for block in d.get("UserArea", {}).get("Details", {}).get("JobSummary", "") or []:
            desc += str(block)
        match = score_job(title, desc, "security", pay_min)
        jobs.append(
            {
                "id": slug_id(title, org, url or title),
                "title": title,
                "employer": org,
                "categories": ["federal", "security"],
                "tags": ["live-feed", "usajobs", "federal"],
                "pay_min": pay_min,
                "pay_max": pay_max,
                "pay_type": "annual",
                "pay_display": pay_display,
                "match_score": match,
                "match_tier": "high" if match >= 70 else "medium",
                "address": address,
                "lat": SALEM_LAT,
                "lng": SALEM_LNG,
                "south_salem": False,
                "apply_url": url or "https://www.usajobs.gov/",
                "posted": pub[:10] if pub else None,
                "source": "usajobs",
                "source_query": keyword,
                "status": "open",
                "priority_call": False,
                "experience_pitch": "Federal posting — USAJobs application required.",
                "licenses_required": [],
            }
        )
    return jobs


def dedupe_jobs(jobs: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for j in jobs:
        key = (j.get("apply_url") or "") + "|" + (j.get("title") or "").lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(j)
    return out


def main() -> int:
    load_dotenv(ENV_PATH)
    days = int(os.environ.get("LIVE_MAX_DAYS", "14"))
    if "--days" in sys.argv:
        days = int(sys.argv[sys.argv.index("--days") + 1])
    max_jobs = int(os.environ.get("LIVE_MAX_JOBS", "150"))
    if "--max" in sys.argv:
        max_jobs = int(sys.argv[sys.argv.index("--max") + 1])

    where = os.environ.get("LIVE_SEARCH_LOCATION", "Salem, OR")
    adzuna_id = os.environ.get("ADZUNA_APP_ID", "")
    adzuna_key = os.environ.get("ADZUNA_API_KEY", "")
    usajobs_key = os.environ.get("USAJOBS_API_KEY", "")
    usajobs_ua = os.environ.get("USAJOBS_USER_AGENT", "contact@example.com")

    sources: list[str] = []
    errors: list[str] = []
    all_jobs: list[dict] = []

    if adzuna_id and adzuna_key:
        for spec in SEARCHES:
            try:
                rows = fetch_adzuna(adzuna_id, adzuna_key, spec["what"], where, days)
                for raw in rows:
                    job = adzuna_to_job(raw, spec)
                    if job:
                        all_jobs.append(job)
                sources.append(f"adzuna:{spec['what']}")
            except Exception as e:
                errors.append(f"Adzuna '{spec['what']}': {e}")
    else:
        errors.append(
            "Adzuna not configured — set ADZUNA_APP_ID and ADZUNA_API_KEY in .env (free at developer.adzuna.com)"
        )

    if usajobs_key:
        for kw in ["security", "correctional officer", "police"]:
            try:
                all_jobs.extend(fetch_usajobs(usajobs_key, usajobs_ua, kw, days))
                sources.append(f"usajobs:{kw}")
            except Exception as e:
                errors.append(f"USAJobs '{kw}': {e}")
    else:
        errors.append(
            "USAJobs optional — set USAJOBS_API_KEY + USAJOBS_USER_AGENT (email) at developer.usajobs.gov"
        )

    all_jobs = dedupe_jobs(all_jobs)
    all_jobs.sort(
        key=lambda j: (
            -(j.get("match_score") or 0),
            -(j.get("pay_min") or 0),
        )
    )
    all_jobs = all_jobs[:max_jobs]

    payload = {
        "meta": {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "area": where,
            "max_days_old": days,
            "sources_used": sources,
            "count": len(all_jobs),
            "errors": errors,
            "note": "Live aggregator — listings from last "
            + str(days)
            + " days only. Always confirm on employer site before applying.",
        },
        "jobs": all_jobs,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {len(all_jobs)} jobs to {OUT_PATH}")
    if errors:
        print("Notes:")
        for e in errors:
            print(f"  - {e}")
    return 0 if all_jobs else 1


if __name__ == "__main__":
    raise SystemExit(main())
