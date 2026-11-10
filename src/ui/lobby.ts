import { FACTIONS, FACTIONS_BY_ID } from '../data';
import type { FactionId } from '../types';

export interface LobbyPlayerView {
  id: string;
  name: string;
  faction: FactionId | null;
  ready: boolean;
  host: boolean;
  me: boolean;
}

export interface LobbyState {
  phase: 'form' | 'waiting';
  mode: 'host' | 'client';
  code: string | null;
  isHost: boolean;
  status: string;
  players: LobbyPlayerView[];
  chat: { name: string; text: string }[];
  myFaction: FactionId | null;
  canStart: boolean;
}

export interface LobbyHandlers {
  hostLan(name: string): void;
  joinLan(code: string, name: string, host: string): void;
  pickFaction(faction: FactionId): void;
  toggleReady(): void;
  start(seed: number): void;
  chat(text: string): void;
  leave(): void;
}

const NAME_KEY = 'pax-aeterna-name';

export class Lobby {
  private root: HTMLDivElement;
  private state: LobbyState = {
    phase: 'form',
    mode: 'host',
    code: null,
    isHost: false,
    status: '',
    players: [],
    chat: [],
    myFaction: null,
    canStart: false,
  };
  private name = localStorage.getItem(NAME_KEY) ?? '';
  private joinCode = '';
  private hostAddress = '';
  private open = false;

  constructor(private handlers: LobbyHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'lobby';
    this.root.hidden = true;
    (document.getElementById('overlays') as HTMLElement).appendChild(this.root);
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.target as HTMLElement).dataset.enter) {
        if (this.state.phase === 'form') this.submitForm();
        else this.submitChat();
      }
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(mode: 'host' | 'client', status = ''): void {
    this.open = true;
    this.root.hidden = false;
    this.state = { ...this.state, phase: 'form', mode, status, players: [], chat: [], code: null, isHost: mode === 'host' };
    this.render();
  }

  update(next: Partial<LobbyState>): void {
    this.state = { ...this.state, ...next };
    if (this.open) this.render();
  }

  hide(): void {
    this.open = false;
    this.root.hidden = true;
    this.root.innerHTML = '';
  }

  private submitForm(): void {
    const input = this.root.querySelector<HTMLInputElement>('[data-name]');
    const name = (input?.value ?? this.name).trim() || 'Kommandant';
    this.name = name;
    localStorage.setItem(NAME_KEY, name);
    if (this.state.mode === 'host') this.handlers.hostLan(name);
    else {
      const codeInput = this.root.querySelector<HTMLInputElement>('[data-code]');
      const code = (codeInput?.value ?? '').trim().toUpperCase();
      const hostInput = this.root.querySelector<HTMLInputElement>('[data-host]');
      const host = (hostInput?.value ?? this.hostAddress).trim();
      this.hostAddress = host;
      if (code.length < 2) {
        this.update({ status: 'Bitte einen Raumcode eingeben.' });
        return;
      }
      this.handlers.joinLan(code, name, host);
    }
  }

  private submitChat(): void {
    const input = this.root.querySelector<HTMLInputElement>('[data-chat]');
    const text = (input?.value ?? '').trim();
    if (!text) return;
    this.handlers.chat(text);
    input!.value = '';
  }

  private onClick = (ev: Event): void => {
    const target = (ev.target as HTMLElement).closest('[data-l]') as HTMLElement | null;
    if (!target) return;
    const act = target.dataset.l;
    if (act === 'submit') this.submitForm();
    else if (act === 'leave') this.handlers.leave();
    else if (act === 'pick' && target.dataset.faction) this.handlers.pickFaction(target.dataset.faction);
    else if (act === 'ready') this.handlers.toggleReady();
    else if (act === 'start') {
      const seedInput = this.root.querySelector<HTMLInputElement>('[data-seed]');
      const seed = seedInput && seedInput.value.trim() ? Number(seedInput.value) >>> 0 : Math.floor(Math.random() * 1e9);
      this.handlers.start(seed);
    } else if (act === 'chat-send') this.submitChat();
  };

  private render(): void {
    const s = this.state;
    if (s.phase === 'form') {
      this.root.innerHTML = `
        <div class="overlay">
          <div class="lobby-card">
            <div class="eyebrow">LAN-Mehrspieler · selbes Netzwerk</div>
            <h2>${s.mode === 'host' ? 'Partie hosten' : 'Partie beitreten'}</h2>
            <p class="sub">${
              s.mode === 'host'
                ? 'Dein Gerät rechnet die Simulation. Andere Geräte im WLAN verbinden sich mit dem angezeigten Code.'
                : 'Gib den Raumcode ein, den der Host dir nennt. PC, Tablet und Handy spielen gemeinsam.'
            }</p>
            ${s.status ? `<div class="lobby-status">${s.status}</div>` : ''}
            <label class="lobby-field">Name <input data-name type="text" maxlength="20" value="${escapeHtml(this.name)}" placeholder="Kommandant" data-enter="1" /></label>
            ${
              s.mode === 'client'
                ? `<label class="lobby-field">Raumcode <input data-code type="text" maxlength="4" value="${escapeHtml(this.joinCode)}" placeholder="ABCD" data-enter="1" style="text-transform:uppercase" /></label>
                   <label class="lobby-field">Host-Adresse <span style="text-transform:none;letter-spacing:0;color:var(--muted);font-size:10.5px">optional — z. B. 192.168.1.42</span><input data-host type="text" value="${escapeHtml(this.hostAddress)}" placeholder="automatisch" data-enter="1" /></label>`
                : ''
            }
            <div class="btn-row">
              <button class="btn btn-primary" data-l="submit">${s.mode === 'host' ? 'Raum öffnen' : 'Verbinden'}</button>
              <button class="btn btn-ghost" data-l="leave">Zurück</button>
            </div>
            <p class="hint">Host und Gäste müssen im selben WLAN sein. Port 7777 TCP.</p>
          </div>
        </div>`;
      return;
    }

    this.root.innerHTML = `
      <div class="overlay">
        <div class="lobby-card is-wide">
          <div class="lobby-head">
            <div>
              <div class="eyebrow">${s.isHost ? 'Host' : 'Gast'} · LAN-Partie</div>
              <h2>Raum ${s.code ?? '—'}</h2>
            </div>
            <div class="lobby-head-right">
              <span class="chip">${s.players.length} Spieler</span>
              <button class="btn btn-sm btn-ghost" data-l="leave">Verlassen</button>
            </div>
          </div>
          ${s.status ? `<div class="lobby-status">${s.status}</div>` : ''}
          <div class="lobby-grid">
            <div>
              <h3 class="block-title">Mächte <span>${s.players.length}/8</span></h3>
              <div class="lobby-factions">
                ${FACTIONS.map((f) => {
                  const owner = s.players.find((p) => p.faction === f.id);
                  const mine = s.myFaction === f.id;
                  const disabled = (!!owner && !mine) || s.players.find((p) => p.me)?.ready;
                  return `<button class="lobby-faction ${mine ? 'is-mine' : ''} ${disabled ? 'is-taken' : ''}"
                    style="--fc:${f.css}" data-l="pick" data-faction="${f.id}" ${disabled ? 'disabled' : ''}>
                    <b style="color:${f.css}">${f.short}</b>
                    <span>${owner ? owner.name : f.doctrine}</span>
                  </button>`;
                }).join('')}
              </div>
            </div>
            <div class="lobby-side">
              <h3 class="block-title">Spieler</h3>
              <div class="lobby-players">
                ${s.players
                  .map(
                    (p) => `<div class="lobby-player ${p.me ? 'is-me' : ''}">
                      <span class="lp-name">${escapeHtml(p.name)}${p.host ? ' <i>Host</i>' : ''}</span>
                      <span class="lp-faction" style="color:${p.faction ? FACTIONS_BY_ID[p.faction].css : 'var(--muted)'}">
                        ${p.faction ? FACTIONS_BY_ID[p.faction].short : 'wählt…'}
                      </span>
                      <span class="lp-ready ${p.ready ? 'is-on' : ''}">${p.ready ? 'bereit' : '—'}</span>
                    </div>`,
                  )
                  .join('')}
              </div>
              <div class="lobby-chat">
                ${s.chat
                  .slice(-6)
                  .map((c) => `<div class="chat-line"><b>${escapeHtml(c.name)}</b>${escapeHtml(c.text)}</div>`)
                  .join('')}
              </div>
              <div class="lobby-chat-input">
                <input data-chat type="text" maxlength="140" placeholder="Nachricht…" data-enter="1" />
                <button class="btn btn-sm" data-l="chat-send">Senden</button>
              </div>
              <div class="lobby-actions">
                <button class="btn ${s.players.find((p) => p.me)?.ready ? 'btn-ghost' : ''}" data-l="ready">
                  ${s.players.find((p) => p.me)?.ready ? 'Bereit zurücknehmen' : 'Bereit'}
                </button>
                ${
                  s.isHost
                    ? `<button class="btn btn-primary" data-l="start" ${s.canStart ? '' : 'disabled'}>Partie starten</button>
                       <label class="seed-field">Seed <input data-seed type="text" inputmode="numeric" placeholder="auto" /></label>`
                    : '<span class="hint">Der Host startet die Partie.</span>'
                }
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
