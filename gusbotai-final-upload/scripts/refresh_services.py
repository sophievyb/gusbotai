#!/usr/bin/env python3
from __future__ import annotations

import json
import ssl
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, request


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "docs" / "data" / "services.json"


def probe_url(url: str, timeout: int = 20) -> tuple[str, int, str]:
    if not url:
        return "unknown", 0, ""
    req = request.Request(url, headers={"User-Agent": "gusbotai-refresh/1.0"})
    context = ssl._create_unverified_context()
    try:
        with request.urlopen(req, timeout=timeout, context=context) as response:
            status = int(getattr(response, "status", 200))
            if 200 <= status < 400:
                return "ok", status, ""
            return "error", status, f"Unexpected HTTP status {status}"
    except error.HTTPError as exc:
        code = int(exc.code)
        if code in {401, 403}:
            return "partial", code, f"HTTPError {code}"
        return "error", code, f"HTTPError {code}"
    except Exception as exc:
        return "error", 0, str(exc)


def refresh_item(item: dict) -> dict:
    if str(item.get("refresh_enabled", "yes")).lower() == "no":
        return item

    site_status, site_code, site_note = probe_url(item.get("url", ""))
    final_status = site_status
    notes: list[str] = []
    if site_note:
        notes.append(f"site: {site_note}")

    status_url = item.get("status_url", "")
    if status_url:
        status_status, _, status_note = probe_url(status_url)
        if status_status == "error" and final_status == "ok":
            final_status = "partial"
        elif status_status == "error":
            final_status = "error"
        elif status_status == "partial" and final_status == "ok":
            final_status = "partial"
        if status_note:
            notes.append(f"status_url: {status_note}")

    item["last_auto_refresh"] = datetime.now(timezone.utc).date().isoformat()
    item["last_auto_status"] = final_status
    item["last_auto_http_code"] = site_code
    item["last_auto_note"] = "; ".join(notes)
    return item


def main() -> None:
    payload = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    payload["items"] = [refresh_item(item) for item in payload.get("items", [])]
    DATA_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
