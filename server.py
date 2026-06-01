#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import ssl
import sqlite3
import threading
import time
from datetime import date
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error, request
from urllib.parse import parse_qs, urlparse


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static" if (BASE_DIR / "static").exists() else BASE_DIR
DB_PATH = Path(__import__("os").environ.get("APP_DB_PATH", str(BASE_DIR / "data.sqlite3")))

REGION_STATUSES = {"yes", "no", "partial", "unknown"}
CHECK_STATUSES = {"works", "fails", "partial", "unknown", "manual"}
ACCESS_TYPES = {
    "free",
    "freemium",
    "trial",
    "paid",
    "open-source",
    "school-access",
    "personal-subscription",
    "unknown",
}
BOT_STATUSES = {
    "works_without_vpn",
    "partial",
    "vpn_required",
    "not_working",
    "not_checked",
    "manual_review",
    "school_access",
    "has_alternative",
}
AUTO_REFRESH_STATUSES = {"ok", "partial", "error", "unknown"}


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            url TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'unknown',
            rf_without_vpn TEXT NOT NULL DEFAULT 'unknown',
            rb_without_vpn TEXT NOT NULL DEFAULT 'unknown',
            registration TEXT NOT NULL DEFAULT 'unknown',
            login TEXT NOT NULL DEFAULT 'unknown',
            post_login TEXT NOT NULL DEFAULT 'manual',
            free_tier TEXT NOT NULL DEFAULT 'unknown',
            phone_required TEXT NOT NULL DEFAULT 'unknown',
            card_required TEXT NOT NULL DEFAULT 'unknown',
            vpn_required TEXT NOT NULL DEFAULT 'unknown',
            alternatives TEXT NOT NULL DEFAULT '[]',
            official_support TEXT NOT NULL DEFAULT '[]',
            sources TEXT NOT NULL DEFAULT '[]',
            last_checked TEXT NOT NULL DEFAULT '',
            refresh_enabled TEXT NOT NULL DEFAULT 'yes',
            status_url TEXT NOT NULL DEFAULT '',
            last_auto_refresh TEXT NOT NULL DEFAULT '',
            last_auto_status TEXT NOT NULL DEFAULT 'unknown',
            last_auto_http_code INTEGER NOT NULL DEFAULT 0,
            last_auto_note TEXT NOT NULL DEFAULT '',
            owner TEXT NOT NULL DEFAULT '',
            response_comment TEXT NOT NULL DEFAULT '',
            bot_status TEXT NOT NULL DEFAULT 'not_checked'
        );
        """
    )
    ensure_columns(
        conn,
        [
            ("refresh_enabled", "TEXT NOT NULL DEFAULT 'yes'"),
            ("status_url", "TEXT NOT NULL DEFAULT ''"),
            ("last_auto_refresh", "TEXT NOT NULL DEFAULT ''"),
            ("last_auto_status", "TEXT NOT NULL DEFAULT 'unknown'"),
            ("last_auto_http_code", "INTEGER NOT NULL DEFAULT 0"),
            ("last_auto_note", "TEXT NOT NULL DEFAULT ''"),
        ],
    )
    seed_if_empty(conn)
    conn.commit()
    conn.close()


def ensure_columns(conn: sqlite3.Connection, columns: list[tuple[str, str]]) -> None:
    existing = {row[1] for row in conn.execute("PRAGMA table_info(services)").fetchall()}
    for name, ddl in columns:
        if name not in existing:
            conn.execute(f"ALTER TABLE services ADD COLUMN {name} {ddl}")


def seed_if_empty(conn: sqlite3.Connection) -> None:
    count = conn.execute("SELECT COUNT(*) FROM services").fetchone()[0]
    if count:
        return

    seed_rows = [
        {
            "name": "ChatGPT",
            "url": "https://chatgpt.com/",
            "category": "text",
            "rf_without_vpn": "partial",
            "rb_without_vpn": "partial",
            "registration": "partial",
            "login": "partial",
            "post_login": "manual",
            "free_tier": "freemium",
            "phone_required": "unknown",
            "card_required": "no",
            "vpn_required": "yes",
            "alternatives": ["Perplexity", "DeepSeek", "ask.chadgpt.ru"],
            "official_support": ["US", "DE", "FR"],
            "sources": ["official site", "manual check"],
            "last_checked": str(date.today()),
            "refresh_enabled": "yes",
            "status_url": "https://status.openai.com/",
            "owner": "ITGenio",
            "response_comment": "Официальную поддержку РФ/РБ нужно сверять отдельно.",
            "bot_status": "vpn_required",
        },
        {
            "name": "ask.chadgpt.ru",
            "url": "https://ask.chadgpt.ru/",
            "category": "text",
            "rf_without_vpn": "yes",
            "rb_without_vpn": "yes",
            "registration": "works",
            "login": "works",
            "post_login": "manual",
            "free_tier": "freemium",
            "phone_required": "unknown",
            "card_required": "no",
            "vpn_required": "no",
            "alternatives": ["Perplexity", "DeepSeek"],
            "official_support": [],
            "sources": ["parent memo", "internal list"],
            "last_checked": str(date.today()),
            "refresh_enabled": "yes",
            "status_url": "",
            "owner": "ITGenio",
            "response_comment": "В памятке указано, что VPN не требуется.",
            "bot_status": "works_without_vpn",
        },
        {
            "name": "Photopea",
            "url": "https://www.photopea.com/",
            "category": "design",
            "rf_without_vpn": "partial",
            "rb_without_vpn": "partial",
            "registration": "unknown",
            "login": "unknown",
            "post_login": "manual",
            "free_tier": "free",
            "phone_required": "no",
            "card_required": "no",
            "vpn_required": "unknown",
            "alternatives": ["Pixlr", "Canva", "GIMP"],
            "official_support": [],
            "sources": ["official site", "manual check"],
            "last_checked": str(date.today()),
            "refresh_enabled": "yes",
            "status_url": "",
            "owner": "methodist",
            "response_comment": "Нужно отдельно проверить экспорт и AI-функции.",
            "bot_status": "partial",
        },
    ]

    for row in seed_rows:
        upsert_service(conn, row)


def parse_json_list(value: str | list[str] | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value).split(",") if item.strip()]


def validate_payload(payload: dict) -> dict:
    cleaned = {
        "name": str(payload.get("name", "")).strip(),
        "url": str(payload.get("url", "")).strip(),
        "category": str(payload.get("category", "unknown")).strip() or "unknown",
        "rf_without_vpn": str(payload.get("rf_without_vpn", "unknown")).strip(),
        "rb_without_vpn": str(payload.get("rb_without_vpn", "unknown")).strip(),
        "registration": str(payload.get("registration", "unknown")).strip(),
        "login": str(payload.get("login", "unknown")).strip(),
        "post_login": str(payload.get("post_login", "manual")).strip(),
        "free_tier": str(payload.get("free_tier", "unknown")).strip(),
        "phone_required": str(payload.get("phone_required", "unknown")).strip(),
        "card_required": str(payload.get("card_required", "unknown")).strip(),
        "vpn_required": str(payload.get("vpn_required", "unknown")).strip(),
        "alternatives": parse_json_list(payload.get("alternatives")),
        "official_support": parse_json_list(payload.get("official_support")),
        "sources": parse_json_list(payload.get("sources")),
        "last_checked": str(payload.get("last_checked", "")).strip() or str(date.today()),
        "refresh_enabled": str(payload.get("refresh_enabled", "yes")).strip() or "yes",
        "status_url": str(payload.get("status_url", "")).strip(),
        "last_auto_refresh": str(payload.get("last_auto_refresh", "")).strip(),
        "last_auto_status": str(payload.get("last_auto_status", "unknown")).strip() or "unknown",
        "last_auto_http_code": int(payload.get("last_auto_http_code", 0) or 0),
        "last_auto_note": str(payload.get("last_auto_note", "")).strip(),
        "owner": str(payload.get("owner", "")).strip(),
        "response_comment": str(payload.get("response_comment", "")).strip(),
        "bot_status": str(payload.get("bot_status", "not_checked")).strip(),
    }

    if not cleaned["name"]:
        raise ValueError("Field 'name' is required.")
    if not cleaned["url"]:
        raise ValueError("Field 'url' is required.")
    if cleaned["rf_without_vpn"] not in REGION_STATUSES:
        raise ValueError("Invalid rf_without_vpn")
    if cleaned["rb_without_vpn"] not in REGION_STATUSES:
        raise ValueError("Invalid rb_without_vpn")
    if cleaned["registration"] not in CHECK_STATUSES:
        raise ValueError("Invalid registration")
    if cleaned["login"] not in CHECK_STATUSES:
        raise ValueError("Invalid login")
    if cleaned["post_login"] not in CHECK_STATUSES:
        raise ValueError("Invalid post_login")
    if cleaned["free_tier"] not in ACCESS_TYPES:
        raise ValueError("Invalid free_tier")
    if cleaned["bot_status"] not in BOT_STATUSES:
        raise ValueError("Invalid bot_status")
    if cleaned["last_auto_status"] not in AUTO_REFRESH_STATUSES:
        raise ValueError("Invalid last_auto_status")
    return cleaned


def upsert_service(conn: sqlite3.Connection, payload: dict) -> None:
    row = validate_payload(payload)
    conn.execute(
        """
        INSERT INTO services (
            name, url, category, rf_without_vpn, rb_without_vpn, registration, login,
            post_login, free_tier, phone_required, card_required, vpn_required,
            alternatives, official_support, sources, last_checked, refresh_enabled,
            status_url, last_auto_refresh, last_auto_status, last_auto_http_code,
            last_auto_note, owner, response_comment, bot_status
        )
        VALUES (
            :name, :url, :category, :rf_without_vpn, :rb_without_vpn, :registration, :login,
            :post_login, :free_tier, :phone_required, :card_required, :vpn_required,
            :alternatives, :official_support, :sources, :last_checked, :refresh_enabled,
            :status_url, :last_auto_refresh, :last_auto_status, :last_auto_http_code,
            :last_auto_note, :owner, :response_comment, :bot_status
        )
        ON CONFLICT(name) DO UPDATE SET
            url=excluded.url,
            category=excluded.category,
            rf_without_vpn=excluded.rf_without_vpn,
            rb_without_vpn=excluded.rb_without_vpn,
            registration=excluded.registration,
            login=excluded.login,
            post_login=excluded.post_login,
            free_tier=excluded.free_tier,
            phone_required=excluded.phone_required,
            card_required=excluded.card_required,
            vpn_required=excluded.vpn_required,
            alternatives=excluded.alternatives,
            official_support=excluded.official_support,
            sources=excluded.sources,
            last_checked=excluded.last_checked,
            refresh_enabled=excluded.refresh_enabled,
            status_url=excluded.status_url,
            last_auto_refresh=excluded.last_auto_refresh,
            last_auto_status=excluded.last_auto_status,
            last_auto_http_code=excluded.last_auto_http_code,
            last_auto_note=excluded.last_auto_note,
            owner=excluded.owner,
            response_comment=excluded.response_comment,
            bot_status=excluded.bot_status
        """,
        {
            **row,
            "alternatives": json.dumps(row["alternatives"], ensure_ascii=False),
            "official_support": json.dumps(row["official_support"], ensure_ascii=False),
            "sources": json.dumps(row["sources"], ensure_ascii=False),
        },
    )


def serialize_row(row: sqlite3.Row) -> dict:
    item = dict(row)
    for field in ("alternatives", "official_support", "sources"):
        item[field] = json.loads(item[field] or "[]")
    return item


def human_region(region: str) -> str:
    return "РФ" if region == "RF" else "РБ"


def human_region_status(status: str) -> str:
    mapping = {"yes": "да", "no": "нет", "partial": "частично", "unknown": "не проверено"}
    return mapping.get(status, "не проверено")


def get_region_status(service: dict, region: str) -> str:
    return service["rf_without_vpn"] if region == "RF" else service["rb_without_vpn"]


def build_checks_summary(service: dict) -> str:
    checked = ["сайт"]
    if service["registration"] in {"works", "partial", "fails"}:
        checked.append("регистрация")
    if service["login"] in {"works", "partial", "fails"}:
        checked.append("вход")
    if service["post_login"] in {"works", "partial", "fails"}:
        checked.append("основная функция")
    if service["free_tier"] != "unknown":
        checked.append("бесплатный тариф")
    return " / ".join(checked)


def build_reply(service: dict, region: str) -> str:
    region_name = human_region(region)
    region_status = get_region_status(service, region)
    checked_at = service["last_checked"] or "без даты"
    alternatives = ", ".join(service["alternatives"][:3])
    comment = f" {service['response_comment']}" if service["response_comment"] else ""
    checks = build_checks_summary(service)
    auto_note = build_auto_refresh_note(service)

    if service["bot_status"] == "works_without_vpn" and region_status == "yes":
        return (
            f"По последней проверке от {checked_at} сервис {service['name']} открывается "
            f"в {region_name} без VPN. Проверено: {checks}.{auto_note}{comment}"
        )
    if service["bot_status"] == "partial" or region_status == "partial":
        suffix = f" Для стабильной работы можно использовать VPN или альтернативы: {alternatives}." if alternatives else ""
        return (
            f"По последней проверке сервис {service['name']} частично доступен в {region_name}: "
            f"статус без VPN — {human_region_status(region_status)}. Проверено: {checks}. "
            f"Работу после входа и ключевые функции стоит перепроверить вручную.{suffix}{auto_note}{comment}"
        )
    if service["bot_status"] == "vpn_required" or service["vpn_required"] == "yes":
        suffix = f" Альтернатива: {alternatives}." if alternatives else ""
        return (
            f"По последней проверке для стабильной работы {service['name']} в {region_name} может "
            f"понадобиться VPN. Сайт или часть функций могут не работать без него.{suffix}{auto_note}{comment}"
        )
    if service["bot_status"] == "not_working" or region_status == "no":
        suffix = f" Можно использовать аналоги: {alternatives}." if alternatives else ""
        return (
            f"По последней проверке сервис {service['name']} в {region_name} без VPN не работает "
            f"или недоступен для стабильного использования.{suffix}{auto_note}{comment}"
        )
    if service["bot_status"] == "school_access":
        return (
            f"По сервису {service['name']} есть школьный доступ. По последней проверке от {checked_at} "
            f"стоит ориентироваться на внутренние инструкции и аккаунты школы.{auto_note}{comment}"
        )
    if service["bot_status"] == "manual_review":
        return (
            f"У сервиса {service['name']} нужна ручная проверка. Сайт может открываться, но нужно "
            f"отдельно проверить регистрацию, вход, запуск основной функции и экспорт результата "
            f"в {region_name}.{auto_note}{comment}"
        )
    return (
        f"У меня нет свежей проверки по сервису {service['name']} для {region_name}. Нужно проверить: "
        f"открывается ли сайт без VPN, работает ли вход, запускается ли основная функция, есть ли "
        f"бесплатный тариф и нужны ли карта или телефон.{auto_note}{comment}"
    )


def build_auto_refresh_note(service: dict) -> str:
    if not service.get("last_auto_refresh"):
        return ""
    status = service.get("last_auto_status", "unknown")
    checked_at = service["last_auto_refresh"]
    http_code = service.get("last_auto_http_code", 0)
    note = service.get("last_auto_note", "")
    if status == "ok":
        return f" Автопроверка сайта от {checked_at}: главная страница отвечает (HTTP {http_code})."
    if status == "partial":
        return f" Автопроверка от {checked_at}: сайт отвечает, но status/source check частично успешен. {note}".rstrip()
    if status == "error":
        return f" Автопроверка от {checked_at}: есть ошибка доступа к сайту или status URL. {note}".rstrip()
    return ""


def probe_url(url: str, timeout: int = 20) -> tuple[str, int, str]:
    req = request.Request(url, headers={"User-Agent": "AIServiceRegistryBot/1.0"})
    # Availability probe should not fail only because the local trust store is incomplete.
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


def run_daily_refresh(force: bool = False) -> dict:
    conn = get_db()
    today = str(date.today())
    rows = conn.execute(
        "SELECT * FROM services WHERE lower(refresh_enabled) != 'no' ORDER BY name"
    ).fetchall()
    refreshed = 0
    skipped = 0

    for row in rows:
        service = serialize_row(row)
        if not force and service["last_auto_refresh"] == today:
            skipped += 1
            continue

        site_status, site_code, site_note = probe_url(service["url"])
        final_status = site_status
        notes = []
        if site_note:
            notes.append(f"site: {site_note}")

        if service["status_url"]:
            status_status, _, status_note = probe_url(service["status_url"])
            if status_status == "error" and final_status == "ok":
                final_status = "partial"
            elif status_status == "error":
                final_status = "error"
            if status_note:
                notes.append(f"status_url: {status_note}")

        conn.execute(
            """
            UPDATE services
            SET last_auto_refresh = ?,
                last_auto_status = ?,
                last_auto_http_code = ?,
                last_auto_note = ?
            WHERE id = ?
            """,
            (today, final_status, site_code, "; ".join(notes), service["id"]),
        )
        refreshed += 1

    conn.commit()
    conn.close()
    return {"date": today, "refreshed": refreshed, "skipped": skipped}


def refresh_scheduler_loop() -> None:
    while True:
        try:
            result = run_daily_refresh(force=False)
            print(f"[refresh] daily refresh completed: {result}")
        except Exception as exc:
            print(f"[refresh] scheduler error: {exc}")
        time.sleep(3600)


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/services":
            self.handle_list_services(parsed)
            return
        if parsed.path.startswith("/api/services/"):
            self.handle_get_service(parsed.path.rsplit("/", 1)[-1])
            return
        if parsed.path == "/api/check":
            self.handle_check(parsed)
            return
        if parsed.path == "/api/refresh/run":
            self.handle_refresh(parsed)
            return
        if parsed.path == "/health":
            self.send_json({"ok": True})
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/services/upsert":
            self.handle_upsert()
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Endpoint not found")

    def handle_list_services(self, parsed) -> None:
        query = parse_qs(parsed.query).get("query", [""])[0].strip().lower()
        conn = get_db()
        if query:
            rows = conn.execute(
                """
                SELECT * FROM services
                WHERE lower(name) LIKE ? OR lower(category) LIKE ?
                ORDER BY name
                """,
                (f"%{query}%", f"%{query}%"),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM services ORDER BY name").fetchall()
        conn.close()
        self.send_json({"items": [serialize_row(row) for row in rows]})

    def handle_get_service(self, service_id: str) -> None:
        conn = get_db()
        if service_id.isdigit():
            row = conn.execute("SELECT * FROM services WHERE id = ?", (int(service_id),)).fetchone()
        else:
            row = conn.execute("SELECT * FROM services WHERE lower(name) = ?", (service_id.lower(),)).fetchone()
        conn.close()
        if not row:
            self.send_json({"error": "Service not found"}, HTTPStatus.NOT_FOUND)
            return
        self.send_json(serialize_row(row))

    def handle_check(self, parsed) -> None:
        params = parse_qs(parsed.query)
        name = params.get("service", [""])[0].strip()
        region = params.get("region", ["RF"])[0].strip().upper()
        if not name:
            self.send_json({"error": "Query parameter 'service' is required"}, HTTPStatus.BAD_REQUEST)
            return
        if region not in {"RF", "RB"}:
            self.send_json({"error": "Query parameter 'region' must be RF or RB"}, HTTPStatus.BAD_REQUEST)
            return
        conn = get_db()
        row = conn.execute("SELECT * FROM services WHERE lower(name) = ?", (name.lower(),)).fetchone()
        conn.close()
        if not row:
            self.send_json(
                {
                    "found": False,
                    "message": (
                        "Сервис не найден во внутренней базе. Нужна внешняя проверка или добавление карточки."
                    ),
                },
                HTTPStatus.NOT_FOUND,
            )
            return
        service = serialize_row(row)
        self.send_json(
            {
                "found": True,
                "service": service,
                "region": region,
                "reply": build_reply(service, region),
            }
        )

    def handle_upsert(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length)
        try:
            payload = json.loads(raw.decode("utf-8"))
            conn = get_db()
            upsert_service(conn, payload)
            conn.commit()
            row = conn.execute("SELECT * FROM services WHERE lower(name) = ?", (payload["name"].lower(),)).fetchone()
            conn.close()
            self.send_json({"ok": True, "item": serialize_row(row)})
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON body"}, HTTPStatus.BAD_REQUEST)

    def handle_refresh(self, parsed) -> None:
        force = parse_qs(parsed.query).get("force", ["0"])[0] == "1"
        result = run_daily_refresh(force=force)
        self.send_json({"ok": True, **result})

    def send_json(self, payload: dict, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[http] {self.address_string()} - {fmt % args}")


def run(host: str = "127.0.0.1", port: int = 8765) -> None:
    init_db()
    run_daily_refresh(force=False)
    threading.Thread(target=refresh_scheduler_loop, daemon=True).start()
    server = ThreadingHTTPServer((host, port), AppHandler)
    print(f"Serving on http://{host}:{port}")
    server.serve_forever()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="AI Service Registry web server")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=int(__import__("os").environ.get("PORT", "8765")))
    return parser.parse_args()


if __name__ == "__main__":
    cli_args = parse_args()
    run(host=cli_args.host, port=cli_args.port)
