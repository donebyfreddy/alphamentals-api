import argparse
import asyncio
import hashlib
import json
import logging
import re
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright

LOGGER = logging.getLogger("myfxbook_calendar")
MYFXBOOK_URL = "https://www.myfxbook.com/es/forex-economic-calendar"
DEFAULT_TIMEZONE = ZoneInfo("Europe/Madrid")
ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
TODAY_CACHE_FILE = DATA_DIR / "economic_calendar_today.json"
WEEK_CACHE_FILE = DATA_DIR / "economic_calendar_week.json"

MONTHS = {
    "ene": 1,
    "enero": 1,
    "jan": 1,
    "january": 1,
    "feb": 2,
    "febrero": 2,
    "february": 2,
    "mar": 3,
    "marzo": 3,
    "march": 3,
    "apr": 4,
    "abril": 4,
    "april": 4,
    "may": 5,
    "mayo": 5,
    "jun": 6,
    "junio": 6,
    "june": 6,
    "jul": 7,
    "julio": 7,
    "july": 7,
    "ago": 8,
    "agosto": 8,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "septiembre": 9,
    "september": 9,
    "oct": 10,
    "octubre": 10,
    "october": 10,
    "nov": 11,
    "noviembre": 11,
    "november": 11,
    "dic": 12,
    "diciembre": 12,
    "dec": 12,
    "december": 12,
}

CURRENCY_CODES = {
    "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY", "CNH",
    "SEK", "NOK", "MXN", "BRL", "INR", "TRY", "PLN", "ZAR", "HKD", "SGD",
    "XAU", "XAG",
}

DATE_PATTERNS = [
    re.compile(r"(?P<day>\d{1,2})\s+(?P<month>[A-Za-záéíóúñ\.]+)(?:\s+(?P<year>\d{4}))?", re.IGNORECASE),
    re.compile(r"(?P<month>[A-Za-záéíóúñ\.]+)\s+(?P<day>\d{1,2})(?:,\s*(?P<year>\d{4}))?", re.IGNORECASE),
]
TIME_PATTERN = re.compile(r"\b(?P<hour>\d{1,2}):(?P<minute>\d{2})\b")


@dataclass
class CalendarEvent:
    id: str
    date: str
    time: str | None
    datetime: str | None
    currency: str | None
    country: str | None
    impact: str
    event_name: str
    actual: str | None
    forecast: str | None
    previous: str | None
    source: str
    url: str


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\xa0", " ")).strip()


def month_from_token(token: str) -> int | None:
    cleaned = normalize_text(token).lower().replace(".", "")
    return MONTHS.get(cleaned)


def parse_date_label(value: str, today: date) -> date | None:
    text = normalize_text(value).lower()
    if not text:
        return None
    if "hoy" in text or text == "today":
        return today
    if "mañana" in text or "tomorrow" in text:
        return today + timedelta(days=1)

    for pattern in DATE_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        month = month_from_token(match.group("month"))
        if month is None:
            continue
        day = int(match.group("day"))
        year = int(match.group("year")) if match.groupdict().get("year") else today.year
        try:
            parsed = date(year, month, day)
        except ValueError:
            continue
        if parsed < today - timedelta(days=14):
            try:
                return date(year + 1, month, day)
            except ValueError:
                return parsed
        return parsed
    return None


def parse_time_label(value: str) -> str | None:
    text = normalize_text(value)
    if not text:
        return None
    lowered = text.lower()
    if lowered in {"todo el día", "all day", "tentative", "tentativo"}:
        return None
    match = TIME_PATTERN.search(text)
    if not match:
        return None
    hour = int(match.group("hour"))
    minute = int(match.group("minute"))
    if hour > 23 or minute > 59:
        return None
    return f"{hour:02d}:{minute:02d}"


def classify_impact(*values: str) -> str:
    haystack = " ".join(normalize_text(value).lower() for value in values if value)
    if not haystack:
        return "medium"
    if any(token in haystack for token in ("high", "alto", "strong", "fuerte", "3 bulls", "bull3")):
        return "high"
    if any(token in haystack for token in ("low", "bajo", "weak", "débil", "1 bull", "bull1")):
        return "low"
    if any(token in haystack for token in ("medium", "med", "medio", "moderate", "2 bulls", "bull2")):
        return "medium"
    return "medium"


def looks_like_value(value: str) -> bool:
    text = normalize_text(value)
    if not text:
        return False
    if text in {"-", "--", "N/A"}:
        return True
    if any(char.isdigit() for char in text):
        return True
    return any(token in text.lower() for token in ("k", "m", "b", "%", "pts", "pips"))


def infer_currency(cells: list[str]) -> str | None:
    for cell in cells:
      text = normalize_text(cell).upper()
      if text in CURRENCY_CODES:
          return text
      match = re.search(r"\b([A-Z]{3})\b", text)
      if match and match.group(1) in CURRENCY_CODES:
          return match.group(1)
    return None


def infer_country(cells: list[str], currency: str | None) -> str | None:
    for cell in cells:
        text = normalize_text(cell)
        if not text:
            continue
        upper = text.upper()
        if text == currency or upper in CURRENCY_CODES:
            continue
        if parse_time_label(text):
            continue
        if looks_like_value(text):
            continue
        if len(text) > 2 and len(text) < 40:
            return text
    return None


def infer_actual_forecast_previous(cells: list[str]) -> tuple[str | None, str | None, str | None]:
    values = [normalize_text(cell) for cell in cells if looks_like_value(cell)]
    if not values:
        return None, None, None
    trimmed = values[-3:]
    if len(trimmed) == 1:
        return trimmed[0], None, None
    if len(trimmed) == 2:
        return trimmed[0], trimmed[1], None
    return trimmed[0], trimmed[1], trimmed[2]


def infer_event_name(cells: list[str], currency: str | None, country: str | None) -> str:
    candidates: list[str] = []
    for cell in cells:
        text = normalize_text(cell)
        if not text:
            continue
        if text == currency or text == country:
            continue
        if parse_time_label(text):
            continue
        if parse_date_label(text, datetime.now(DEFAULT_TIMEZONE).date()):
            continue
        if looks_like_value(text):
            continue
        if len(text) > 2:
            candidates.append(text)
    if not candidates:
        return "Economic Event"
    candidates.sort(key=len, reverse=True)
    return candidates[0]


def build_event_id(parts: list[str]) -> str:
    digest = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()
    return f"myfxbook-{digest[:16]}"


def parse_rows(raw_rows: list[dict[str, Any]], today: date) -> list[CalendarEvent]:
    events: list[CalendarEvent] = []
    current_date = today

    for row in raw_rows:
        cells = [normalize_text(value) for value in row.get("cells", []) if normalize_text(value)]
        row_text = normalize_text(row.get("text", ""))
        combined = " | ".join(cells) if cells else row_text
        parsed_date = parse_date_label(combined, today)
        if parsed_date:
            current_date = parsed_date
        if len(cells) < 3:
            continue

        time_value = next((parse_time_label(cell) for cell in cells if parse_time_label(cell)), None)
        currency = infer_currency(cells)
        country = infer_country(cells, currency)
        impact = classify_impact(row.get("impactHint", ""), row.get("className", ""), combined)
        event_name = infer_event_name(cells, currency, country)
        actual, forecast, previous = infer_actual_forecast_previous(cells)
        event_datetime = None
        if time_value:
            event_datetime = datetime.combine(current_date, datetime.strptime(time_value, "%H:%M").time(), tzinfo=DEFAULT_TIMEZONE).isoformat()

        if not event_name or (not currency and not country):
            continue

        event = CalendarEvent(
            id=build_event_id([current_date.isoformat(), time_value or "", currency or "", event_name]),
            date=current_date.isoformat(),
            time=time_value,
            datetime=event_datetime,
            currency=currency,
            country=country,
            impact=impact,
            event_name=event_name,
            actual=actual,
            forecast=forecast,
            previous=previous,
            source="myfxbook-playwright",
            url=MYFXBOOK_URL,
        )
        events.append(event)

    deduped: dict[str, CalendarEvent] = {}
    for event in events:
        deduped[event.id] = event
    return sorted(deduped.values(), key=lambda item: (item.date, item.time or "99:99", item.event_name))


async def dismiss_overlays(page: Any) -> None:
    selectors = [
        "button:has-text('Aceptar')",
        "button:has-text('Accept')",
        "button:has-text('Entendido')",
        "button:has-text('Got it')",
        "[aria-label='close']",
        "[aria-label='Cerrar']",
        ".fc-button.fc-cta-consent",
        ".cookie-accept",
        ".close",
    ]
    for selector in selectors:
        try:
            locator = page.locator(selector).first
            if await locator.is_visible(timeout=500):
                await locator.click(timeout=1000)
                await page.wait_for_timeout(300)
        except Exception:
            continue


async def activate_period(page: Any, period: str) -> None:
    labels = {
        "today": ["Hoy", "Today"],
        "week": ["Esta semana", "This Week", "Semana"],
    }[period]
    for label in labels:
        try:
            locator = page.get_by_text(label, exact=False).first
            if await locator.is_visible(timeout=800):
                await locator.click(timeout=1500)
                await page.wait_for_timeout(1200)
                return
        except Exception:
            continue


async def extract_raw_rows(page: Any) -> list[dict[str, Any]]:
    selectors = [
        "table tbody tr",
        "table tr",
        "[role='row']",
        ".economicCalendarRow",
        ".calendar-row",
    ]
    for selector in selectors:
        try:
            locator = page.locator(selector)
            count = await locator.count()
            if count < 5:
                continue
            rows = await locator.evaluate_all(
                """
                (elements) => elements.map((row) => {
                  const cellTexts = Array.from(row.querySelectorAll('th,td'))
                    .map((cell) => (cell.innerText || cell.textContent || '').trim())
                    .filter(Boolean);
                  const impactHints = Array.from(row.querySelectorAll('[class*="impact"], .impact, i, svg, [title], [aria-label]'))
                    .map((node) => `${node.getAttribute('class') || ''} ${node.getAttribute('title') || ''} ${node.getAttribute('aria-label') || ''}`)
                    .join(' ');
                  return {
                    text: (row.innerText || row.textContent || '').trim(),
                    className: row.className || '',
                    impactHint: impactHints,
                    cells: cellTexts,
                  };
                })
                """
            )
            if rows:
                return rows
        except Exception:
            continue
    return []


async def scrape_period(page: Any, period: str, today: date) -> list[CalendarEvent]:
    await activate_period(page, period)
    await dismiss_overlays(page)
    await page.wait_for_timeout(1000)
    raw_rows = await extract_raw_rows(page)
    events = parse_rows(raw_rows, today)
    if period == "today":
        return [event for event in events if event.date == today.isoformat()]
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    return [event for event in events if week_start <= date.fromisoformat(event.date) <= week_end]


async def scrape_calendar_bundle(timeout_ms: int, retries: int) -> dict[str, Any]:
    today = datetime.now(DEFAULT_TIMEZONE).date()
    last_error: Exception | None = None

    for attempt in range(1, retries + 1):
        try:
            LOGGER.info("myfxbook scrape started", extra={"attempt": attempt, "url": MYFXBOOK_URL})
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(headless=True, timeout=timeout_ms)
                context = await browser.new_context(
                    locale="es-ES",
                    timezone_id="Europe/Madrid",
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
                )
                page = await context.new_page()
                page.set_default_timeout(timeout_ms)
                await page.goto(MYFXBOOK_URL, wait_until="domcontentloaded", timeout=timeout_ms)
                await page.wait_for_load_state("networkidle", timeout=min(timeout_ms, 12000))
                await dismiss_overlays(page)

                today_events = await scrape_period(page, "today", today)
                week_events = await scrape_period(page, "week", today)

                await context.close()
                await browser.close()

                if not week_events and not today_events:
                    raise RuntimeError("No economic calendar events were parsed from the MyFXBook page.")

                return {
                    "ok": True,
                    "generated_at": datetime.now(DEFAULT_TIMEZONE).isoformat(),
                    "today": [asdict(event) for event in today_events],
                    "week": [asdict(event) for event in week_events or today_events],
                    "source": "live",
                    "error": None,
                }
        except (PlaywrightTimeoutError, RuntimeError, Exception) as exc:
            last_error = exc
            LOGGER.warning("myfxbook scrape attempt failed", extra={"attempt": attempt, "error": str(exc)})
            await asyncio.sleep(1.0 * attempt)

    raise RuntimeError(str(last_error) if last_error else "Unknown MyFXBook scraping failure")


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def write_cache(path: Path, payload: dict[str, Any]) -> None:
    ensure_data_dir()
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def read_cache(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        LOGGER.warning("failed to read cache", extra={"path": str(path), "error": str(exc)})
        return None


def build_cache_payload(period: str, events: list[dict[str, Any]], generated_at: str, error: str | None = None) -> dict[str, Any]:
    return {
        "period": period,
        "last_updated": generated_at,
        "source": "myfxbook-playwright",
        "count": len(events),
        "error": error,
        "events": events,
    }


async def get_calendar_bundle(force_refresh: bool = False, timeout_ms: int = 25000, retries: int = 3) -> dict[str, Any]:
    today_cache = read_cache(TODAY_CACHE_FILE)
    week_cache = read_cache(WEEK_CACHE_FILE)

    if not force_refresh and today_cache and week_cache:
        return {
            "ok": True,
            "source": "cache",
            "generated_at": max(today_cache.get("last_updated", ""), week_cache.get("last_updated", "")),
            "today": today_cache,
            "week": week_cache,
            "error": None,
        }

    try:
        fresh = await scrape_calendar_bundle(timeout_ms=timeout_ms, retries=retries)
        today_payload = build_cache_payload("today", fresh["today"], fresh["generated_at"])
        week_payload = build_cache_payload("week", fresh["week"], fresh["generated_at"])
        write_cache(TODAY_CACHE_FILE, today_payload)
        write_cache(WEEK_CACHE_FILE, week_payload)
        return {
            "ok": True,
            "source": "live",
            "generated_at": fresh["generated_at"],
            "today": today_payload,
            "week": week_payload,
            "error": None,
        }
    except Exception as exc:
        error_message = str(exc)
        LOGGER.error("myfxbook scrape failed, attempting cache fallback", extra={"error": error_message})
        if today_cache or week_cache:
            return {
                "ok": bool(today_cache or week_cache),
                "source": "cache_fallback",
                "generated_at": max(
                    today_cache.get("last_updated", "") if today_cache else "",
                    week_cache.get("last_updated", "") if week_cache else "",
                ),
                "today": today_cache or build_cache_payload("today", [], datetime.now(DEFAULT_TIMEZONE).isoformat(), error_message),
                "week": week_cache or build_cache_payload("week", [], datetime.now(DEFAULT_TIMEZONE).isoformat(), error_message),
                "error": error_message,
            }
        raise


async def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape MyFXBook economic calendar using Playwright.")
    parser.add_argument("--refresh", action="store_true", help="Force a fresh scrape instead of reading cache.")
    parser.add_argument("--timeout-ms", type=int, default=25000)
    parser.add_argument("--retries", type=int, default=3)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="[%(name)s] %(levelname)s %(message)s")

    bundle = await get_calendar_bundle(force_refresh=args.refresh, timeout_ms=args.timeout_ms, retries=args.retries)
    print(json.dumps(bundle, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
