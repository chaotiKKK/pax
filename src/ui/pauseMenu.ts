import { showHelpOverlay } from './helpView';
import type { Quality } from './settings';

/**
 * In-game pause menu, opened with ESC or the ⏸ button. While it is visible,
 * main.ts freezes the render/sim loop, so the game cannot advance behind
 * the menu. In multiplayer, pausing is host-controlled: the host's frozen
 * loop also freezes the state broadcast to clients — nobody's client breaks,
 * the game simply waits.
 */
export interface PauseMenuActions {
  onResume(): void;
  onSaveLoad(): void;
  onBackToMenu(): void;
  onQuit(): void;
  getAudio(): { enabled: boolean; music: number; sfx: number };
  setAudioEnabled(enabled: boolean): void;
  getQuality(): Quality;
  setQuality(quality: Quality): void;
  isMultiplayer(): boolean;
}

export class PauseMenu {
  private root: HTMLDivElement;
  private view: 'main' | 'options' = 'main';

  constructor(overlays: HTMLElement, private actions: PauseMenuActions) {
    this.root = document.createElement('div');
    this.root.className = 'pause-root';
    this.root.hidden = true;
    overlays.appendChild(this.root);
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);
    this.root.addEventListener('change', this.onChange);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.view = 'main';
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
    this.root.innerHTML = '';
  }

  private render(): void {
    if (this.view === 'options') return this.renderOptions();
    const mp = this.actions.isMultiplayer();
    this.root.innerHTML = `
      <div class="mm-overlay">
        <div class="mm-menu">
          <div class="mm-hero">
            <div class="eyebrow">Pausiert</div>
            <h1>⏸ <em>Pause</em></h1>
            ${
              mp
                ? '<p class="lede">Im Mehrspieler pausiert das Spiel für alle — der Host steuert den Zyklus.</p>'
                : '<p class="lede">Die Simulation steht still, solange dieses Menü offen ist.</p>'
            }
          </div>
          <nav class="mm-list" aria-label="Pause-Menü">
            <button class="mm-btn mm-btn-primary" data-pause="resume">▶ Weiter spielen</button>
            <button class="mm-btn" data-pause="options">⚙ Optionen</button>
            <button class="mm-btn" data-pause="help">❔ Hilfe &amp; Steuerung</button>
            <button class="mm-btn" data-pause="saveload">💾 Speichern / Laden</button>
            <button class="mm-btn" data-pause="menu">☰ Hauptmenü</button>
            <button class="mm-btn mm-btn-danger" data-pause="quit">⏻ Spiel beenden</button>
          </nav>
          <p class="hint mm-foot">Esc — weiter spielen</p>
        </div>
      </div>`;
  }

  private renderOptions(): void {
    const audio = this.actions.getAudio();
    const quality = this.actions.getQuality();
    const option = (value: Quality, label: string) =>
      `<option value="${value}" ${quality === value ? 'selected' : ''}>${label}</option>`;
    this.root.innerHTML = `
      <div class="mm-overlay">
        <div class="mm-panel">
          <div class="mm-panel-head">
            <h2>Optionen</h2>
            <button class="btn btn-sm btn-ghost" data-pause="back">Zurück</button>
          </div>
          <div class="opt-row opt-toggle">
            <span>Ton</span>
            <button class="mm-btn mm-btn-sub ${audio.enabled ? 'is-on' : ''}" data-pause="audio-toggle">${audio.enabled ? 'An' : 'Aus'}</button>
          </div>
          <div class="opt-row">
            <label for="pause-music">Musik</label>
            <input id="pause-music" type="range" min="0" max="100" value="${Math.round(audio.music * 100)}" data-audio="music" />
            <span class="opt-val">${Math.round(audio.music * 100)} %</span>
          </div>
          <div class="opt-row">
            <label for="pause-sfx">Effekte</label>
            <input id="pause-sfx" type="range" min="0" max="100" value="${Math.round(audio.sfx * 100)}" data-audio="sfx" />
            <span class="opt-val">${Math.round(audio.sfx * 100)} %</span>
          </div>
          <div class="opt-row">
            <label for="pause-quality">Grafikqualität</label>
            <select id="pause-quality" data-pause-quality>
              ${option('hoch', 'Hoch')}
              ${option('mittel', 'Mittel')}
              ${option('niedrig', 'Niedrig')}
            </select>
          </div>
          <p class="hint">Lautstärken und Qualität werden lokal gespeichert. Die Qualität steuert Sternenfeld-Dichte und Auflösung — niedrig läuft auf schwächeren Rechnern flüssiger.</p>
        </div>
      </div>`;
  }

  private onClick = (ev: Event): void => {
    const target = (ev.target as HTMLElement).closest('[data-pause]') as HTMLElement | null;
    if (!target) return;
    switch (target.dataset.pause) {
      case 'resume':
        this.actions.onResume();
        break;
      case 'options':
        this.view = 'options';
        this.render();
        break;
      case 'back':
        this.view = 'main';
        this.render();
        break;
      case 'audio-toggle':
        this.actions.setAudioEnabled(!this.actions.getAudio().enabled);
        this.render();
        break;
      case 'help':
        showHelpOverlay(this.root, { music: this.actions.getAudio().music, sfx: this.actions.getAudio().sfx }, () => this.render());
        break;
      case 'saveload':
        this.actions.onSaveLoad();
        break;
      case 'menu':
        this.actions.onBackToMenu();
        break;
      case 'quit':
        this.actions.onQuit();
        break;
    }
  };

  private onInput = (ev: Event): void => {
    const input = ev.target as HTMLInputElement;
    if (!input) return;
    // Audio sliders use the shared data-audio attributes and are handled by
    // Hud's document-level listener; only the percent label needs a refresh.
    const bus = input.dataset.audio;
    if (bus === 'music' || bus === 'sfx') {
      const label = input.closest('.opt-row')?.querySelector('.opt-val');
      if (label) label.textContent = `${input.value} %`;
    }
  };

  private onChange = (ev: Event): void => {
    const select = ev.target as HTMLSelectElement;
    if (select?.hasAttribute('data-pause-quality')) {
      this.actions.setQuality(select.value as Quality);
    }
  };
}
