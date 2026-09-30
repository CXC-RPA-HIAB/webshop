"""
Playwright automation client for Hiab webshop batch order.
Fully minimized procedural approach using a single pipeline function without nested helpers.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Callable, List, Optional, Sequence

from playwright.sync_api import TimeoutError as PlaywrightTimeout

from config_loader import load_config
from logging_setup import get_logger

# Ensure these imports match your project structure
from playwright.sync_api import BrowserContext, Page
from webshop import login_handler
from webshop.cart_naming import resolve_saved_cart_name

import pandas as pd
logger = get_logger()
PhaseCallback = Callable[[str, str], None]

FAILED_CONTAINER = "#uc-failed-orderlines"
_SAVED_CART_DESC = "Hiab order (automated)"
_CREATE_NEW_CART = "Create new cart"


def _create_new_cart_button(page: Page):
    return page.get_by_role("button", name=_CREATE_NEW_CART).first


def _saved_carts_panel_visible(page: Page) -> bool:
    create_btn = _create_new_cart_button(page)
    try:
        return create_btn.count() > 0 and create_btn.is_visible()
    except Exception:
        return False


def _open_saved_carts_panel(page: Page, *, timeout_ms: int = 30_000) -> None:
    """Open the Saved carts off-canvas; wait until 'Create new cart' is visible."""
    if _saved_carts_panel_visible(page):
        logger.info("Saved carts panel already open.")
        return

    toggle_selectors = (
        'button.right-off-canvas-toggle[title*="Saved carts"]:visible',
        "button.wishlist-toggle:visible",
        'button[title*="Saved carts"]:visible',
        ".right-off-canvas-toggle:visible",
    )
    deadline = time.time() + timeout_ms / 1000.0
    last_error: Exception | None = None

    while time.time() < deadline:
        if _saved_carts_panel_visible(page):
            logger.info("Saved carts panel is open.")
            return

        for selector in toggle_selectors:
            toggle = page.locator(selector).first
            try:
                if toggle.count() == 0 or not toggle.is_visible():
                    continue
                logger.info("Clicking Saved carts toggle (%s)", selector)
                toggle.click(force=True, timeout=5000)
                _create_new_cart_button(page).wait_for(state="visible", timeout=8000)
                logger.info("Saved carts panel is open.")
                return
            except Exception as exc:
                last_error = exc
                continue

        time.sleep(0.4)

    raise RuntimeError(
        "Saved carts panel did not open — 'Create new cart' never became visible. "
        f"Last click error: {last_error!r}"
    )


def _dispatch_field_events(field) -> None:
    """Notify Angular/React validators after programmatic fill."""
    field.evaluate(
        """el => {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
        }"""
    )


def _visible_wishlist_save_button(page: Page):
    """Pick the Save button the user sees — DOM may contain hidden disabled copies."""
    scoped = page.locator('div.medium-6.columns button[name="Wishlist.Save"]')
    try:
        if scoped.count() > 0 and scoped.last.is_visible():
            return scoped.last
    except Exception:
        pass

    buttons = page.locator('button[name="Wishlist.Save"]')
    try:
        count = buttons.count()
    except Exception:
        count = 0
    visible = []
    for index in range(count):
        btn = buttons.nth(index)
        try:
            if btn.is_visible():
                visible.append(btn)
        except Exception:
            continue
    if not visible:
        return None
    return visible[-1]


def _wishlist_save_is_clickable(btn) -> bool:
    try:
        return not btn.evaluate(
            """el => !!(
                el.disabled ||
                el.getAttribute('aria-disabled') === 'true' ||
                el.classList.contains('disabled')
            )"""
        )
    except Exception:
        return False


def _click_wishlist_save(page: Page, *, batch_name: str, name_input, timeout_ms: int) -> None:
    deadline = time.time() + timeout_ms / 1000.0
    last_states: list[str] = []

    while time.time() < deadline:
        save_btn = _visible_wishlist_save_button(page)
        if save_btn is None:
            last_states.append("no visible Wishlist.Save")
            time.sleep(0.25)
            continue

        clickable = _wishlist_save_is_clickable(save_btn)
        last_states.append(f"visible clickable={clickable}")
        if clickable:
            save_btn.scroll_into_view_if_needed(timeout=3000)
            logger.info("Clicking visible Wishlist.Save for cart %s", batch_name)
            try:
                save_btn.click(timeout=10_000)
            except Exception as exc:
                logger.warning("Wishlist.Save normal click failed (%s), retrying with force=True", exc)
                save_btn.click(force=True, timeout=5000)
            return
        time.sleep(0.25)

    try:
        shown = name_input.input_value()
    except Exception:
        shown = "?"
    tail = last_states[-5:] if last_states else []
    raise RuntimeError(
        f"Could not click visible Wishlist.Save for cart name {batch_name!r} "
        f"(Cart name field={shown!r}). Recent checks: {tail}"
    )


def _fill_and_save_new_cart(page: Page, batch_name: str, *, timeout_ms: int = 60_000) -> None:
    """Create saved cart dialog: name + description, then Save when enabled."""
    create_btn = _create_new_cart_button(page)
    create_btn.wait_for(state="visible", timeout=5000)
    create_btn.click()
    time.sleep(0.5)

    name_input = page.get_by_role("textbox", name="Cart name").first
    name_input.wait_for(state="visible", timeout=10_000)
    name_input.click()
    name_input.fill("")
    name_input.fill(batch_name)
    try:
        if (name_input.input_value() or "").strip() != batch_name.strip():
            name_input.press("Control+a")
            name_input.press_sequentially(batch_name, delay=25)
    except Exception:
        pass
    _dispatch_field_events(name_input)
    try:
        name_input.press("Tab")
    except Exception:
        pass

    desc = page.get_by_role("textbox", name="Cart description").first
    if desc.count() > 0:
        try:
            if desc.is_visible():
                desc.click()
                desc.fill(_SAVED_CART_DESC)
                _dispatch_field_events(desc)
                desc.press("Tab")
        except Exception:
            pass

    save_visible = _visible_wishlist_save_button(page)
    if save_visible is not None:
        save_visible.wait_for(state="visible", timeout=5000)

    _click_wishlist_save(
        page,
        batch_name=batch_name,
        name_input=name_input,
        timeout_ms=timeout_ms,
    )


def collect_failed_orderlines(page: Page) -> dict[str, str]:
    """Read the 'items have not been uploaded' panel -> {material: webshop error text}."""
    container = page.locator(FAILED_CONTAINER).first
    try:
        if container.count() == 0 or not container.is_visible():
            return {}
    except Exception:
        return {}

    found: dict[str, str] = {}
    lines = container.locator(".batchorder-orderline.failed-orderline")
    try:
        line_count = lines.count()
    except Exception:
        return {}

    for index in range(line_count):
        line = lines.nth(index)
        try:
            material = (line.get_attribute("data-line-item") or "").strip()
            if not material:
                continue
            block = line.locator("p.batchorder-orderline-error-block").first
            text = (block.inner_text(timeout=2000) or "").strip() if block.count() > 0 else ""
        except Exception:
            continue
        found[material] = text or "not uploaded"

    if found:
        logger.info("Webshop did not upload %s item(s): %s", len(found), found)
    return found


def webshop_orchestration(
    page: Page,
    context: BrowserContext,
    order: pd.Series,
    batch_csvs: Sequence[str | Path],
    config=None,
    on_phase: Optional[PhaseCallback] = None,
    on_batch_name: Optional[Callable[[str], None]] = None,
    require_existing_session: bool = False,
    saved_cart_name: Optional[str] = None,
) -> dict[str, str]:
    """
    Executes the entire webshop batch order process in a single procedural flow.
    Includes browser startup, session check, impersonation, cart creation, 
    file uploads, and browser teardown inline.
    Returns {material: webshop error text} for items the webshop refused to upload.
    """
    cfg = config or load_config()

    client_number = str(order.get("client_number", ""))
    client_name = str(order.get("client_name", ""))
    client_mail = str(order.get("client_mail", ""))

    paths: List[Path] = [Path(p).resolve() for p in batch_csvs]
    if not paths:
        raise ValueError("No batch CSV files provided.")

    base_url = cfg.get("webshop", "base_url")
    nav_timeout = cfg.getint("webshop", "navigation_timeout_ms", fallback=90000)
    timeout = cfg.getint("webshop", "default_timeout_ms", fallback=60000)

    
    

    #  _safe_goto (Navigate to base_url)
    target_url = base_url
    if (page.url or "").rstrip("/").lower() != target_url.rstrip("/").lower():
        try:
            page.goto(target_url, wait_until="domcontentloaded", timeout=nav_timeout)
        except Exception:
            pass
    
    #  _wait_loaded
    try:
        page.wait_for_load_state("domcontentloaded", timeout=nav_timeout)
    except PlaywrightTimeout:
        pass
    time.sleep(1.0)
    
    #  ensure_signed_in_session
    logger.info("Checking active session")
    login_handler.dismiss_cookie_banner(page)

    if require_existing_session:
        if not login_handler.is_signed_in(page):
            logger.warning("Session expired. Trying automatic SSO login...")
            login_handler.login(page, cfg)
            if not login_handler.is_signed_in(page):
                raise RuntimeError("Failed to restore session automatically. Run: python main.py --login")
        else:
            logger.info("Active signed-in webshop session confirmed.")
    else:
        if not login_handler.is_signed_in(page):
            logger.warning("Session is over — trying Login with SSO.")
            login_handler.restore_session_via_sso(page, context, cfg)

    #  _impersonate_user
    msg = f"Finding user {client_number} {client_name}".strip()
    logger.info(msg); on_phase and on_phase("PROCESSING", msg)

    #  _safe_goto (Navigate to base_url for impersonation reset)
    if (page.url or "").rstrip("/").lower() != base_url.rstrip("/").lower():
        try:
            page.goto(base_url, wait_until="domcontentloaded", timeout=nav_timeout)
        except Exception:
            pass
    #  _wait_loaded
    try:
        page.wait_for_load_state("domcontentloaded", timeout=nav_timeout)
    except PlaywrightTimeout:
        pass
    time.sleep(1.0)

    #  _open_impersonator_toggle
    selector = login_handler.impersonator_toggle_selector()
    for attempt in range(1, 4):
        login_handler.dismiss_cookie_banner(page)
        for exit_selector in ('[data-testid="impersonator-signout"] a', 'button:has-text("Stop impersonating")'):
            loc = page.locator(exit_selector)
            if loc.count() > 0 and loc.first.is_visible():
                loc.first.click(timeout=5000)
                #  _wait_loaded
                try:
                    page.wait_for_load_state("domcontentloaded", timeout=nav_timeout)
                except PlaywrightTimeout:
                    pass
                time.sleep(1.5)

        toggle = page.locator(selector).first
        try:
            toggle.wait_for(state="attached", timeout=12_000)
            toggle.click(force=True, timeout=5000)
            break
        except Exception:
            #  _safe_goto (Retry reset on failure)
            try:
                page.goto(base_url, wait_until="domcontentloaded", timeout=nav_timeout)
            except Exception:
                pass
            #  _wait_loaded
            try:
                page.wait_for_load_state("domcontentloaded", timeout=nav_timeout)
            except PlaywrightTimeout:
                pass
            time.sleep(1.0)
    else:
        raise TimeoutError("Impersonator control not available after retries.")

    time.sleep(0.3)
    search = page.locator('input.c-impersonator__input-search, input[id^="downshift-"]').first
    search.wait_for(state="visible")

    queries = [f"{client_number} {client_name}".strip()]
    if client_number:
        queries.append(client_number.strip())

    options = page.locator('[role="option"], .c-impersonator__menu-item')
    number_l = (client_number or "").casefold()
    name_l = (client_name or "").casefold()
    impersonated = False

    for query in queries:
        search.click()
        search.fill("")
        search.type(query, delay=40)

        try:
            options.first.wait_for(state="visible", timeout=12000)
        except PlaywrightTimeout:
            continue

        for index in range(options.count()):
            option = options.nth(index)
            text_l = (option.inner_text(timeout=2000) or "").casefold()
            if ((not number_l) or (number_l in text_l)) and ((not name_l) or (name_l in text_l)):
                option.click()
                #  _wait_loaded
                try:
                    page.wait_for_load_state("domcontentloaded", timeout=nav_timeout)
                except PlaywrightTimeout:
                    pass
                time.sleep(2.0)
                impersonated = True
                break
        if impersonated:
            break

    if not impersonated:
        raise TimeoutError(f"No impersonator option matched client_number={client_number}")

    #  _create_saved_cart — name from order_level column K (saved_card_name) or cart_DDYY_NNNN
    batch_name = (saved_cart_name or "").strip() or resolve_saved_cart_name(order)
    if not batch_name.strip():
        raise ValueError("saved cart name is empty (column K / saved_card_name)")

    open_msg = "Opening Saved carts panel"
    logger.info(open_msg)
    on_phase and on_phase("PROCESSING", open_msg)
    _open_saved_carts_panel(page, timeout_ms=min(nav_timeout, 30_000))

    msg = f"Creating new cart: {batch_name}"
    logger.info(msg)
    on_phase and on_phase("PROCESSING", msg)
    _fill_and_save_new_cart(page, batch_name)

    if on_batch_name:
        try:
            on_batch_name(batch_name)
        except Exception as exc:
            logger.warning("Could not persist BATCH_NAME to sheet: %s", exc)
    
    #  _wait_loaded
    try:
        page.wait_for_load_state("domcontentloaded", timeout=nav_timeout)
    except PlaywrightTimeout:
        pass
    time.sleep(1.5)

    close_btn = page.get_by_role("button", name="Close saved cart").first
    if close_btn.count() > 0 and close_btn.is_visible():
        close_btn.click()
        time.sleep(0.5)

    #  _open_batch_order
    base = base_url.rstrip("/")
    batch_url = f"{base}/shop-by/batch/" if base.endswith("/en") else f"{base}/en/shop-by/batch/"
    
    logger.info("Opening Batch Order")

    #  _safe_goto (Navigate to batch order page)
    if (page.url or "").rstrip("/").lower() != batch_url.rstrip("/").lower():
        try:
            page.goto(batch_url, wait_until="domcontentloaded", timeout=nav_timeout)
        except Exception:
            pass

    #  _wait_loaded
    try:
        page.wait_for_load_state("domcontentloaded", timeout=nav_timeout)
    except PlaywrightTimeout:
        pass
    time.sleep(2.0)

    #  _upload_and_add_to_cart (Loop for multiple files)
    total = len(paths)
    failed_by_material: dict[str, str] = {}
    for index, csv_path in enumerate(paths, start=1):
        
        logger.info(f"Batch upload {index}/{total}: {csv_path.name}")
        
        #  _ensure_batch_order_page
        if index > 1:
            if "/shop-by/batch" not in (page.url or ""):
                #  _safe_goto
                try:
                    page.goto(batch_url, wait_until="domcontentloaded", timeout=nav_timeout)
                except Exception:
                    pass
                #  _wait_loaded
                try:
                    page.wait_for_load_state("domcontentloaded", timeout=nav_timeout)
                except PlaywrightTimeout:
                    pass
                time.sleep(2.0)

        #  _attach_batch_csv
        file_input = page.locator('input[type="file"][name="file"], input.upload, input[type="file"]').first
        file_input.wait_for(state="attached", timeout=timeout)
        file_input.set_input_files(str(csv_path))

        try:
            file_input.evaluate("el => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }")
        except Exception:
            pass
        time.sleep(1.5)

        msg = f"Adding batch {index}/{total} to cart"
        logger.info(msg); on_phase and on_phase("PROCESSING", msg)
        
        add_btn = page.locator("#batch-saved-card-add, button.batch-saved-card-add, button:has-text('add to saved cart')").first
        add_btn.wait_for(state="visible")

        deadline = time.time() + 90
        while time.time() < deadline:
            disabled = add_btn.get_attribute("disabled")
            if disabled is None and add_btn.is_enabled():
                break
            time.sleep(0.5)
        else:
            raise TimeoutError(f"Add to cart stayed disabled after upload of {csv_path.name}.")

        # Panel renders either right after the file is parsed or after add to cart.
        failed_by_material.update(collect_failed_orderlines(page))

        add_btn.click()
        
        #  _wait_loaded
        try:
            page.wait_for_load_state("domcontentloaded", timeout=nav_timeout)
        except PlaywrightTimeout:
            pass
        time.sleep(2.0)

        failed_by_material.update(collect_failed_orderlines(page))

    logger.info("Batch order flow completed for client %s.", client_number)
    return failed_by_material
    
