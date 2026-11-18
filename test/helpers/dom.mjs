// Loads the card into a happy-dom window so tests can drive the real custom
// element: setConfig, the hass setter and the rendered shadow DOM.
import { after, afterEach } from 'node:test';
import { Window } from 'happy-dom';

// Mounted cards keep a midnight timer; removing them clears it so the test
// process can exit.
afterEach(() => {
  document.body.replaceChildren();
});
after(() => {
  document.body.replaceChildren();
});

const win = new Window({ url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Event', 'CustomEvent']) {
  globalThis[key] = key === 'window' ? win : win[key];
}

const mod = await import('../../blood-pressure-card.js');
export const { BloodPressureCard, suggestCard } = mod;

const T = (iso) => Date.parse(iso) / 1000;

/**
 * Answer history_during_period the way HA does: rows inside [start, end), plus
 * (include_start_time_state) the last earlier state re-stamped at the start.
 */
function historyWindow(list, msg) {
  const s = Date.parse(msg.start_time) / 1000;
  const e = Date.parse(msg.end_time) / 1000;
  const before = list.filter((r) => r.lu < s);
  const inside = list.filter((r) => r.lu >= s && r.lu < e);
  return msg.include_start_time_state && before.length ? [{ ...before[before.length - 1], lu: s }, ...inside] : inside;
}

/** A minimal hass object whose callWS answers history_during_period from `history`. */
export function fakeHass({ history = {}, states, language = 'en', callWS } = {}) {
  const ids = Object.keys(history);
  return {
    language,
    locale: { language },
    states: states || Object.fromEntries(ids.map((id) => [id, { last_updated: '2026-11-18T08:00:00Z' }])),
    calls: [],
    callWS:
      callWS ||
      async function (msg) {
        this.calls.push(msg);
        return Object.fromEntries(
          msg.entity_ids.filter((id) => history[id]).map((id) => [id, historyWindow(history[id], msg)]),
        );
      },
  };
}

/** History rows in minimal_response shape from [iso, value] pairs. */
export const rows = (pairs) => pairs.map(([iso, s]) => ({ s: String(s), lu: T(iso) }));

/** Create a card, configure it, give it hass and wait for the load to settle. */
export async function mount(config, hass) {
  const el = document.createElement('blood-pressure-card');
  document.body.appendChild(el);
  el.setConfig(config);
  if (hass) {
    el.hass = hass;
    await settle();
  }
  return el;
}

// setImmediate, not setTimeout, so tests can mock timers and still settle.
export const settle = () => new Promise((r) => setImmediate(r));

export const text = (el) => (el.shadowRoot.querySelector('ha-card')?.textContent || '').replace(/\s+/g, ' ').trim();
