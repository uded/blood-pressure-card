import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BloodPressureCard, fakeHass, suggestCard } from './helpers/dom.mjs';

const states = (...ids) => ({ states: Object.fromEntries(ids.map((id) => [id, { state: '120', attributes: {} }])) });

test('suggests the card for a Withings systolic sensor, with partner and pulse', () => {
  const hass = states(
    'sensor.withings_systolic_blood_pressure',
    'sensor.withings_diastolic_blood_pressure',
    'sensor.withings_heart_pulse',
    'sensor.withings_weight',
  );
  const s = suggestCard(hass, 'sensor.withings_systolic_blood_pressure');
  assert.deepEqual(s.config, {
    type: 'custom:blood-pressure-card',
    systolic: 'sensor.withings_systolic_blood_pressure',
    diastolic: 'sensor.withings_diastolic_blood_pressure',
    pulse: 'sensor.withings_heart_pulse',
  });
});

test('suggests the card from the diastolic side, iPhone naming, no pulse', () => {
  const hass = states('sensor.phone_blood_pressure_systolic', 'sensor.phone_blood_pressure_diastolic');
  const s = suggestCard(hass, 'sensor.phone_blood_pressure_diastolic');
  assert.equal(s.config.systolic, 'sensor.phone_blood_pressure_systolic');
  assert.equal(s.config.diastolic, 'sensor.phone_blood_pressure_diastolic');
  assert.equal('pulse' in s.config, false);
});

test('no suggestion for unrelated entities or a systolic sensor without a partner', () => {
  assert.equal(suggestCard(states('sensor.withings_weight'), 'sensor.withings_weight'), null);
  assert.equal(suggestCard(states('sensor.x_systolic'), 'sensor.x_systolic'), null);
  assert.equal(suggestCard(states('light.systolic', 'light.diastolic'), 'light.systolic'), null);
});

test('stub config pairs systolic and diastolic from the same source', () => {
  const hass = states(
    'sensor.phone_blood_pressure_diastolic',
    'sensor.withings_systolic_blood_pressure',
    'sensor.withings_diastolic_blood_pressure',
    'sensor.phone_blood_pressure_systolic',
  );
  const c = BloodPressureCard.getStubConfig(hass);
  assert.equal(c.systolic.replace('systolic', 'X'), c.diastolic.replace('diastolic', 'X'));
});

test('the customCards entry exposes getEntitySuggestion', () => {
  const entry = window.customCards.find((c) => c.type === 'blood-pressure-card');
  assert.equal(typeof entry.getEntitySuggestion, 'function');
  assert.equal(entry.preview, true);
});

const BASE = { type: 'custom:blood-pressure-card', systolic: 'sensor.sys', diastolic: 'sensor.dia' };

const editor = () => {
  const el = BloodPressureCard.getConfigElement();
  document.body.appendChild(el);
  el.hass = fakeHass();
  el.setConfig(BASE);
  return el;
};

test('card provides a visual editor element', () => {
  const el = BloodPressureCard.getConfigElement();
  assert.equal(el.localName, 'blood-pressure-card-editor');
});

test('editor renders an ha-form with the config and an entity picker for systolic', () => {
  const form = editor().shadowRoot.querySelector('ha-form');
  assert.ok(form, 'ha-form rendered');
  assert.equal(form.data.systolic, 'sensor.sys');
  const sys = form.schema.flatMap((s) => s.schema || [s]).find((s) => s.name === 'systolic');
  assert.deepEqual(sys.selector, { entity: { domain: 'sensor' } });
});

test('editor offers rolling and calendar periods, rolling by default', () => {
  const form = editor().shadowRoot.querySelector('ha-form');
  const f = form.schema.flatMap((s) => s.schema || [s]).find((s) => s.name === 'range');
  assert.deepEqual(f.selector.select.options.map((o) => o.value), ['rolling', 'calendar']);
  assert.equal(form.data.range, 'rolling');
});

test('editor offers office and home thresholds', () => {
  const form = editor().shadowRoot.querySelector('ha-form');
  const f = form.schema.flatMap((s) => s.schema || [s]).find((s) => s.name === 'thresholds');
  assert.deepEqual(f.selector.select.options.map((o) => o.value), ['office', 'home']);
  assert.equal(form.data.thresholds, 'office');
});

test('editor has a switch for the highest and lowest lists', () => {
  const form = editor().shadowRoot.querySelector('ha-form');
  const f = form.schema.flatMap((s) => s.schema || [s]).find((s) => s.name === 'show_extremes');
  assert.deepEqual(f.selector, { boolean: {} });
  assert.equal(form.data.show_extremes, true);
});

test('editor offers last reading or average for the panel, last by default', () => {
  const form = editor().shadowRoot.querySelector('ha-form');
  const f = form.schema.flatMap((s) => s.schema || [s]).find((s) => s.name === 'summary');
  assert.deepEqual(f.selector.select.options.map((o) => o.value), ['last', 'average']);
  assert.equal(form.data.summary, 'last');
  assert.equal(form.schema.some((s) => s.name === 'show_stats'), false);
});

test('editing a field fires config-changed with the merged config', () => {
  const el = editor();
  let got = null;
  el.addEventListener('config-changed', (ev) => (got = ev.detail.config));
  const form = el.shadowRoot.querySelector('ha-form');
  form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...form.data, default_view: 'week' } } }));
  assert.equal(got.default_view, 'week');
  assert.equal(got.type, 'custom:blood-pressure-card');
});

test('clearing an optional field removes it from the config', () => {
  const el = editor();
  el.setConfig({ ...BASE, pulse: 'sensor.pulse', title: 'BP' });
  let got = null;
  el.addEventListener('config-changed', (ev) => (got = ev.detail.config));
  const form = el.shadowRoot.querySelector('ha-form');
  form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...form.data, pulse: undefined, title: '' } } }));
  assert.equal('pulse' in got, false);
  assert.equal(got.title, '', 'an empty title is meaningful: it hides the title');
});

test('editor hands hass to the form for the entity pickers', () => {
  const el = editor();
  const hass = fakeHass();
  el.hass = hass;
  assert.equal(el.shadowRoot.querySelector('ha-form').hass, hass);
});
