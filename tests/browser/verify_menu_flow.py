"""Verify the studio splash → main menu → in-game pause flow in a real browser.

Covers: splash, menu entries (incl. Hilfe), quality persistence across a
reload, ship designer, army editor, game start, ESC pause (sim frozen while
open, resumed after), pause options + help overlay, HUD help overlay,
end-cycle and back-to-menu.
"""
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"
SHOT = "tests/browser"

def check(name, ok):
    print(("PASS" if ok else "FAIL"), name)
    if not ok:
        raise SystemExit(f"FAILED: {name}")

def wait_menu(page):
    page.wait_for_selector(".mm-splash")
    page.click(".mm-splash")
    page.wait_for_selector('.mm-list .mm-btn')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.goto(URL)
    page.wait_for_load_state("networkidle")

    # 1. Splash visible
    page.wait_for_selector(".mm-splash")
    page.wait_for_timeout(1200)  # letter animation settles
    page.screenshot(path=f"{SHOT}/01-splash.png")
    check("splash shows studio name", "ChaotiKKK" in (page.text_content(".mm-splash") or ""))

    # 2. Advance to menu (click splash)
    page.click(".mm-splash")
    page.wait_for_selector(".mm-list .mm-btn")
    page.screenshot(path=f"{SHOT}/02-menu.png")
    menu_text = page.text_content(".mm-list") or ""
    menu_text_lower = menu_text.lower()
    for item in ["spiel starten", "multiplayer", "laden / speichern", "schiff-designer", "armee-editor", "optionen", "hilfe & steuerung", "spiel beenden"]:
        check(f"menu has {item}", item in menu_text_lower)

    # 2b. Help from the main menu
    page.click('[data-mm="help"]')
    page.wait_for_selector(".mm-root [data-help]")
    help_text = page.text_content(".mm-root [data-help]") or ""
    check("menu help opens", "Handbuch" in help_text and "Tastatur" in help_text)
    page.screenshot(path=f"{SHOT}/02b-menu-help.png")
    page.click('[data-help-close]')
    page.wait_for_selector('[data-mm="start"]')

    # 3. Options view + quality persistence across reload
    page.click('[data-mm="options"]')
    page.wait_for_selector(".opt-row")
    page.select_option('[data-mm-quality]', 'niedrig')
    stored_quality = page.evaluate("() => JSON.parse(localStorage.getItem('pax.settings.v1') || '{}')")
    check("quality persisted", stored_quality.get("quality") == "niedrig")
    page.reload()
    wait_menu(page)
    page.click('[data-mm="options"]')
    page.wait_for_selector(".opt-row")
    restored = page.input_value('[data-mm-quality]')
    check("quality restored after reload", restored == "niedrig")
    page.click('[data-mm="back"]')
    page.wait_for_selector('[data-mm="start"]')

    # 4. Ship designer
    page.click('[data-mm="designer"]')
    page.wait_for_selector(".designer-body")
    page.fill('[data-d="name"]', "Tempest")
    page.screenshot(path=f"{SHOT}/03-designer.png")
    page.click('[data-d="save"]')
    page.wait_for_selector(".designer-item")
    page.screenshot(path=f"{SHOT}/04-designer-saved.png")
    page.click('[data-d="close"]')
    page.wait_for_selector('[data-mm="start"]')
    stored = page.evaluate("() => JSON.parse(localStorage.getItem('pax.customShips.v1') || '[]')")
    check("design persisted", len(stored) == 1 and stored[0]["name"] == "Tempest")

    # 5. Army editor: add 5 korvetten, save template
    page.click('[data-mm="armies"]')
    page.wait_for_selector(".army-grid")
    page.fill('[data-d="name"]', "Eiserner Schwadron")
    for _ in range(5):
        page.click('.army-row:first-child .army-stepper button:last-child')
    page.wait_for_selector('[data-d="save"]:not([disabled])')
    page.screenshot(path=f"{SHOT}/05-army.png")
    page.click('[data-d="save"]')
    page.wait_for_selector(".designer-item")
    page.screenshot(path=f"{SHOT}/06-army-saved.png")
    page.click('[data-d="close"]')
    page.wait_for_selector('[data-mm="start"]')
    templates = page.evaluate("() => JSON.parse(localStorage.getItem('pax.armyTemplates.v1') || '[]')")
    check("template persisted", len(templates) == 1 and templates[0]["name"] == "Eiserner Schwadron")

    # 6. Start game via title screen with army template
    page.click('[data-mm="start"]')
    page.wait_for_selector('[data-act="start"]')
    page.wait_for_selector("[data-army]")
    page.select_option("[data-army]", index=1)
    page.click('[data-act="start"]')
    page.wait_for_selector(".shell:not([hidden])", state="attached")
    page.wait_for_timeout(1500)
    game = page.evaluate("() => window.__pax?.game ? { player: window.__pax.game.player, fleets: window.__pax.game.fleets.length, cycle: window.__pax.game.cycle } : null")
    page.screenshot(path=f"{SHOT}/07-game.png")
    check("game started", bool(game) and game["fleets"] > 0)
    player_fleet = page.evaluate("() => { const g = window.__pax.game; const f = g.fleets.find(x => x.owner === g.player); return f ? f.ships : null; }")
    check("starting fleet has ships", bool(player_fleet))

    # 7. ESC pause: opens, freezes the cycle, resumes cleanly
    baseline = page.evaluate("() => window.__pax.game.cycle")
    page.keyboard.press("Escape")
    page.wait_for_selector(".pause-root:not([hidden])")
    paused = page.evaluate("() => window.__pax.paused")
    check("pause opens on ESC", paused is True)
    page.screenshot(path=f"{SHOT}/09-pause.png")
    page.keyboard.press("Space")
    page.wait_for_timeout(600)
    check("sim frozen while paused", page.evaluate("() => window.__pax.game.cycle") == baseline)
    # Pause options: quality select + instant apply
    page.click('[data-pause="options"]')
    page.wait_for_selector("[data-pause-quality]")
    page.screenshot(path=f"{SHOT}/10-pause-options.png")
    page.select_option("[data-pause-quality]", 'mittel')
    check("pause quality applies", page.evaluate("() => JSON.parse(localStorage.getItem('pax.settings.v1') || '{}').quality") == "mittel")
    # Help inside the pause menu keeps the pause open under it
    page.click('[data-pause="back"]')
    page.wait_for_selector('[data-pause="help"]')
    page.click('[data-pause="help"]')
    page.wait_for_selector(".pause-root [data-help]")
    page.screenshot(path=f"{SHOT}/11-pause-help.png")
    page.click('[data-help-close]')
    page.wait_for_selector('[data-pause="resume"]')
    check("pause survives help close", page.evaluate("() => window.__pax.paused") is True)
    # Resume
    page.click('[data-pause="resume"]')
    page.wait_for_timeout(300)
    check("pause resumes", page.evaluate("() => window.__pax.paused") is False)

    # 7b. HUD help overlay (in game), closed via ESC
    page.click('[data-act="help"]')
    page.wait_for_selector(".overlay-root [data-help]")
    page.screenshot(path=f"{SHOT}/12-hud-help.png")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("hud help closes on ESC", page.query_selector(".overlay-root [data-help]") is None)

    # 8. End cycle works again after resume
    page.keyboard.press("Space")
    page.wait_for_timeout(800)
    cycle = page.evaluate("() => window.__pax.game.cycle")
    check("end cycle advanced", cycle >= 1)

    # 9. Back to menu via topbar
    page.click('[data-act="menu"]')
    page.wait_for_selector('[data-mm="start"]')
    page.screenshot(path=f"{SHOT}/13-back-to-menu.png")
    check("back to menu", True)

    print("console errors:", errors if errors else "none")
    browser.close()
print("ALL OK")
