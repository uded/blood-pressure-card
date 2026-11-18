import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mount, fakeHass, settle, PALETTE } from './helpers/dom.mjs';

const BASE = { systolic: 'sensor.sys', diastolic: 'sensor.dia', default_view: 'week' };
const lu = (...a) => new Date(...a).getTime() / 1000;

// Two readings in the last 7 days (12 to 18 Nov 2026): 15 Nov and 17 Nov.
const withReadings = (opts = {}) =>
  fakeHass({
    history: {
      'sensor.sys': [{ s: '128', lu: lu(2026, 10, 15, 8) }, { s: '137', lu: lu(2026, 10, 17, 8) }],
      'sensor.dia': [{ s: '82', lu: lu(2026, 10, 15, 8, 0, 4) }, { s: '86', lu: lu(2026, 10, 17, 8, 0, 4) }],
    },
    ...opts,
  });

const key = (el, k) => {
  const chart = el.shadowRoot.querySelector('.chart');
  chart.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, composed: true }));
};
const selTitle = (el) => el.shadowRoot.querySelector('.sel b')?.textContent;

test('the chart is focusable and the SVG summarises the period for screen readers', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const el = await mount(BASE, withReadings());
  const chart = el.shadowRoot.querySelector('.chart');
  assert.equal(chart.getAttribute('tabindex'), '0');
  assert.ok(chart.getAttribute('aria-label'), 'the chart says how to use it');
  const svg = el.shadowRoot.querySelector('svg');
  assert.equal(svg.getAttribute('role'), 'img');
  assert.match(svg.getAttribute('aria-label'), /Nov 12 – Nov 18/);
  assert.match(svg.getAttribute('aria-label'), /133\/84/, 'period average');
});

test('arrow keys choose a day, Home and End jump, Escape closes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const el = await mount(BASE, withReadings());
  key(el, 'ArrowLeft');
  assert.match(selTitle(el), /18/, 'first press picks today, the newest day');
  key(el, 'ArrowLeft');
  assert.match(selTitle(el), /17/);
  key(el, 'Home');
  assert.match(selTitle(el), /12/);
  key(el, 'ArrowLeft');
  assert.match(selTitle(el), /12/, 'stops at the first day');
  key(el, 'End');
  assert.match(selTitle(el), /18/);
  key(el, 'Escape');
  assert.equal(el.shadowRoot.querySelector('.sel'), null);
});

test('the selected day is announced through a live region', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const el = await mount(BASE, withReadings());
  const live = el.shadowRoot.querySelector('[aria-live="polite"]');
  assert.ok(live, 'live region exists before anything is selected');
  key(el, 'End');
  assert.match(el.shadowRoot.querySelector('[aria-live="polite"]').textContent, /18/);
});

test('focus stays on the chart while moving through days', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const el = await mount(BASE, withReadings());
  el.shadowRoot.querySelector('.chart').focus();
  key(el, 'ArrowLeft');
  key(el, 'ArrowLeft');
  assert.equal(el.shadowRoot.activeElement, el.shadowRoot.querySelector('.chart'));
});

test('focus stays on the period button after switching views', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const el = await mount(BASE, withReadings());
  el.shadowRoot.querySelector('[data-view="month"]').focus();
  el.shadowRoot.querySelector('[data-view="month"]').click();
  await settle();
  const active = el.shadowRoot.activeElement;
  assert.equal(active && active.dataset.view, 'month');
  assert.equal(active.getAttribute('aria-pressed'), 'true');
});

test('focus stays on ‹ after stepping back', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const el = await mount(BASE, withReadings());
  el.shadowRoot.querySelector('[data-nav="-1"]').focus();
  el.shadowRoot.querySelector('[data-nav="-1"]').click();
  await settle();
  assert.equal(el.shadowRoot.activeElement && el.shadowRoot.activeElement.dataset.nav, '-1');
});

test('previous and next buttons are labelled in the card language', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const el = await mount({ ...BASE, language: 'pl' }, withReadings());
  assert.equal(el.shadowRoot.querySelector('[data-nav="-1"]').getAttribute('aria-label'), 'Poprzedni okres');
  assert.equal(el.shadowRoot.querySelector('[data-nav="1"]').getAttribute('aria-label'), 'Następny okres');
});

const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

for (const [mode, bg] of [['light', '#FFFFFF'], ['dark', '#1C1C1C']]) {
  test(`every ${mode} theme colour has at least 3:1 contrast against the card`, () => {
    for (const [cat, c] of Object.entries(PALETTE[mode])) {
      assert.ok(contrast(c, bg) >= 3, `${cat} ${c}: ${contrast(c, bg).toFixed(2)}`);
    }
  });
}

test('a light theme uses the light palette, a dark theme the dark one', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const dotColour = (el) => el.shadowRoot.querySelector('.catline .dot').style.background.toUpperCase();
  const light = await mount(BASE, withReadings({ darkMode: false }));
  const dark = await mount(BASE, withReadings({ darkMode: true }));
  const hex = (c) => c.toUpperCase();
  const rgb = (h) => `RGB(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
  assert.ok([hex(PALETTE.light.hn), rgb(PALETTE.light.hn)].includes(dotColour(light)), dotColour(light));
  assert.ok([hex(PALETTE.dark.hn), rgb(PALETTE.dark.hn)].includes(dotColour(dark)), dotColour(dark));
});
