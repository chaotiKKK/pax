import { SHIP_CLASSES, SHIP_ORDER } from '../data';
import { addCustomShip, deleteCustomShip, designCost, isCustomId, listCustomShips } from '../ships/custom';
import type { ShipId } from '../types';
import { ArsenalView } from '../render/arsenalView';

/**
 * Ship Designer: pick a base hull, spend the cost budget on attack / hull /
 * speed sliders, preview the hull in 3D and save it as a playable ship class.
 * Designs are registered into SHIP_CLASSES / SHIP_ORDER immediately, so they
 * appear in shipyard build lists, battles and saves like built-in classes.
 */

const BASE_CLASSES = SHIP_ORDER.filter((id) => !isCustomId(id));

interface DesignerState {
  base: ShipId;
  name: string;
  role: string;
  attack: number;
  hull: number;
  speed: number;
}

function defaults(base: ShipId): DesignerState {
  const d = SHIP_CLASSES[base];
  return { base, name: '', role: '', attack: d.attack, hull: d.hull, speed: d.speed };
}

export function showShipDesigner(root: HTMLElement, callbacks: { onClose(): void }): void {
  const el = document.createElement('div');
  el.className = 'mm-overlay';
  el.style.zIndex = '55';
  root.appendChild(el);

  let state = defaults('corvette');
  let view: ArsenalView | null = null;
  let raf = 0;
  let closed = false;

  const render = (): void => {
    const base = SHIP_CLASSES[state.base];
    const cost = designCost(state);
    const designs = listCustomShips();
    el.innerHTML = `
      <div class="modal modal-wide">
        <div class="modal-head">
          <h2>Schiff-Designer</h2>
          <button class="btn btn-sm btn-ghost" data-d="close">Schließen</button>
        </div>
        <div class="designer-body">
          <div class="designer-form">
            <div class="eyebrow">Basis-Rumpf</div>
            <div class="designer-bases">
              ${BASE_CLASSES.map(
                (id) => `<button class="mm-chip ${state.base === id ? 'is-active' : ''}" data-d="base" data-base="${id}">${SHIP_CLASSES[id].role}</button>`,
              ).join('')}
            </div>
            <label class="designer-field">
              <span>Schiffsname</span>
              <input type="text" maxlength="40" placeholder="z. B. „Tempest“" value="${escapeAttr(state.name)}" data-d="name" />
            </label>
            <label class="designer-field">
              <span>Rolle (optional)</span>
              <input type="text" maxlength="32" placeholder="${escapeAttr(base.role)}" value="${escapeAttr(state.role)}" data-d="role" />
            </label>
            <div class="designer-sliders">
              ${slider('Angriff', 'attack', state.attack, 0, Math.round(base.attack * 2.2), base.attack)}
              ${slider('Hülle', 'hull', state.hull, 0, Math.round(base.hull * 2.5), base.hull)}
              ${slider('Tempo', 'speed', state.speed, 0.4, Math.min(6, base.speed * 1.6), base.speed)}
            </div>
            <div class="designer-cost">
              <span>Baukosten</span><b>${cost} ⛭</b>
              <span>Basis</span><b>${base.alloy} ⛭</b>
            </div>
            <button class="btn btn-primary" data-d="save">Design speichern</button>
            <p class="hint">Designs erscheinen sofort in den Werft-Baulisten aller Reiche und brauchen keine Forschung.</p>
          </div>
          <div class="designer-side">
            <div class="arsenal-canvas-wrap designer-canvas"><canvas></canvas></div>
            <div class="designer-list">
              <div class="eyebrow">Eigene Designs (${designs.length})</div>
              ${
                designs.length
                  ? designs
                      .map(
                        (d) => `<div class="designer-item">
                          <div><b>${escapeHtml(d.name)}</b><span>${d.attack} ⚔ · ${d.hull} ⛨ · ${d.speed.toFixed(1)} ➤ · ${designCost(d)} ⛭</span></div>
                          <button class="btn btn-sm btn-ghost" data-d="del" data-id="${d.id}">Löschen</button>
                        </div>`,
                      )
                      .join('')
                  : '<p class="hint">Noch keine Designs. Entwirf oben deinen ersten Rumpf.</p>'
              }
            </div>
          </div>
        </div>
      </div>`;

    const canvas = el.querySelector('canvas') as HTMLCanvasElement;
    view?.dispose();
    view = new ArsenalView(canvas);
    void view.setShip(base.model, 0xf0a63f);
    requestAnimationFrame(() => view?.resize());
    const tick = (): void => {
      if (closed) return;
      view?.tick(1 / 60);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  const close = (): void => {
    closed = true;
    cancelAnimationFrame(raf);
    view?.dispose();
    view = null;
    el.remove();
    callbacks.onClose();
  };

  el.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest('[data-d]') as HTMLElement | null;
    if (!target) return;
    const act = target.dataset.d ?? '';
    if (act === 'close') {
      close();
      return;
    }
    if (act === 'base' && target.dataset.base) {
      state = defaults(target.dataset.base as ShipId);
      render();
      return;
    }
    if (act === 'save') {
      const name = state.name.trim();
      if (!name) {
        el.querySelector<HTMLInputElement>('[data-d="name"]')?.focus();
        return;
      }
      if (state.attack === 0 && state.hull === 0) return;
      addCustomShip({
        id: '',
        name,
        role: state.role.trim(),
        base: state.base,
        attack: state.attack,
        hull: state.hull,
        speed: state.speed,
      });
      state = defaults(state.base);
      render();
      return;
    }
    if (act === 'del' && target.dataset.id) {
      deleteCustomShip(target.dataset.id);
      render();
    }
  });

  el.addEventListener('input', (ev) => {
    const input = ev.target as HTMLInputElement;
    const field = input.dataset.d;
    if (field === 'name') state.name = input.value;
    else if (field === 'role') state.role = input.value;
    else if (field === 'attack') state.attack = Number(input.value);
    else if (field === 'hull') state.hull = Number(input.value);
    else if (field === 'speed') state.speed = Number(input.value);
    else return;
    // Live-update cost only, so the dragged slider and preview stay put.
    if (field === 'attack' || field === 'hull' || field === 'speed') {
      const costEl = el.querySelector('.designer-cost b');
      if (costEl) costEl.textContent = `${designCost(state)} ⛭`;
      const val = el.querySelector(`[data-d-val="${field}"]`);
      if (val) val.textContent = field === 'speed' ? state.speed.toFixed(1) : String(state[field]);
    }
  });

  render();
}

function slider(
  label: string,
  field: 'attack' | 'hull' | 'speed',
  value: number,
  min: number,
  max: number,
  base: number,
): string {
  const step = field === 'speed' ? 0.1 : 1;
  const shown = field === 'speed' ? value.toFixed(1) : String(value);
  return `<label class="designer-slider">
    <span>${label} <b data-d-val="${field}">${shown}</b> <i>(Basis ${field === 'speed' ? base.toFixed(1) : base})</i></span>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-d="${field}" />
  </label>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}
