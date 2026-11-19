import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mount, fakeHass, text, settle } from './helpers/dom.mjs';

// Most tests here check calendar boundaries (1 Nov, Monday); rolling has its own tests.
const BASE = { systolic: 'sensor.sys', diastolic: 'sensor.dia', range: 'calendar' };
const ROLLING = { systolic: 'sensor.sys', diastolic: 'sensor.dia' };

test('rolling is the default: last 30 days, with day-count buttons', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const lu = (...a) => new Date(...a).getTime() / 1000;
  const hass = fakeHass({
    history: { 'sensor.sys': [{ s: '131', lu: lu(2026, 9, 25, 8) }], 'sensor.dia': [{ s: '84', lu: lu(2026, 9, 25, 8, 0, 4) }] },
  });
  const el = await mount(ROLLING, hass);
  assert.match(text(el), /7 days\s*30 days\s*365 days/);
  assert.match(text(el), /Oct 20 – Nov 18/);
  assert.match(text(el), /131\/84/, 'a reading from 25 Oct is inside the last 30 days');
});

test('rolling window moves forward every midnight', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(2026, 10, 18, 23, 59, 30) });
  const hass = fakeHass({ states: { 'sensor.sys': {}, 'sensor.dia': {} } });
  const el = await mount({ ...ROLLING, default_view: 'week' }, hass);
  assert.match(text(el), /Nov 12 – Nov 18/);
  t.mock.timers.tick(60_000);
  await settle();
  assert.match(text(el), /Nov 13 – Nov 19/);
});

test('harness: setConfig attaches a shadow root', async () => {
  const el = await mount(BASE, null);
  assert.ok(el.shadowRoot, 'shadow root attached by setConfig');
});

test('a missing entity is named instead of showing "no readings"', async () => {
  const hass = fakeHass({ states: { 'sensor.dia': { last_updated: 'x' } } });
  const el = await mount(BASE, hass);
  assert.match(text(el), /sensor\.sys/);
  assert.doesNotMatch(text(el), /No readings/);
});

test('a missing optional pulse entity does not hide the chart', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const lu = (...a) => new Date(...a).getTime() / 1000;
  const hass = fakeHass({
    history: { 'sensor.sys': [{ s: '128', lu: lu(2026, 10, 17, 8) }], 'sensor.dia': [{ s: '82', lu: lu(2026, 10, 17, 8, 0, 4) }] },
  });
  const el = await mount({ ...BASE, pulse: 'sensor.pulse' }, hass);
  assert.match(text(el), /128\/82/);
});

test('an HA error object without message is shown readably and logged', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const hass = fakeHass({
    states: { 'sensor.sys': {}, 'sensor.dia': {} },
    callWS: async () => {
      throw { code: 'unauthorized', message: undefined };
    },
  });
  const el = await mount(BASE, hass);
  assert.doesNotMatch(text(el), /object Object/);
  assert.match(text(el), /unauthorized/);
  assert.equal(logged.mock.callCount(), 1);
});

test('an exception before the request shows an error instead of a stale card', async (t) => {
  t.mock.method(console, 'error', () => {});
  const hass = fakeHass({ states: { 'sensor.sys': {}, 'sensor.dia': {} }, language: 'not a locale!' });
  const el = await mount(BASE, hass);
  assert.match(text(el), /Could not load history/);
});

test('a reading that starts before the period does not leak into it', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const lu = (...a) => new Date(...a).getTime() / 1000;
  const hass = fakeHass({
    history: {
      'sensor.sys': [
        { s: '120', lu: lu(2026, 9, 20, 8) },
        { s: '150', lu: lu(2026, 9, 31, 23, 59, 30) }, // measured 30 s before 1 Nov
      ],
      'sensor.dia': [
        { s: '80', lu: lu(2026, 9, 20, 8) },
        { s: '95', lu: lu(2026, 10, 1, 0, 0, 20) }, // its diastolic lands 20 s into November
      ],
    },
  });
  const el = await mount(BASE, hass);
  assert.doesNotMatch(text(el), /150\/95/);
  assert.match(text(el), /No readings/);
});

test('an outage across the period start does not create a phantom reading', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const lu = (...a) => new Date(...a).getTime() / 1000;
  const series = (v) => [
    { s: String(v), lu: lu(2026, 9, 30, 8) }, // last real measurement, 30 Oct
    { s: 'unavailable', lu: lu(2026, 9, 31, 23) }, // outage across midnight into November
    { s: String(v), lu: lu(2026, 10, 1, 0, 5) }, // back with the old value
  ];
  const hass = fakeHass({ history: { 'sensor.sys': series(128), 'sensor.dia': series(82) } });
  const el = await mount(BASE, hass);
  assert.doesNotMatch(text(el), /128\/82/);
  assert.match(text(el), /No readings/);
  assert.equal(hass.calls.length, 2, 'one extra lookback request');
});

test('no lookback request when the period starts on a number', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const lu = (...a) => new Date(...a).getTime() / 1000;
  const hass = fakeHass({
    history: { 'sensor.sys': [{ s: '128', lu: lu(2026, 9, 30, 8) }], 'sensor.dia': [{ s: '82', lu: lu(2026, 9, 30, 8) }] },
  });
  await mount(BASE, hass);
  assert.equal(hass.calls.length, 1);
});

test('with the HA profile set to server time, days follow the server zone', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-20T03:00:00Z') });
  const at = Date.parse('2026-11-18T01:00:00+09:00') / 1000; // 18 Nov in Tokyo, 17 Nov in Europe/America
  const hass = fakeHass({
    history: { 'sensor.sys': [{ s: '128', lu: at }], 'sensor.dia': [{ s: '82', lu: at + 4 }] },
  });
  hass.locale.time_zone = 'server';
  hass.config = { time_zone: 'Asia/Tokyo' };
  const el = await mount(BASE, hass);
  assert.equal(el._data.buckets.findIndex((b) => b.n), 17, 'reading lands on 18 Nov (index 17)');
});

test('an open dashboard moves to the new week after midnight', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(2026, 10, 22, 23, 59, 30) }); // Sunday
  const hass = fakeHass({ states: { 'sensor.sys': {}, 'sensor.dia': {} } });
  const el = await mount({ ...BASE, default_view: 'week' }, hass);
  assert.match(text(el), /Nov 16 – Nov 22/);
  t.mock.timers.tick(60_000);
  await settle();
  assert.match(text(el), /Nov 23 – Nov 29/);
  el.remove();
});

test('a removed card stops its midnight timer', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(2026, 10, 22, 23, 59, 30) });
  const hass = fakeHass({ states: { 'sensor.sys': {}, 'sensor.dia': {} } });
  const el = await mount({ ...BASE, default_view: 'week' }, hass);
  const calls = hass.calls.length;
  el.remove();
  t.mock.timers.tick(3 * 86400e3);
  await settle();
  assert.equal(hass.calls.length, calls);
});

test('home thresholds colour a 137/86 day as hypertension and say which table is used', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const lu = (...a) => new Date(...a).getTime() / 1000;
  const hass = fakeHass({
    history: { 'sensor.sys': [{ s: '137', lu: lu(2026, 10, 17, 8) }], 'sensor.dia': [{ s: '86', lu: lu(2026, 10, 17, 8, 0, 4) }] },
  });
  const el = await mount({ ...BASE, thresholds: 'home', summary: 'average' }, hass);
  assert.match(text(el), /Hypertension grade 1/);
  assert.match(text(el), /home/i);
  const ref = [...el.shadowRoot.querySelectorAll('line.ref')];
  assert.equal(ref.length, 2, 'two reference lines');
});

test('a period the recorder holds no history for says The history may be purged', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const hass = fakeHass({ history: { 'sensor.sys': [], 'sensor.dia': [] } });
  const el = await mount({ ...BASE, default_view: 'week' }, hass);
  assert.match(text(el), /The history may be purged/, 'even for the current week: no rows means no history');
});

test('an old period with history around it but no readings just says no readings', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const lu = (...a) => new Date(...a).getTime() / 1000;
  // A recorder that keeps a year: one reading in January, none in March.
  const hass = fakeHass({
    history: { 'sensor.sys': [{ s: '128', lu: lu(2026, 0, 10, 8) }], 'sensor.dia': [{ s: '82', lu: lu(2026, 0, 10, 8) }] },
  });
  const el = await mount(BASE, hass);
  for (let i = 0; i < 8; i++) {
    el.shadowRoot.querySelector('[data-nav="-1"]').click();
    await settle();
  }
  assert.match(text(el), /Mar/);
  assert.match(text(el), /No readings in this period/);
  assert.doesNotMatch(text(el), /purged/);
});

const historyCalls = (hass) => hass.calls.filter((m) => m.type === 'history/history_during_period').length;
const click = async (el, sel) => {
  el.shadowRoot.querySelector(sel).click();
  await settle();
};

test('switching back to a period already shown does not ask HA again', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const lu = (...a) => new Date(...a).getTime() / 1000;
  const hass = fakeHass({
    history: { 'sensor.sys': [{ s: '128', lu: lu(2026, 10, 17, 8) }], 'sensor.dia': [{ s: '82', lu: lu(2026, 10, 17, 8) }] },
  });
  const el = await mount({ ...BASE, default_view: 'week' }, hass);
  await click(el, '[data-view="month"]');
  await click(el, '[data-view="week"]');
  await click(el, '[data-nav="-1"]');
  await click(el, '[data-nav="1"]');
  assert.equal(historyCalls(hass), 3, 'week, month, previous week; the rest come from the cache');
  assert.match(text(el), /128\/82/);
});

test('a new measurement empties the cache, so revisited periods are fresh', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const lu = (...a) => new Date(...a).getTime() / 1000;
  const history = { 'sensor.sys': [{ s: '128', lu: lu(2026, 10, 17, 8) }], 'sensor.dia': [{ s: '82', lu: lu(2026, 10, 17, 8) }] };
  const hass = fakeHass({ history });
  const el = await mount({ ...BASE, default_view: 'week' }, hass);
  await click(el, '[data-view="month"]');
  history['sensor.sys'].push({ s: '150', lu: lu(2026, 10, 18, 9) });
  history['sensor.dia'].push({ s: '95', lu: lu(2026, 10, 18, 9) });
  el.hass = { ...hass, states: { 'sensor.sys': { last_updated: 'new' }, 'sensor.dia': { last_updated: 'new' } } };
  await settle();
  await click(el, '[data-view="week"]');
  assert.equal(historyCalls(hass), 4, 'week, month, month reload, week refetch');
  assert.match(text(el), /150\/95/);
});

test('the calendar week follows the first weekday from the HA profile', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const hass = fakeHass({ states: { 'sensor.sys': {}, 'sensor.dia': {} } });
  hass.locale.first_weekday = 'sunday';
  const el = await mount({ ...BASE, default_view: 'week' }, hass);
  assert.match(text(el), /Nov 15 – Nov 21/);
});

test('"language" as first weekday takes it from the locale', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const hass = fakeHass({ states: { 'sensor.sys': {}, 'sensor.dia': {} }, language: 'en-US' });
  hass.locale.first_weekday = 'language';
  const el = await mount({ ...BASE, default_view: 'week' }, hass);
  assert.match(text(el), /Nov 15 – Nov 21/, 'US weeks start on Sunday');
});

test('a pulse update reloads the card', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const st = (p) => ({ 'sensor.sys': { last_updated: 'a' }, 'sensor.dia': { last_updated: 'a' }, 'sensor.pulse': { last_updated: p } });
  const hass = fakeHass({ states: st('1') });
  const el = await mount({ ...BASE, pulse: 'sensor.pulse' }, hass);
  const before = hass.calls.length;
  el.hass = { ...hass, states: st('2') };
  await settle();
  assert.equal(hass.calls.length, before + 1);
});

test('‹ stops at a period the recorder has no history for', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const hass = fakeHass({ history: { 'sensor.sys': [], 'sensor.dia': [] } });
  const el = await mount(BASE, hass);
  assert.equal(el.shadowRoot.querySelector('[data-nav="-1"]').disabled, true);
});

test('the card tells screen readers which language it is in', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const el = await mount({ ...BASE, language: 'pl' }, fakeHass({ states: { 'sensor.sys': {}, 'sensor.dia': {} } }));
  assert.equal(el.shadowRoot.querySelector('ha-card').getAttribute('lang'), 'pl');
});

test('axis labels use the font size that fits the card width', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const el = await mount(BASE, fakeHass({ states: { 'sensor.sys': {}, 'sensor.dia': {} } }));
  el._fs = 24;
  el._render();
  assert.equal(el.shadowRoot.querySelector('text.ylab').getAttribute('font-size'), '24');
});

const twoReadings = () => {
  const lu = (...a) => new Date(...a).getTime() / 1000;
  return fakeHass({
    history: {
      'sensor.sys': [{ s: '128', lu: lu(2026, 10, 15, 8) }, { s: '137', lu: lu(2026, 10, 17, 20) }],
      'sensor.dia': [{ s: '82', lu: lu(2026, 10, 15, 8, 0, 4) }, { s: '86', lu: lu(2026, 10, 17, 20, 0, 4) }],
    },
  });
};

test('the panel under the chart shows the last reading of the period', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const el = await mount({ ...ROLLING, default_view: 'week' }, twoReadings());
  const sel = el.shadowRoot.querySelectorAll('.sel');
  assert.equal(sel.length, 1);
  assert.match(sel[0].textContent, /Last reading/);
  assert.match(sel[0].textContent, /137\/86/);
  assert.match(sel[0].textContent, /Nov 17/);
});

test('selecting a day replaces the last reading in the same panel, Escape brings it back', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const el = await mount({ ...ROLLING, default_view: 'week' }, twoReadings());
  el.shadowRoot.querySelector('[data-i="3"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }));
  let sel = el.shadowRoot.querySelectorAll('.sel');
  assert.equal(sel.length, 1, 'one panel, not two');
  assert.match(sel[0].textContent, /Nov 15/);
  assert.doesNotMatch(sel[0].textContent, /Last reading/);
  el.shadowRoot.querySelector('.chart').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
  sel = el.shadowRoot.querySelectorAll('.sel');
  assert.match(sel[0].textContent, /Last reading/);
});

test('a day without readings still uses the two-line panel', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const el = await mount({ ...ROLLING, default_view: 'week' }, twoReadings());
  el.shadowRoot.querySelector('[data-i="0"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }));
  const sel = el.shadowRoot.querySelector('.sel');
  assert.equal(sel.children.length, 2, 'title line and detail line, like a day with readings');
  assert.match(sel.textContent, /no readings/);
});

test('show_extremes: false hides the highest and lowest lists but keeps the panel', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const el = await mount({ ...ROLLING, default_view: 'week', show_extremes: false }, twoReadings());
  assert.doesNotMatch(text(el), /Highest values|Lowest values/);
  assert.match(el.shadowRoot.querySelector('.sel').textContent, /Last reading/);
  const on = await mount({ ...ROLLING, default_view: 'week' }, twoReadings());
  assert.match(text(on), /Highest values/, 'on by default');
});

test('summary: average shows the period average in the panel, not the last reading', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  const el = await mount({ ...ROLLING, default_view: 'week', summary: 'average' }, twoReadings());
  const sel = () => el.shadowRoot.querySelector('.sel');
  assert.match(sel().textContent, /Average · 2 readings/);
  assert.doesNotMatch(sel().textContent, /Last reading/);
  assert.equal(sel().children.length, 2, 'same two lines as a selected day');
  el.shadowRoot.querySelector('[data-i="3"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }));
  assert.equal(el.shadowRoot.querySelectorAll('.sel').length, 1, 'the day replaces the average');
  assert.doesNotMatch(sel().textContent, /Average/);
  el.shadowRoot.querySelector('.chart').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
  assert.match(sel().textContent, /Average/);
});

test('the highest and lowest lists do not depend on the panel choice', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18, 12) });
  for (const summary of ['last', 'average']) {
    const el = await mount({ ...ROLLING, default_view: 'week', summary }, twoReadings());
    assert.match(text(el), /Highest values/, summary);
  }
});

for (const pair_window of ['2m', -5, 0, Infinity]) {
  test(`setConfig rejects pair_window ${String(pair_window)}`, async () => {
    const el = document.createElement('blood-pressure-card');
    assert.throws(() => el.setConfig({ ...BASE, pair_window }), /pair_window/);
  });
}
