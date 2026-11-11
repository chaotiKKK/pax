/**
 * Shared "Hilfe & Steuerung" manual, used by the HUD (? button), the main
 * menu, and the pause menu so the text can never drift apart.
 * `data-audio="music|sfx"` sliders are handled by Hud's document-level
 * input listener; the close button uses `data-help-close` and the host
 * wires its own close behaviour.
 */
export function helpContentHtml(volume: { music: number; sfx: number }): string {
  return `
    <div class="modal-head">
      <h2>Handbuch</h2>
      <button class="btn btn-sm btn-ghost" data-help-close>Schließen</button>
    </div>
    <div class="help-grid">
      <div>
        <h4>Der Zyklus</h4>
        <p>Jeder Zyklus ist ein Monat. Du gibst Befehle, dann rechnet die Simulation: Einkommen, Wachstum, Bau, Forschung, Bewegung, Gefechte. Danach beginnt der nächste Zyklus.</p>
        <h4>Kolonien</h4>
        <p>Baue zuerst eine <b>Orbitalwerft</b>, dann Schiffe. <b>Erzschürfer</b> und <b>Reaktoren</b> tragen den Haushalt, <b>Labore</b> die Forschung, <b>Habitatringe</b> die Bevölkerung.</p>
        <h4>Archen</h4>
        <p>Eine <b>Arche „Genesis“</b> landet auf einer habitablen Welt und wird dabei verbraucht. Kolonisieren kostet zusätzlich 30 Einfluss.</p>
      </div>
      <div>
        <h4>Flotten</h4>
        <p>Wähle eine Flotte im Sektor und drücke <b>Ziel</b>, dann klicke den Zielsektor. Jede Lane kostet mindestens einen Zyklus; langsame Rümpfe brauchen zwei.</p>
        <h4>Krieg</h4>
        <p>Gefechte laufen automatisch, sobald verfeindete Flotten im selben System stehen. Wer den Orbit hält, kann eine feindliche Kolonie belagern — die Invasion läuft über mehrere Zyklen.</p>
        <h4>Tastatur</h4>
        <ul>
          <li><b>Leertaste</b> — Zyklus beenden</li>
          <li><b>Esc</b> — Pause-Menü öffnen / Auswahl aufheben</li>
          <li><b>1–4</b> — Registerkarten</li>
        </ul>
        <h4>Audio</h4>
        <div class="audio-controls">
          <label>Musik <input data-audio="music" type="range" min="0" max="100" value="${Math.round(volume.music * 100)}" /></label>
          <label>Effekte <input data-audio="sfx" type="range" min="0" max="100" value="${Math.round(volume.sfx * 100)}" /></label>
        </div>
        <p class="hint">Der ♪-Knopf schaltet alles stumm. Regler werden lokal gespeichert.</p>
      </div>
    </div>`;
}

/** Shows the manual as a full overlay inside `host`; removes it on close. */
export function showHelpOverlay(
  host: HTMLElement,
  volume: { music: number; sfx: number },
  onClose: () => void,
): void {
  const wrap = document.createElement('div');
  wrap.className = 'overlay';
  wrap.setAttribute('data-help', 'true');
  wrap.innerHTML = `<div class="modal">${helpContentHtml(volume)}</div>`;
  wrap.querySelector('[data-help-close]')?.addEventListener('click', () => {
    wrap.remove();
    onClose();
  });
  host.appendChild(wrap);
}
