/**
 * Studio splash + main menu. Rendered into a dedicated root inside #overlays
 * so it can sit above (or below) the Hud shell without fighting its overlay
 * management. Flow:
 *
 *   splash ("Sebbo's ChaotiKKK GameStudios") → main menu → campaign setup
 *   (Hud.showTitle), LAN lobby, save/load, ship designer, army editor,
 *   options, quit. */
import { showHelpOverlay } from './helpView';
import type { Quality } from './settings';

export interface MainMenuActions {
  onStartGame(): void;
  onMultiplayer(mode: 'host' | 'client'): void;
  onSaveLoad(): void;
  onShipDesigner(): void;
  onArmyEditor(): void;
  onQuit(): void;
  getAudio(): { enabled: boolean; music: number; sfx: number };
  setAudioEnabled(enabled: boolean): void;
  setAudioVolume(bus: 'music' | 'sfx', value: number): void;
  getQuality(): Quality;
  setQuality(quality: Quality): void;
}

const STUDIO = "Sebbo's ChaotiKKK GameStudios";
const SPLASH_MS = 2600;

interface View {
  kind: 'splash' | 'menu' | 'options' | 'confirm-quit';
}

export class MainMenu {
  private root: HTMLDivElement;
  private view: View = { kind: 'menu' };
  private splashTimer: number | null = null;
  private splashDone: (() => void) | null = null;

  constructor(overlays: HTMLElement, private actions: MainMenuActions) {
    this.root = document.createElement('div');
    this.root.className = 'mm-root';
    this.root.hidden = true;
    overlays.appendChild(this.root);
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);
    this.root.addEventListener('change', this.onChange);
    document.addEventListener('keydown', this.onKey);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /** Studio splash: auto-advances after SPLASH_MS, or on click / any key. */
  showSplash(onDone: () => void): void {
    this.view = { kind: 'splash' };
    this.splashDone = onDone;
    this.root.hidden = false;
    this.root.innerHTML = `
      <div class="mm-splash" data-mm="splash">
        <div class="mm-splash-stars"></div>
        <div class="mm-splash-inner">
          <div class="mm-splash-mark">✦</div>
          <div class="mm-studio">${splitLetters(STUDIO)}</div>
          <div class="mm-splash-rule"></div>
          <div class="mm-splash-game">Pax Aeterna</div>
          <div class="mm-splash-hint">Klicken oder Taste drücken, um fortzufahren</div>
        </div>
      </div>`;
    this.armSplashTimer();
  }

  showMenu(): void {
    this.clearSplashTimer();
    this.view = { kind: 'menu' };
    this.root.hidden = false;
    this.root.innerHTML = `
      <div class="mm-overlay">
        <div class="mm-menu">
          <div class="mm-hero">
            <div class="eyebrow">Ein 4X-Remake · Zyklus 2187</div>
            <h1>Pax<em>Aeterna</em></h1>
            <p class="lede">Sechzehn Mächte, vierundsechzig Sektoren und ein Frieden, der nie unterzeichnet wurde.</p>
            <div class="mm-studio-line">${STUDIO}</div>
          </div>
          <nav class="mm-list" aria-label="Hauptmenü">
            <button class="mm-btn mm-btn-primary" data-mm="start">▶ Spiel starten</button>
            <button class="mm-btn" data-mm="mp">⇄ Multiplayer</button>
            <div class="mm-sub" data-mm-sub="mp" hidden>
              <button class="mm-btn mm-btn-sub" data-mm="host">LAN-Partie hosten</button>
              <button class="mm-btn mm-btn-sub" data-mm="join">LAN beitreten</button>
            </div>
            <button class="mm-btn" data-mm="saveload">💾 Laden / Speichern</button>
            <button class="mm-btn" data-mm="designer">⌖ Schiff-Designer</button>
            <button class="mm-btn" data-mm="armies">⚑ Armee-Editor</button>
            <button class="mm-btn" data-mm="options">⚙ Optionen</button>
            <button class="mm-btn" data-mm="help">❔ Hilfe &amp; Steuerung</button>
            <button class="mm-btn mm-btn-danger" data-mm="quit">⏻ Spiel beenden</button>
          </nav>
          <p class="hint mm-foot">Ziehen dreht die Karte · Mausrad zoomt · Leertaste beendet den Zyklus</p>
        </div>
      </div>`;
  }

  showOptions(): void {
    this.view = { kind: 'options' };
    const audio = this.actions.getAudio();
    const quality = this.actions.getQuality();
    this.root.innerHTML = `
      <div class="mm-overlay">
        <div class="mm-panel">
          <div class="mm-panel-head">
            <h2>Optionen</h2>
            <button class="btn btn-sm btn-ghost" data-mm="back">Zurück</button>
          </div>
          <div class="opt-row opt-toggle">
            <span>Ton</span>
            <button class="mm-btn mm-btn-sub ${audio.enabled ? 'is-on' : ''}" data-mm="audio-toggle">${audio.enabled ? 'An' : 'Aus'}</button>
          </div>
          <div class="opt-row">
            <label for="opt-music">Musik</label>
            <input id="opt-music" type="range" min="0" max="100" value="${Math.round(audio.music * 100)}" data-mm-audio="music" />
            <span class="opt-val" data-mm-audio-val="music">${Math.round(audio.music * 100)} %</span>
          </div>
          <div class="opt-row">
            <label for="opt-sfx">Effekte</label>
            <input id="opt-sfx" type="range" min="0" max="100" value="${Math.round(audio.sfx * 100)}" data-mm-audio="sfx" />
            <span class="opt-val" data-mm-audio-val="sfx">${Math.round(audio.sfx * 100)} %</span>
          </div>
          <div class="opt-row">
            <label for="opt-quality">Grafikqualität</label>
            <select id="opt-quality" data-mm-quality>
              ${qualityOption('hoch', 'Hoch', quality)}
              ${qualityOption('mittel', 'Mittel', quality)}
              ${qualityOption('niedrig', 'Niedrig', quality)}
            </select>
          </div>
          <p class="hint">Alle Einstellungen werden lokal gespeichert. Die Qualität steuert Sternenfeld-Dichte und Auflösung — niedrig läuft auf schwächeren Rechnern flüssiger.</p>
        </div>
      </div>`;
  }

  showQuitConfirm(): void {
    this.view = { kind: 'confirm-quit' };
    this.root.innerHTML = `
      <div class="mm-overlay">
        <div class="mm-panel mm-panel-narrow">
          <h2>Spiel beenden?</h2>
          <p class="hint">Der Autospeicher bleibt erhalten — du kannst jederzeit weiterspielen.</p>
          <div class="mm-panel-actions">
            <button class="mm-btn mm-btn-danger" data-mm="quit-yes">⏻ Beenden</button>
            <button class="mm-btn" data-mm="back">Abbrechen</button>
          </div>
        </div>
      </div>`;
  }

  hide(): void {
    this.clearSplashTimer();
    this.splashDone = null;
    this.root.hidden = true;
    this.root.innerHTML = '';
  }

  private armSplashTimer(): void {
    this.clearSplashTimer();
    this.splashTimer = window.setTimeout(() => this.advanceSplash(), SPLASH_MS);
  }

  private clearSplashTimer(): void {
    if (this.splashTimer !== null) {
      window.clearTimeout(this.splashTimer);
      this.splashTimer = null;
    }
  }

  private advanceSplash(): void {
    if (this.view.kind !== 'splash') return;
    this.clearSplashTimer();
    const done = this.splashDone;
    this.splashDone = null;
    done?.();
  }

  private onKey = (ev: KeyboardEvent): void => {
    if (!this.visible || this.view.kind !== 'splash') return;
    ev.preventDefault();
    this.advanceSplash();
  };

  private onClick = (ev: Event): void => {
    if (!this.visible) return;
    const target = (ev.target as HTMLElement).closest('[data-mm]') as HTMLElement | null;
    if (!target) {
      if (this.view.kind === 'splash') this.advanceSplash();
      return;
    }
    const act = target.dataset.mm ?? '';
    switch (act) {
      case 'splash':
        this.advanceSplash();
        break;
      case 'start':
        this.actions.onStartGame();
        break;
      case 'mp': {
        const sub = this.root.querySelector<HTMLElement>('[data-mm-sub="mp"]');
        if (sub) sub.hidden = !sub.hidden;
        break;
      }
      case 'host':
        this.actions.onMultiplayer('host');
        break;
      case 'join':
        this.actions.onMultiplayer('client');
        break;
      case 'saveload':
        this.actions.onSaveLoad();
        break;
      case 'designer':
        this.actions.onShipDesigner();
        break;
      case 'armies':
        this.actions.onArmyEditor();
        break;
      case 'options':
        this.showOptions();
        break;
      case 'help': {
        const audio = this.actions.getAudio();
        showHelpOverlay(this.root, { music: audio.music, sfx: audio.sfx }, () => this.showMenu());
        break;
      }
      case 'audio-toggle':
        this.actions.setAudioEnabled(!this.actions.getAudio().enabled);
        this.showOptions();
        break;
      case 'quit':
        this.showQuitConfirm();
        break;
      case 'quit-yes':
        this.actions.onQuit();
        break;
      case 'back':
        this.showMenu();
        break;
    }
  };

  private onInput = (ev: Event): void => {
    const input = ev.target as HTMLInputElement;
    const bus = input?.dataset.mmAudio;
    if (bus !== 'music' && bus !== 'sfx') return;
    const value = Number(input.value) / 100;
    this.actions.setAudioVolume(bus, value);
    const label = this.root.querySelector(`[data-mm-audio-val="${bus}"]`);
    if (label) label.textContent = `${Math.round(value * 100)} %`;
  };

  private onChange = (ev: Event): void => {
    const select = ev.target as HTMLSelectElement;
    if (select?.hasAttribute('data-mm-quality')) {
      this.actions.setQuality(select.value as Quality);
    }
  };
}

function qualityOption(value: Quality, label: string, current: Quality): string {
  return `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
}

function splitLetters(text: string): string {
  return text
    .split('')
    .map((ch, i) => `<span class="mm-letter" style="animation-delay:${i * 45}ms">${ch === ' ' ? '&nbsp;' : escapeHtml(ch)}</span>`)
    .join('');
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}
