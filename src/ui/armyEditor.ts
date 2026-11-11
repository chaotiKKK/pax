import { SHIP_CLASSES, SHIP_ORDER } from '../data';
import {
  armyCost,
  armySummary,
  deleteArmyTemplate,
  listArmyTemplates,
  saveArmyTemplate,
  type ArmyTemplate,
} from '../ships/armies';
import { isCustomId } from '../ships/custom';
import type { ShipId } from '../types';

/**
 * Army Editor: compose a named starting fleet — counts per ship class
 * (built-in and custom) within a cost budget. Templates can be picked on the
 * title screen as the starting fleet; they serialize into the game state, so
 * multiplayer hosts and saved games stay consistent without sharing templates.
 */

const BUDGET = 900;
const MAX_PER_CLASS = 99;

export function showArmyEditor(root: HTMLElement, callbacks: { onClose(): void }): void {
  const el = document.createElement('div');
  el.className = 'mm-overlay';
  el.style.zIndex = '55';
  root.appendChild(el);

  let editing: ArmyTemplate | null = null;
  let name = '';
  const counts = new Map<ShipId, number>();

  const template = (): ArmyTemplate => ({
    id: editing?.id ?? '',
    name,
    ships: Object.fromEntries([...counts.entries()].filter(([, n]) => n > 0)),
  });

  const render = (): void => {
    const templates = listArmyTemplates();
    const cost = armyCost(template());
    const over = cost > BUDGET;
    el.innerHTML = `
      <div class="modal modal-wide">
        <div class="modal-head">
          <h2>Armee-Editor</h2>
          <button class="btn btn-sm btn-ghost" data-d="close">Schließen</button>
        </div>
        <div class="designer-body">
          <div class="designer-form">
            <label class="designer-field">
              <span>Name der Startflotte</span>
              <input type="text" maxlength="40" placeholder="z. B. „Eiserner Schwadron“" value="${escapeAttr(name)}" data-d="name" />
            </label>
            <div class="eyebrow">Schiffsbestand (Budget ${BUDGET} ⛭)</div>
            <div class="army-grid">
              ${SHIP_ORDER.map((id) => {
                const d = SHIP_CLASSES[id];
                const n = counts.get(id) ?? 0;
                return `<div class="army-row ${isCustomId(id) ? 'is-custom' : ''}">
                  <div class="army-row-info">
                    <b>${escapeHtml(d.name)}</b>
                    <span>${escapeHtml(d.role)} · ${d.alloy} ⛭</span>
                  </div>
                  <div class="army-stepper">
                    <button class="btn btn-sm" data-d="dec" data-id="${id}" ${n <= 0 ? 'disabled' : ''}>−</button>
                    <b>${n}</b>
                    <button class="btn btn-sm" data-d="inc" data-id="${id}">+</button>
                  </div>
                </div>`;
              }).join('')}
            </div>
            <div class="designer-cost ${over ? 'is-over' : ''}">
              <span>Gesamt</span><b>${cost} ⛭</b>
              <span>Inhalt</span><b>${escapeHtml(armySummary(template()))}</b>
            </div>
            <div class="designer-actions">
              <button class="btn btn-primary" data-d="save" ${over ? 'disabled' : ''}>Vorlage speichern</button>
              <button class="btn btn-ghost" data-d="reset">Leeren</button>
            </div>
            <p class="hint">Vorlagen wählst du auf dem Titelbildschirm als Startflotte. Im Mehrspieler überträgt der Host sie automatisch.</p>
          </div>
          <div class="designer-side">
            <div class="designer-list">
              <div class="eyebrow">Gespeicherte Vorlagen (${templates.length})</div>
              ${
                templates.length
                  ? templates
                      .map(
                        (t) => `<div class="designer-item">
                          <div><b>${escapeHtml(t.name)}</b><span>${escapeHtml(armySummary(t))} · ${armyCost(t)} ⛭</span></div>
                          <div class="designer-item-actions">
                            <button class="btn btn-sm" data-d="load" data-id="${t.id}">Bearbeiten</button>
                            <button class="btn btn-sm btn-ghost" data-d="del" data-id="${t.id}">Löschen</button>
                          </div>
                        </div>`,
                      )
                      .join('')
                  : '<p class="hint">Noch keine Vorlagen. Stelle links eine Flotte zusammen.</p>'
              }
            </div>
          </div>
        </div>
      </div>`;

    const nameInput = el.querySelector<HTMLInputElement>('[data-d="name"]');
    nameInput?.addEventListener('input', () => {
      name = nameInput.value;
    });
    nameInput?.focus();
  };

  const close = (): void => {
    el.remove();
    callbacks.onClose();
  };

  el.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest('[data-d]') as HTMLElement | null;
    if (!target) return;
    const act = target.dataset.d ?? '';
    const id = target.dataset.id as ShipId | undefined;
    if (act === 'close') {
      close();
      return;
    }
    if (act === 'inc' && id) {
      counts.set(id, Math.min(MAX_PER_CLASS, (counts.get(id) ?? 0) + 1));
      render();
      return;
    }
    if (act === 'dec' && id) {
      counts.set(id, Math.max(0, (counts.get(id) ?? 0) - 1));
      render();
      return;
    }
    if (act === 'reset') {
      counts.clear();
      editing = null;
      name = '';
      render();
      return;
    }
    if (act === 'save') {
      const trimmed = name.trim();
      if (!trimmed) return;
      const cost = armyCost(template());
      if (cost === 0 || cost > BUDGET) return;
      editing = saveArmyTemplate(template());
      render();
      return;
    }
    if (act === 'load' && target.dataset.id) {
      const t = listArmyTemplates().find((x) => x.id === target.dataset.id);
      if (!t) return;
      editing = t;
      name = t.name;
      counts.clear();
      for (const [key, value] of Object.entries(t.ships)) {
        if (typeof value === 'number') counts.set(key as ShipId, value);
      }
      render();
      return;
    }
    if (act === 'del' && target.dataset.id) {
      deleteArmyTemplate(target.dataset.id);
      if (editing?.id === target.dataset.id) {
        editing = null;
        counts.clear();
        name = '';
      }
      render();
    }
  });

  render();
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}
