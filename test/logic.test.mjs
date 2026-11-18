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

test('recovery from unavailable at period start is not a reading when the value is unchanged', () => {
  const rows = [
    { s: 'unavailable', lu: START / 1000 }, // state carried in from before the period
    { s: '128', lu: T('2026-11-01T00:05:00Z') }, // sensor back with the old value
  ];
  assert.equal(parseSeries(rows, START, 128).events.length, 0);
  assert.equal(parseSeries(rows, START, 135).events.length, 1, 'a different value is a real reading');
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

test('periods can be built in a time zone other than the browser one', () => {
  const now = new Date('2026-11-18T01:00:00+09:00'); // still 17 Nov in Europe and America
  const w = makeRange('week', 0, now, 'en', 'Asia/Tokyo');
  assert.equal(w.start.getTime(), Date.parse('2026-11-16T00:00:00+09:00'), 'Monday 16 Nov, Tokyo midnight');
  assert.equal(w.buckets[2].s.getTime(), Date.parse('2026-11-18T00:00:00+09:00'));
  const m = makeRange('month', -1, now, 'en', 'Asia/Tokyo');
  assert.equal(m.start.getTime(), Date.parse('2026-10-01T00:00:00+09:00'));
  assert.equal(m.buckets.length, 31);
  const y = makeRange('year', 0, now, 'en', 'Asia/Tokyo');
  assert.equal(y.end.getTime(), Date.parse('2027-01-01T00:00:00+09:00'));
});

test('zoned days follow DST: 29 Mar 2026 in Warsaw is 23 hours', () => {
  const w = makeRange('week', 0, new Date('2026-03-25T12:00:00Z'), 'en', 'Europe/Warsaw');
  const sunday = w.buckets[6];
  assert.equal(sunday.s.getTime(), Date.parse('2026-03-29T00:00:00+01:00'));
  assert.equal(sunday.e.getTime() - sunday.s.getTime(), 23 * 3600e3);
});

const W = 'Europe/Warsaw';
const NOW = new Date('2026-11-18T12:00:00+01:00'); // Wednesday
const at = (iso) => Date.parse(iso);

test('rolling week: the last 7 days including today', () => {
  const r = makeRange('week', 0, NOW, 'en', W, 'rolling');
  assert.equal(r.start.getTime(), at('2026-11-12T00:00:00+01:00'));
  assert.equal(r.end.getTime(), at('2026-11-19T00:00:00+01:00'));
  assert.equal(r.buckets.length, 7);
  assert.equal(r.buckets[6].s.getTime(), at('2026-11-18T00:00:00+01:00'));
  assert.equal(r.label, 'Nov 12 – Nov 18');
});

test('rolling 30 days, and one step back', () => {
  const r = makeRange('month', 0, NOW, 'en', W, 'rolling');
  assert.equal(r.buckets.length, 30);
  assert.equal(r.start.getTime(), at('2026-10-20T00:00:00+02:00'));
  const prev = makeRange('month', -1, NOW, 'en', W, 'rolling');
  assert.equal(prev.end.getTime(), r.start.getTime());
  assert.equal(prev.buckets.length, 30);
});

test('rolling 365 days: monthly bars, partial at both ends', () => {
  const r = makeRange('year', 0, NOW, 'en', W, 'rolling');
  assert.equal(r.start.getTime(), at('2025-11-19T00:00:00+01:00'));
  assert.equal(r.end.getTime(), at('2026-11-19T00:00:00+01:00'));
  assert.equal(r.buckets.length, 13);
  assert.equal(r.buckets[0].e.getTime(), at('2025-12-01T00:00:00+01:00'));
  assert.equal(r.buckets[12].s.getTime(), at('2026-11-01T00:00:00+01:00'));
  assert.match(r.buckets[0].title, /^Nov 19\s–\s30, 2025$/); // Intl uses thin spaces around the dash
  assert.equal(r.buckets[1].title, 'December 2025');
  assert.match(r.label, /2025.*2026/);
  for (let i = 1; i < r.buckets.length; i++) assert.equal(r.buckets[i].s.getTime(), r.buckets[i - 1].e.getTime());
});

test('calendar mode is unchanged', () => {
  const r = makeRange('month', 0, NOW, 'en', W, 'calendar');
  assert.equal(r.start.getTime(), at('2026-11-01T00:00:00+01:00'));
  assert.equal(r.label, 'November 2026');
});

test('ESH classification', () => {
  assert.equal(classify(118, 76), 'o');
  assert.equal(classify(125, 79), 'n');
  assert.equal(classify(129, 86), 'hn');
  assert.equal(classify(142, 87), 'g1');
  assert.equal(classify(150, 101), 'g2');
  assert.equal(classify(181, 90), 'g3');
});

test('home thresholds: hypertension from 135/85', () => {
  assert.equal(classify(137, 86, 'office'), 'hn');
  assert.equal(classify(137, 86, 'home'), 'g1');
  assert.equal(classify(134, 80, 'home'), 'hn');
  assert.equal(classify(120, 85, 'home'), 'g1');
  assert.equal(classify(118, 76, 'home'), 'o');
  assert.equal(classify(165, 90, 'home'), 'g2');
  assert.equal(classify(137, 86), 'hn', 'office stays the default');
});

test('aggregate and summarize use the chosen thresholds', () => {
  const readings = [{ t: START + 3600e3, sys: 137, dia: 86, pulse: null }];
  const [b] = aggregate(readings, [{ s: new Date(START), e: new Date(END) }], 'home');
  assert.equal(b.cat, 'g1');
  assert.equal(summarize(readings, 'home').cat, 'g1');
  assert.equal(summarize(readings).cat, 'hn');
});

test('non-numeric text such as "12/80" is not read as 12', () => {
  const s = parseSeries([{ s: '12/80', lu: T('2026-11-02T08:00:00Z') }], START);
  assert.equal(s.points.length, 0);
});

test('implausible readings are dropped', () => {
  const at = (iso, v) => parseSeries([{ s: String(v), lu: T(iso) }], START);
  const cases = [
    [65535, 80],
    [0, 80],
    [130, 0],
    [130, 250],
    [80, 120], // diastolic above systolic
  ];
  for (const [s, d] of cases) {
    const r = buildReadings(at('2026-11-02T08:00:00Z', s), at('2026-11-02T08:00:05Z', d), null, START, END, 120e3);
    assert.deepEqual(r, [], `${s}/${d} should be dropped`);
  }
  const ok = buildReadings(at('2026-11-02T08:00:00Z', 128), at('2026-11-02T08:00:05Z', 82), null, START, END, 120e3);
  assert.equal(ok.length, 1);
});

test('category matches the rounded average that is displayed', () => {
  // 140 + 139 + 139 + 140 + 140 = 698 / 5 = 139.6, shown as 140.
  const readings = [140, 139, 139, 140, 140].map((sys, i) => ({ t: START + i * 3600e3, sys, dia: 80, pulse: null }));
  const [b] = aggregate(readings, [{ s: new Date(START), e: new Date(END) }]);
  assert.equal(Math.round(b.sysAvg), 140);
  assert.equal(b.cat, 'g1');
  assert.equal(summarize(readings).cat, 'g1');
});
