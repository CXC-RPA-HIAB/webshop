"""
Attach Playwright Inspector to the bot Chrome that is already running on CDP.

Use this instead of `playwright codegen --user-data-dir ...` — a second Chrome
cannot open the same profile (exit code 21). The bot keeps one Chrome on
`cdp_port` (default 9222); this script connects to it and records from the
current tabs (signed-in session, impersonator, etc.).
"""

from __future__ import annotations

import sys
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright

from config_loader import load_config


def _cdp_ready(cdp_url: str, timeout: float = 3.0) -> bool:
    try:
        with urllib.request.urlopen(
            f"{cdp_url.rstrip('/')}/json/version", timeout=timeout
        ) as resp:
            return resp.status == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def _pick_webshop_page(context):
    for pg in list(context.pages):
        url = (pg.url or "").lower()
        if "webshop.hiab.com" in url or "hiab.com" in url:
            return pg
    return context.pages[0] if context.pages else None


def main() -> int:
    config = load_config()
    port = config.getint("webshop", "cdp_port", fallback=9222)
    if "--port" in sys.argv:
        idx = sys.argv.index("--port")
        port = int(sys.argv[idx + 1])
    cdp_url = f"http://127.0.0.1:{port}"

    if not _cdp_ready(cdp_url):
        print(
            f"No Chrome listening on CDP {cdp_url}.\n\n"
            "Leave one bot Chrome running, then run this again:\n"
            "  python main.py --login          (visible window, sign-in / MFA)\n"
            "  python main.py --unattended     (headless; same CDP port)\n\n"
            "Do not use playwright codegen with --user-data-dir on static/browser_profile.",
            file=sys.stderr,
        )
        return 1

    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(cdp_url)
        if not browser.contexts:
            print("Connected, but Chrome has no browser context.", file=sys.stderr)
            return 1
        context = browser.contexts[0]
        page = _pick_webshop_page(context)
        if page is None:
            print(
                "No open tab in the bot Chrome. Open webshop in that window, then retry.",
                file=sys.stderr,
            )
            return 1

        print(f"Inspector → {page.url!r} (CDP {cdp_url})")
        print("Record in the Playwright Inspector. Closing Inspector exits this script only; Chrome stays up.")
        page.pause()

        # Disconnect Playwright only (same as bot stop(keep_browser=True)).
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
