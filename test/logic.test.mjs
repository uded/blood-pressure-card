import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSeries, buildReadings, aggregate, summarize, makeRange, classify } from '../blood-pressure-card.js';

const T = (iso) => Date.parse(iso) / 1000;
const START = Date.parse('2026-11-01T00:00:00Z');
const END = Date.parse('2026-12-01T00:00:00Z');

test('start-time state and restart repeats are not readings', () => {
  const s = parseSeries(
    [
      { s: '150', lu: START / 1000 }, // state carried in from before the period
      { s: '142', lu: T('2026-11-03T07:00:00Z') },
      { s: 'unavailable', lu: T('2026-11-04T03:00:00Z') },
      { s: '142', lu: T('2026-11-04T03:01:00Z') }, // HA restart, same value
      { s: '138', lu: T('2026-11-05T07:00:00Z') },
    ],
    START,
  );
  assert.equal(s.events.length, 2);
  assert.equal(s.points.length, 4);
});

test('first value counts when the sensor had no prior history', () => {
  const s = parseSeries([{ s: '130', lu: T('2026-11-02T08:00:00Z') }], START);
  assert.equal(s.events.length, 1);
});

test('pairs systolic and diastolic, even if only one changed', () => {
  const sys = parseSeries(
    [
      { s: '150', lu: START / 1000 },
      { s: '142', lu: T('2026-11-03T07:00:00Z') },
      { s: '135', lu: T('2026-11-03T19:00:05Z') },
    ],
    START,
  );
  const dia = parseSeries(
    [
      { s: '95', lu: START / 1000 },
      { s: '87', lu: T('2026-11-03T07:00:02Z') },
      // evening reading: diastolic identical (87) -> no state change
    ],
    START,
  );
  const r = buildReadings(sys, dia, null, START, END, 120000);
  assert.deepEqual(
    r.map((x) => [x.sys, x.dia]),
    [
      [142, 87],
      [135, 87],
    ],
  );
});

test('aggregates per day and summarises', () => {
  const range = makeRange('month', 0, new Date(2026, 10, 18), 'en');
  const d = (day, h) => new Date(2026, 10, day, h).getTime();
  const readings = [
    { t: d(3, 7), sys: 165, dia: 102, pulse: 80 },
    { t: d(3, 20), sys: 147, dia: 95, pulse: 70 },
    { t: d(10, 8), sys: 129, dia: 89, pulse: 66 },
  ];
  const b = aggregate(readings, range.buckets);
  assert.equal(b.length, 30);
  assert.equal(b[2].n, 2);
  assert.equal(b[2].sysMin, 147);
  assert.equal(b[2].sysMax, 165);
  assert.equal(b[2].diaMin, 95);
  assert.equal(b[9].n, 1);
  const s = summarize(readings);
  assert.equal(s.sysHigh.sys, 165);
  assert.equal(s.sysLow.dia, 89);
  assert.equal(Math.round(s.sysAvg), 147);
});

test('week starts on Monday, year has 12 buckets', () => {
  const w = makeRange('week', 0, new Date(2026, 10, 18), 'en'); // Wed
  assert.equal(w.start.getDay(), 1);
  assert.equal(w.buckets.length, 7);
  assert.equal(makeRange('year', -1, new Date(2026, 10, 18), 'en').label, '2025');
});

test('ESH classification', () => {
  assert.equal(classify(118, 76), 'o');
  assert.equal(classify(125, 79), 'n');
  assert.equal(classify(129, 86), 'hn');
  assert.equal(classify(142, 87), 'g1');
  assert.equal(classify(150, 101), 'g2');
  assert.equal(classify(181, 90), 'g3');
});
