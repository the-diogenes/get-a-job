#!/usr/bin/env python3
"""Set GitHub Actions repo secrets from .env (never commits secrets)."""
from __future__ import annotations

import base64
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

try:
    from nacl import encoding, public
except ImportError:
    print("Run: pip install pynacl", file=sys.stderr)
    sys.exit(1)

REPO = "the-diogenes/get-a-job"
API = "https://api.github.com"
SECRET_NAMES = ("ADZUNA_APP_ID", "ADZUNA_API_KEY", "USAJOBS_API_KEY", "USAJOBS_USER_AGENT")


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r'^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"#\n]+)"?\s*$', line)
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


def encrypt_secret(public_key_b64: str, secret_value: str) -> str:
    pk = public.PublicKey(public_key_b64.encode("utf-8"), encoding.Base64Encoder())
    sealed = public.SealedBox(pk)
    encrypted = sealed.encrypt(secret_value.encode("utf-8"))
    return base64.b64encode(encrypted).decode("utf-8")


def api(method: str, url: str, token: str, body: dict | None = None) -> dict:
    data = None
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "get-a-job-secret-setup",
    }
    if body is not None:
        import json

        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return {} if not raw else __import__("json").loads(raw)
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code}: {err}", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    env = load_env(root / ".env")
    token = env.get("GITHUB_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        print("Missing GITHUB_TOKEN in .env", file=sys.stderr)
        sys.exit(1)

    pk_url = f"{API}/repos/{REPO}/actions/secrets/public-key"
    pk_data = api("GET", pk_url, token)
    key_id = pk_data["key_id"]
    public_key = pk_data["key"]

    set_any = False
    for name in SECRET_NAMES:
        value = env.get(name, "").strip()
        if not value:
            continue
        encrypted = encrypt_secret(public_key, value)
        put_url = f"{API}/repos/{REPO}/actions/secrets/{name}"
        api("PUT", put_url, token, {"encrypted_value": encrypted, "key_id": key_id})
        print(f"Set secret: {name}")
        set_any = True

    if not set_any:
        print("No ADZUNA_* (or optional USAJOBS_*) values in .env", file=sys.stderr)
        sys.exit(1)
    print("Done. Secrets are in GitHub only — not in the repo.")


if __name__ == "__main__":
    main()
