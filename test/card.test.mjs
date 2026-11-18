import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mount, fakeHass, text, settle } from './helpers/dom.mjs';

const BASE = { systolic: 'sensor.sys', diastolic: 'sensor.dia' };

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
  const el = await mount({ ...BASE, thresholds: 'home' }, hass);
  assert.match(text(el), /Hypertension grade 1/);
  assert.match(text(el), /home/i);
  const ref = [...el.shadowRoot.querySelectorAll('line.ref')];
  assert.equal(ref.length, 2, 'two reference lines');
});

for (const pair_window of ['2m', -5, 0, Infinity]) {
  test(`setConfig rejects pair_window ${String(pair_window)}`, async () => {
    const el = document.createElement('blood-pressure-card');
    assert.throws(() => el.setConfig({ ...BASE, pair_window }), /pair_window/);
  });
}
