import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../blood-pressure-card.js';

const BASE = { systolic: 'sensor.sys', diastolic: 'sensor.dia' };

test('defaults are filled in', () => {
  const c = normalizeConfig(BASE);
  assert.equal(c.default_view, 'month');
  assert.equal(c.pair_window, 120);
  assert.equal(c.height, 280);
  assert.equal(c.show_stats, true);
});

test('numeric strings are accepted for pair_window and height', () => {
  const c = normalizeConfig({ ...BASE, pair_window: '90', height: '320' });
  assert.equal(c.pair_window, 90);
  assert.equal(c.height, 320);
});

test('thresholds defaults to office and accepts home', () => {
  assert.equal(normalizeConfig(BASE).thresholds, 'office');
  assert.equal(normalizeConfig({ ...BASE, thresholds: 'home' }).thresholds, 'home');
});

test('range defaults to rolling and accepts calendar', () => {
  assert.equal(normalizeConfig(BASE).range, 'rolling');
  assert.equal(normalizeConfig({ ...BASE, range: 'calendar' }).range, 'calendar');
});

const rejects = [
  [{ range: 'fiscal' }, /range/],
  [{ thresholds: 'clinic' }, /thresholds/],
  [{ default_view: 'day' }, /default_view/],
  [{ height: 'tall' }, /height/],
  [{ height: 0 }, /height/],
  [{ height: 100000 }, /height/],
  [{ language: 'not a locale!' }, /language/],
  [{ systolic: 'sensor.bp', diastolic: 'sensor.bp' }, /different/],
  [{ systolic: 'Sensor Sys' }, /systolic/],
  [{ colors: { purple: '#fff' } }, /colors/],
  [{ colors: { g1: 'red" onload="alert(1)' } }, /colors/],
  [{ colors: { g1: 'url(javascript:alert(1))' } }, /colors/],
];
for (const [patch, re] of rejects) {
  test(`rejects ${JSON.stringify(patch)}`, () => {
    assert.throws(() => normalizeConfig({ ...BASE, ...patch }), re);
  });
}

const colours = ['#E53935', '#e539', 'rgb(229, 57, 53)', 'hsl(2 77% 56% / 0.8)', 'var(--error-color)', 'tomato'];
for (const g1 of colours) {
  test(`accepts colour ${g1}`, () => {
    assert.equal(normalizeConfig({ ...BASE, colors: { g1 } }).colors.g1, g1);
  });
}
