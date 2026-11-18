import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mount, fakeHass, text } from './helpers/dom.mjs';

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

for (const pair_window of ['2m', -5, 0, Infinity]) {
  test(`setConfig rejects pair_window ${String(pair_window)}`, async () => {
    const el = document.createElement('blood-pressure-card');
    assert.throws(() => el.setConfig({ ...BASE, pair_window }), /pair_window/);
  });
}
