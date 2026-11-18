/**
 * blood-pressure-card — a Home Assistant Lovelace card that draws blood
 * pressure the way the Withings app does: one vertical "range candle" per
 * day (or month), with a capsule spanning the systolic range at the top,
 * a capsule spanning the diastolic range at the bottom, and a line joining
 * them. Works with any pair of systolic/diastolic sensors (Withings, Apple
 * Health via the companion app, Google Health Connect, ...).
 *
 * Data comes from the recorder history (every state change = one reading),
 * so the period you can look back on is limited by `recorder.purge_keep_days`.
 *
 * MIT licensed. https://github.com/uded/blood-pressure-card
 */

export const VERSION = '0.2.4';

const DAY = 86400000;

/**
 * Lower bounds [systolic, diastolic] of each category, worst first; either
 * number reaching a bound is enough. `office` is the ESH 2023 office table.
 * `home` moves the hypertension boundary to the ESH home threshold, 135/85;
 * ESH defines no home grades 2 and 3, so those keep the office values.
 */
export const THRESHOLDS = {
  office: { g3: [180, 110], g2: [160, 100], g1: [140, 90], hn: [130, 85], n: [120, 80] },
  home: { g3: [180, 110], g2: [160, 100], g1: [135, 85], hn: [130, 85], n: [120, 80] },
};

export function classify(sys, dia, table = 'office') {
  for (const [cat, [s, d]] of Object.entries(THRESHOLDS[table])) {
    if (sys >= s || dia >= d) return cat;
  }
  return 'o';
}

/**
 * Category colours per theme. Each one keeps at least 3:1 contrast against
 * the card background (WCAG 1.4.11): the bright set fails on a white card.
 */
export const PALETTE = {
  dark: { o: '#66BB6A', n: '#9CCC65', hn: '#FFCA28', g1: '#FFA726', g2: '#FF7043', g3: '#E53935' },
  light: { o: '#2E7D32', n: '#689F38', hn: '#B58900', g1: '#EF6C00', g2: '#D84315', g3: '#C62828' },
};
const DEFAULT_COLORS = PALETTE.dark;

const I18N = {
  en: {
    title: 'Blood pressure',
    week: 'Week',
    month: 'Month',
    year: 'Year',
    sysAvg: 'Systolic average',
    diaAvg: 'Diastolic average',
    highest: 'Highest values',
    lowest: 'Lowest values',
    sys: 'Systolic',
    dia: 'Diastolic',
    pulse: 'Pulse',
    none: 'No readings in this period',
    noneDay: 'no readings',
    noneOld: 'No readings — history may be purged. Check recorder purge_keep_days.',
    loading: 'Loading…',
    error: 'Could not load history',
    notFound: 'Entity not found',
    prev: 'Previous period',
    next: 'Next period',
    avg: 'average',
    chartHint: 'Chart. Use the arrow keys to go through the days or months.',
    rolling: { week: '7 days', month: '30 days', year: '365 days' },
    basis: { office: 'ESH office thresholds', home: 'ESH home thresholds' },
    meas: (n) => `${n} ${n === 1 ? 'reading' : 'readings'}`,
    cat: {
      o: 'Optimal',
      n: 'Normal',
      hn: 'High normal',
      g1: 'Hypertension grade 1',
      g2: 'Hypertension grade 2',
      g3: 'Hypertension grade 3',
    },
  },
  pl: {
    title: 'Ciśnienie krwi',
    week: 'Tydzień',
    month: 'Miesiąc',
    year: 'Rok',
    sysAvg: 'Średnie skurczowe',
    diaAvg: 'Średnie rozkurczowe',
    highest: 'Najwyższe wartości',
    lowest: 'Najniższe wartości',
    sys: 'Skurczowe',
    dia: 'Rozkurczowe',
    pulse: 'Tętno',
    none: 'Brak pomiarów w tym okresie',
    noneDay: 'brak pomiarów',
    noneOld: 'Brak pomiarów — historia mogła zostać wyczyszczona. Sprawdź recorder purge_keep_days.',
    loading: 'Ładowanie…',
    error: 'Nie udało się pobrać historii',
    notFound: 'Nie znaleziono encji',
    prev: 'Poprzedni okres',
    next: 'Następny okres',
    avg: 'średnia',
    chartHint: 'Wykres. Strzałkami przejdziesz przez kolejne dni lub miesiące.',
    rolling: { week: '7 dni', month: '30 dni', year: '365 dni' },
    basis: { office: 'progi gabinetowe ESH', home: 'progi domowe ESH' },
    meas: (n) => {
      if (n === 1) return '1 pomiar';
      const d = n % 10;
      const t = n % 100;
      return `${n} ${d >= 2 && d <= 4 && (t < 10 || t >= 20) ? 'pomiary' : 'pomiarów'}`;
    },
    cat: {
      o: 'Optymalne',
      n: 'Prawidłowe',
      hn: 'Wysokie prawidłowe',
      g1: 'Nadciśnienie 1°',
      g2: 'Nadciśnienie 2°',
      g3: 'Nadciśnienie 3°',
    },
  },
};

/* ------------------------------------------------------------------ */
/* Pure data logic (exported for tests)                                */
/* ------------------------------------------------------------------ */

/**
 * Turn a history/history_during_period response list for one entity into
 * { points, events }.
 *  - points: every numeric state, used to look up "the value in effect at t"
 *  - events: timestamps where the value actually changed. A state that only
 *    repeats the last numeric value (HA restart, unavailable -> available)
 *    is not a new reading.
 */
export function parseSeries(list, startMs = -Infinity, seed = null) {
  const points = [];
  const events = [];
  // `seed` is the last numeric value from before the window, when the window
  // starts on a non-numeric state; without it a recovery looks like a reading.
  let last = seed;
  (list || []).forEach((e) => {
    const t = e.lu !== undefined ? e.lu * 1000 : Date.parse(e.last_updated || e.last_changed);
    const raw = String(e.s !== undefined ? e.s : e.state).trim();
    const v = raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(t) || !Number.isFinite(v)) return;
    points.push({ t, v });
    if (last === null ? t > startMs + 1000 : v !== last) events.push(t);
    last = v;
  });
  return { points, events };
}

function valueAt(points, t) {
  let v = null;
  for (const p of points) {
    if (p.t <= t) v = p.v;
    else break;
  }
  return v;
}

// Outside these ranges a value is a sensor glitch, not a measurement.
const plausible = (sys, dia) => sys >= 50 && sys <= 300 && dia >= 20 && dia <= 200 && dia < sys;

/**
 * Pair systolic/diastolic changes into readings. Changes closer than
 * `windowMs` belong to the same reading; each reading takes the values in
 * effect at the end of its window, so a reading where only one of the two
 * numbers changed still gets both.
 */
export function buildReadings(sys, dia, pulse, startMs, endMs, windowMs) {
  const ev = [...sys.events, ...dia.events].sort((a, b) => a - b);
  const clusters = [];
  for (const t of ev) {
    if (!clusters.length || t - clusters[clusters.length - 1] > windowMs) clusters.push(t);
  }
  const out = [];
  clusters.forEach((t0, i) => {
    if (t0 < startMs || t0 >= endMs) return;
    const next = i + 1 < clusters.length ? clusters[i + 1] : Infinity;
    const te = Math.min(t0 + windowMs, next - 1);
    const s = valueAt(sys.points, te);
    const d = valueAt(dia.points, te);
    if (s === null || d === null || !plausible(s, d)) return;
    const p = pulse ? valueAt(pulse.points, te) : null;
    out.push({ t: t0, sys: s, dia: d, pulse: p });
  });
  return out;
}

export function aggregate(readings, buckets, table = 'office') {
  const rows = buckets.map((b) => ({ ...b, items: [] }));
  for (const r of readings) {
    const b = rows.find((x) => r.t >= x.s.getTime() && r.t < x.e.getTime());
    if (b) b.items.push(r);
  }
  for (const b of rows) {
    const it = b.items;
    b.n = it.length;
    if (!it.length) continue;
    b.sysMin = Math.min(...it.map((r) => r.sys));
    b.sysMax = Math.max(...it.map((r) => r.sys));
    b.diaMin = Math.min(...it.map((r) => r.dia));
    b.diaMax = Math.max(...it.map((r) => r.dia));
    b.sysAvg = it.reduce((a, r) => a + r.sys, 0) / it.length;
    b.diaAvg = it.reduce((a, r) => a + r.dia, 0) / it.length;
    // Classify what is displayed (rounded), so "140" never reads "High normal".
    b.cat = classify(Math.round(b.sysAvg), Math.round(b.diaAvg), table);
  }
  return rows;
}

export function summarize(readings, table = 'office') {
  if (!readings.length) return null;
  const by = (key, dir) =>
    readings.reduce((best, r) => (best === null || (dir > 0 ? r[key] > best[key] : r[key] < best[key]) ? r : best), null);
  const sysAvg = readings.reduce((a, r) => a + r.sys, 0) / readings.length;
  const diaAvg = readings.reduce((a, r) => a + r.dia, 0) / readings.length;
  return {
    n: readings.length,
    sysAvg,
    diaAvg,
    cat: classify(Math.round(sysAvg), Math.round(diaAvg), table),
    sysHigh: by('sys', 1),
    diaHigh: by('dia', 1),
    sysLow: by('sys', -1),
    diaLow: by('dia', -1),
  };
}

const VIEWS = ['week', 'month', 'year'];
const ENTITY_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;
// Only plain colour syntax, so a value can never break out of an attribute.
const CSS_COLOUR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)|var\(--[a-z0-9-]+\)|[a-z]+)$/i;

const DEFAULTS = {
  default_view: 'month',
  pair_window: 120,
  height: 280,
  show_stats: true,
  thresholds: 'office',
  range: 'rolling',
};
const RANGES = ['rolling', 'calendar'];

/**
 * Validate a card config and fill in defaults. Throws a readable error, which
 * Home Assistant shows as an error card, instead of rendering wrong readings.
 */
export function normalizeConfig(config) {
  const fail = (msg) => {
    throw new Error(`blood-pressure-card: ${msg}`);
  };
  if (!config || !config.systolic || !config.diastolic) fail('"systolic" and "diastolic" are required');
  const c = { ...DEFAULTS, ...config };
  const pw = Number(c.pair_window);
  if (typeof c.pair_window === 'boolean' || !Number.isFinite(pw) || pw <= 0 || pw > 3600) {
    fail(`"pair_window" must be a number of seconds between 1 and 3600, got ${JSON.stringify(c.pair_window)}`);
  }
  c.pair_window = pw;

  for (const key of ['systolic', 'diastolic', 'pulse']) {
    if (c[key] !== undefined && !ENTITY_ID.test(c[key])) fail(`"${key}" must be an entity id like sensor.name, got ${JSON.stringify(c[key])}`);
  }
  if (c.systolic === c.diastolic) fail('"systolic" and "diastolic" must be different entities');

  if (!RANGES.includes(c.range)) fail(`"range" must be one of ${RANGES.join(', ')}, got ${JSON.stringify(c.range)}`);
  if (!(c.thresholds in THRESHOLDS)) {
    fail(`"thresholds" must be one of ${Object.keys(THRESHOLDS).join(', ')}, got ${JSON.stringify(c.thresholds)}`);
  }
  if (!VIEWS.includes(c.default_view)) fail(`"default_view" must be one of ${VIEWS.join(', ')}, got ${JSON.stringify(c.default_view)}`);

  const h = Number(c.height);
  if (typeof c.height === 'boolean' || !Number.isFinite(h) || h < 120 || h > 2000) {
    fail(`"height" must be a number between 120 and 2000, got ${JSON.stringify(c.height)}`);
  }
  c.height = h;

  if (c.language !== undefined) {
    try {
      if (!Intl.DateTimeFormat.supportedLocalesOf(c.language).length) throw new RangeError();
    } catch {
      fail(`"language" must be a language code such as en or pl, got ${JSON.stringify(c.language)}`);
    }
  }

  if (c.colors !== undefined) {
    if (typeof c.colors !== 'object' || c.colors === null) fail('"colors" must be a map of category to colour');
    for (const [k, v] of Object.entries(c.colors)) {
      if (!(k in DEFAULT_COLORS)) fail(`"colors" keys must be ${Object.keys(DEFAULT_COLORS).join(', ')}, got ${JSON.stringify(k)}`);
      if (typeof v !== 'string' || !CSS_COLOUR.test(v.trim())) fail(`"colors.${k}" is not a CSS colour: ${JSON.stringify(v)}`);
    }
  }
  return c;
}

/**
 * Card picker suggestion for an entity: offered when a systolic or diastolic
 * sensor has its partner (same id with the other word), plus a pulse sensor
 * sharing the id prefix if there is one.
 */
export function suggestCard(hass, entityId) {
  const states = (hass && hass.states) || {};
  const m = /^(sensor\..*?)(systolic|diastolic)(.*)$/.exec(entityId || '');
  if (!m || !states[entityId]) return null;
  const other = `${m[1]}${m[2] === 'systolic' ? 'diastolic' : 'systolic'}${m[3]}`;
  if (!states[other]) return null;
  const config = {
    type: 'custom:blood-pressure-card',
    systolic: m[2] === 'systolic' ? entityId : other,
    diastolic: m[2] === 'diastolic' ? entityId : other,
  };
  const pulse = Object.keys(states).find((id) => id.startsWith(m[1]) && /pulse|heart_rate/.test(id.slice(m[1].length)));
  if (pulse) config.pulse = pulse;
  return { label: 'Blood Pressure Card', config };
}

/** Calendar date {y, m (0-based), d, dow (0 = Sunday)} of an instant in `tz`. */
function dateIn(ms, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, Number(x.value)]),
  );
  return { y: p.year, m: p.month - 1, d: p.day, dow: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() };
}

/** Offset of `tz` from UTC at instant `ms`, in ms. */
function tzOffset(ms, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, Number(x.value)]),
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** Midnight starting day (y, m, d) in `tz`; m and d may overflow like in Date.UTC. */
function midnight(y, m, d, tz) {
  const wall = Date.UTC(y, m, d);
  const guess = wall - tzOffset(wall, tz);
  return new Date(wall - tzOffset(guess, tz)); // second pass lands on the right side of a DST change
}

/**
 * Rolling windows ending today: the last 7 or 30 days (one bar per day), or
 * the last 365 days (one bar per month, the oldest and newest partial).
 * `offset` steps back by whole windows.
 */
function rollingRange(view, offset, today, fmt, day) {
  const buckets = [];
  const dm = fmt({ day: 'numeric', month: 'short' });
  if (view === 'year') {
    const start = day(today.y - 1 + offset, today.m, today.d + 1);
    const end = day(today.y + offset, today.m, today.d + 1);
    const mf = fmt({ month: 'narrow' });
    const full = fmt({ month: 'long', year: 'numeric' });
    const part = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
    const first = dateIn(start.getTime(), fmt({}).resolvedOptions().timeZone);
    for (let i = 0; ; i++) {
      const s = i === 0 ? start : day(first.y, first.m + i, 1);
      if (s >= end) break;
      const next = day(first.y, first.m + i + 1, 1);
      const e = next < end ? next : end;
      const whole = i > 0 && e.getTime() === next.getTime();
      const title = whole ? full.format(s) : part.formatRange(s, new Date(e.getTime() - 1));
      buckets.push({ s, e, label: mf.format(s), title });
    }
    return { start, end, buckets, label: `${fmt({ month: 'short', year: 'numeric' }).format(start)} – ${fmt({ month: 'short', year: 'numeric' }).format(new Date(end.getTime() - 1))}` };
  }
  const n = view === 'week' ? 7 : 30;
  const first = today.d - (n - 1) + n * offset;
  const start = day(today.y, today.m, first);
  const end = day(today.y, today.m, first + n);
  const wd = fmt({ weekday: 'narrow' });
  const dn = fmt({ day: 'numeric' });
  const tf = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
  for (let i = 0; i < n; i++) {
    const s = day(today.y, today.m, first + i);
    // Week: weekday letters. 30 days: a date every 7th bar, counted back from the newest.
    const label = n === 7 ? wd.format(s) : (n - 1 - i) % 7 === 0 ? dn.format(s) : '';
    buckets.push({ s, e: day(today.y, today.m, first + i + 1), label, title: tf.format(s) });
  }
  return { start, end, buckets, label: `${dm.format(start)} – ${dm.format(new Date(end.getTime() - 1))}` };
}

/**
 * Period boundaries + buckets for a view ('week' | 'month' | 'year'). Days are
 * calendar days in `tz` (default: the browser's zone), so DST days are 23 or 25 h.
 */
export function makeRange(view, offset, now, lang, tz, mode = 'calendar') {
  const zone = tz || new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fmt = (o) => new Intl.DateTimeFormat(lang, { ...o, timeZone: zone });
  const day = (y, m, d) => midnight(y, m, d, zone);
  const today = dateIn(now.getTime(), zone);
  if (mode === 'rolling') return rollingRange(view, offset, today, fmt, day);
  const buckets = [];
  let start;
  let end;
  let label;
  if (view === 'week') {
    const first = today.d - ((today.dow + 6) % 7) + 7 * offset; // Monday first
    start = day(today.y, today.m, first);
    end = day(today.y, today.m, first + 7);
    const wd = fmt({ weekday: 'narrow' });
    const tf = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
    for (let i = 0; i < 7; i++) {
      const s = day(today.y, today.m, first + i);
      buckets.push({ s, e: day(today.y, today.m, first + i + 1), label: wd.format(s), title: tf.format(s) });
    }
    const f = fmt({ day: 'numeric', month: 'short' });
    label = `${f.format(start)} – ${f.format(new Date(end.getTime() - 1))}`;
  } else if (view === 'year') {
    const yy = today.y + offset;
    start = day(yy, 0, 1);
    end = day(yy + 1, 0, 1);
    const mf = fmt({ month: 'narrow' });
    const tf = fmt({ month: 'long', year: 'numeric' });
    for (let i = 0; i < 12; i++) {
      const s = day(yy, i, 1);
      buckets.push({ s, e: day(yy, i + 1, 1), label: mf.format(s), title: tf.format(s) });
    }
    label = String(yy);
  } else {
    const base = new Date(Date.UTC(today.y, today.m + offset, 1));
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth();
    start = day(y, m, 1);
    end = day(y, m + 1, 1);
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const tf = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
    for (let d = 1; d <= days; d++) {
      const s = day(y, m, d);
      buckets.push({ s, e: day(y, m, d + 1), label: (d - 1) % 7 === 0 ? String(d) : '', title: tf.format(s) });
    }
    label = fmt({ month: 'long', year: 'numeric' }).format(start);
  }
  return { start, end, buckets, label };
}

/* ------------------------------------------------------------------ */
/* Card                                                               */
/* ------------------------------------------------------------------ */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export class BloodPressureCard extends BaseElement {
  constructor() {
    super();
    this._view = null;
    this._offset = 0;
    this._data = null;
    this._sel = null;
    this._req = 0;
  }

  static getConfigElement() {
    return document.createElement('blood-pressure-card-editor');
  }

  static getStubConfig(hass) {
    // Prefer a matched pair (same source), the same pairing the card picker suggests.
    for (const id of Object.keys((hass && hass.states) || {})) {
      const s = suggestCard(hass, id);
      if (s) {
        const { type, ...config } = s.config;
        return config;
      }
    }
    return {
      systolic: 'sensor.withings_systolic_blood_pressure',
      diastolic: 'sensor.withings_diastolic_blood_pressure',
    };
  }

  setConfig(config) {
    this._config = normalizeConfig(config);
    if (!this._view) this._view = this._config.default_view;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
      this.shadowRoot.addEventListener('keydown', (ev) => this._onKey(ev));
    }
    this._data = null;
    if (this._hass) this._load();
  }

  set hass(hass) {
    const first = !this._hass;
    const wasDark = this._dark();
    this._hass = hass;
    const c = this._config;
    if (!c) return;
    const key = [c.systolic, c.diastolic]
      .map((id) => (hass.states[id] ? hass.states[id].last_updated : ''))
      .join('|');
    if (first || key !== this._key) {
      this._key = key;
      this._load();
    } else if (this._dark() !== wasDark) {
      this._render(); // light or dark theme switched: swap the palette
    }
  }

  connectedCallback() {
    this._scheduleMidnight();
  }

  disconnectedCallback() {
    clearTimeout(this._midnight);
    this._midnight = null;
  }

  /**
   * An open dashboard (a wall tablet) gets no reload at midnight, so check the
   * period just after each midnight and reload when the current one changed.
   */
  _scheduleMidnight() {
    clearTimeout(this._midnight);
    const zone = this._tz() || new Intl.DateTimeFormat().resolvedOptions().timeZone;
    const today = dateIn(Date.now(), zone);
    const next = midnight(today.y, today.m, today.d + 1, zone).getTime() + 1000;
    this._midnight = setTimeout(() => {
      this._scheduleMidnight();
      if (!this._hass || !this._config || !this._range || this._offset !== 0) return;
      const now = makeRange(this._view, 0, new Date(), this._lang(), this._tz(), this._config.range);
      if (now.start.getTime() !== this._range.start.getTime()) this._load();
      else this._render(); // today moved: future days are dimmed differently
    }, next - Date.now());
  }

  getCardSize() {
    return this._config && this._config.show_stats ? 9 : 5;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: 'auto' };
  }

  _lang() {
    const h = this._hass || {};
    return (this._config && this._config.language) || (h.locale && h.locale.language) || h.language || 'en';
  }

  /** HA profile time zone: "server" uses HA's configured zone; the default "local" the browser's. */
  _tz() {
    const h = this._hass || {};
    if (h.locale && h.locale.time_zone === 'server' && h.config && h.config.time_zone) return h.config.time_zone;
    return undefined;
  }

  _t() {
    return this._lang().startsWith('pl') ? I18N.pl : I18N.en;
  }

  _dark() {
    return Boolean(this._hass && this._hass.themes && this._hass.themes.darkMode);
  }

  _colors() {
    const base = this._dark() ? PALETTE.dark : PALETTE.light;
    return { ...base, ...((this._config && this._config.colors) || {}) };
  }

  async _load() {
    if (!this._hass || !this._config) return;
    const id = ++this._req;
    const c = this._config;
    const ids = [c.systolic, c.diastolic];
    if (c.pulse) ids.push(c.pulse);
    try {
      const range = makeRange(this._view, this._offset, new Date(), this._lang(), this._tz(), c.range);
      this._range = range;
      // Pulse is optional: without it the chart still works, just without pulse.
      this._missing = [c.systolic, c.diastolic].filter((e) => !this._hass.states[e]);
      this._loading = true;
      this._err = null;
      this._render();
      if (this._missing.length) {
        this._data = null;
        this._loading = false;
        this._render();
        return;
      }
      // Fetch one pair_window beyond both edges, so a reading that straddles a
      // boundary is paired from complete data and stays in the period it started in.
      const pw = c.pair_window * 1000;
      const fetchStart = range.start.getTime() - pw;
      const res = await this._hass.callWS({
        type: 'history/history_during_period',
        start_time: new Date(fetchStart).toISOString(),
        end_time: new Date(range.end.getTime() + pw).toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
        include_start_time_state: true,
      });
      if (id !== this._req) return;
      const seeds = await this._seeds(res, [c.systolic, c.diastolic], fetchStart);
      if (id !== this._req) return;
      const sys = parseSeries(res[c.systolic], fetchStart, seeds[c.systolic]);
      const dia = parseSeries(res[c.diastolic], fetchStart, seeds[c.diastolic]);
      const pulse = c.pulse ? parseSeries(res[c.pulse], fetchStart) : null;
      const readings = buildReadings(sys, dia, pulse, range.start.getTime(), range.end.getTime(), pw);
      this._data = {
        buckets: aggregate(readings, range.buckets, c.thresholds),
        summary: summarize(readings, c.thresholds),
      };
      this._loading = false;
      this._render();
    } catch (e) {
      if (id !== this._req) return;
      console.error('blood-pressure-card:', e);
      this._data = null;
      this._loading = false;
      this._err = (e && (e.message || e.code)) || String(e);
      this._render();
    }
  }

  /**
   * For entities whose window starts on a non-numeric state (unavailable,
   * unknown), look back up to 30 days for the last real value, so the
   * sensor's recovery is not counted as a new reading. One extra request,
   * only in that case.
   */
  async _seeds(res, ids, fetchStart) {
    const numeric = (r) => r && Number.isFinite(Number(String(r.s !== undefined ? r.s : r.state).trim() || NaN));
    const need = ids.filter((e) => res[e] && res[e].length && !numeric(res[e][0]));
    if (!need.length) return {};
    const back = await this._hass.callWS({
      type: 'history/history_during_period',
      start_time: new Date(fetchStart - 30 * DAY).toISOString(),
      end_time: new Date(fetchStart).toISOString(),
      entity_ids: need,
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
      include_start_time_state: true,
    });
    const seeds = {};
    for (const e of need) {
      const pts = parseSeries(back[e]).points;
      if (pts.length) seeds[e] = pts[pts.length - 1].v;
    }
    return seeds;
  }

  _onClick(ev) {
    const el = ev.composedPath().find((n) => n && n.dataset && (n.dataset.view || n.dataset.nav || n.dataset.i !== undefined));
    if (!el) return;
    const d = el.dataset;
    if (d.view) {
      if (d.view === this._view) return;
      this._view = d.view;
      this._offset = 0;
      this._sel = null;
      this._data = null;
      this._load();
    } else if (d.nav) {
      const next = this._offset + Number(d.nav);
      if (next > 0) return;
      this._offset = next;
      this._sel = null;
      this._data = null;
      this._load();
    } else {
      const i = Number(d.i);
      this._sel = this._sel === i ? null : i;
      this._render();
    }
  }

  /** Arrow keys, Home and End move the selected day (or month); Escape closes it. */
  _onKey(ev) {
    const chart = this._els && this._els.chart;
    if (!chart || !this._range || !ev.composedPath().includes(chart)) return;
    // Days that have not happened yet are skipped: the last one is today.
    const now = Date.now();
    const last = Math.max(0, this._range.buckets.findLastIndex((b) => b.s.getTime() <= now));
    const cur = this._sel;
    let next;
    if (ev.key === 'Escape') next = null;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = last;
    else if (ev.key === 'ArrowLeft') next = cur === null ? last : Math.max(0, cur - 1);
    else if (ev.key === 'ArrowRight') next = cur === null ? last : Math.min(last, cur + 1);
    else return;
    ev.preventDefault();
    this._sel = next;
    this._render();
  }

  _chart() {
    const t = this._t();
    const col = this._colors();
    const W = 700;
    const H = Number(this._config.height) || 280;
    const top = 14;
    const bottom = H - 26;
    const left = 6;
    const right = W - 40;
    const buckets = this._data ? this._data.buckets : this._range.buckets.map((b) => ({ ...b, n: 0 }));
    const withData = buckets.filter((b) => b.n);

    let lo = 60;
    let hi = 180;
    if (withData.length) {
      lo = Math.min(lo, Math.floor((Math.min(...withData.map((b) => b.diaMin)) - 10) / 20) * 20);
      hi = Math.max(hi, Math.ceil((Math.max(...withData.map((b) => b.sysMax)) + 10) / 20) * 20);
    }
    const y = (v) => top + ((hi - v) / (hi - lo)) * (bottom - top);
    const slot = (right - left) / buckets.length;
    const cw = Math.max(4, Math.min(12, slot * 0.55));

    let svg = '';
    for (let v = lo; v <= hi; v += 20) {
      const yy = y(v).toFixed(1);
      const major = v % 40 === 0;
      svg += `<line x1="${left}" x2="${right}" y1="${yy}" y2="${yy}" class="grid${major ? ' major' : ''}"/>`;
      if (major) svg += `<text x="${W - 4}" y="${yy}" class="ylab" text-anchor="end" dominant-baseline="middle">${v}</text>`;
    }
    // Reference: the hypertension thresholds of the chosen table (140/90 or 135/85).
    for (const v of THRESHOLDS[this._config.thresholds].g1) {
      if (v > lo && v < hi) {
        const yy = y(v).toFixed(1);
        svg += `<line x1="${left}" x2="${right}" y1="${yy}" y2="${yy}" class="ref" stroke="${col.g1}"/>`;
      }
    }

    const now = Date.now();
    buckets.forEach((b, i) => {
      const cx = left + slot * (i + 0.5);
      if (this._sel === i) {
        svg += `<rect x="${(cx - slot / 2).toFixed(1)}" y="${top - 8}" width="${slot.toFixed(1)}" height="${bottom - top + 16}" rx="6" class="selbg"/>`;
      }
      if (b.label) {
        const fut = b.s.getTime() > now ? ' fut' : '';
        svg += `<text x="${cx.toFixed(1)}" y="${H - 6}" class="xlab${fut}" text-anchor="middle">${esc(b.label)}</text>`;
      }
      if (b.n) {
        const c = col[b.cat];
        const ySysT = y(b.sysMax);
        const ySysB = y(b.sysMin);
        const yDiaT = y(b.diaMax);
        const yDiaB = y(b.diaMin);
        svg += `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${ySysT.toFixed(1)}" y2="${yDiaB.toFixed(1)}" stroke="${c}" stroke-width="2"/>`;
        const cap = (y1, y2) =>
          `<rect x="${(cx - cw / 2).toFixed(1)}" y="${(y1 - cw / 2).toFixed(1)}" width="${cw.toFixed(1)}" height="${(Math.max(0, y2 - y1) + cw).toFixed(1)}" rx="${(cw / 2).toFixed(1)}" class="cap" stroke="${c}"/>`;
        svg += cap(ySysT, ySysB) + cap(yDiaT, yDiaB);
      }
      svg += `<rect data-i="${i}" x="${(cx - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}" fill="transparent" class="hit"/>`;
    });

    let overlay = '';
    if (this._missing && this._missing.length) overlay = `${t.notFound}: ${this._missing.join(', ')}`;
    else if (this._loading && !this._data) overlay = t.loading;
    else if (this._err) overlay = `${t.error}: ${esc(this._err)}`;
    else if (this._data && !withData.length) {
      overlay = this._range.start.getTime() < now - 10 * DAY ? t.noneOld : t.none;
    }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H}" role="img" aria-label="${esc(
      this._summary(),
    )}">${svg}</svg>${overlay ? `<div class="overlay">${esc(overlay)}</div>` : ''}`;
  }

  /** One sentence for screen readers: the period, its average and category. */
  _summary() {
    const t = this._t();
    const s = this._data && this._data.summary;
    if (!s) return this._range.label;
    return `${this._range.label}: ${t.avg} ${Math.round(s.sysAvg)}/${Math.round(s.diaAvg)} mmHg, ${t.cat[s.cat]}, ${t.meas(s.n)}`;
  }

  _selection() {
    if (this._sel === null || !this._data) return '';
    const t = this._t();
    const b = this._data.buckets[this._sel];
    if (!b) return '';
    if (!b.n) return `<div class="sel"><b>${esc(b.title)}</b> · ${esc(t.noneDay)}</div>`;
    const r = (a, z) => (a === z ? `${a}` : `${a}–${z}`);
    const dot = `<span class="dot" style="background:${this._colors()[b.cat]}"></span>`;
    return `<div class="sel"><div><b>${esc(b.title)}</b> · ${esc(t.meas(b.n))}</div>
      <div class="selrow">${dot}<span>${esc(t.sys)} <b>${r(b.sysMin, b.sysMax)}</b></span>
      <span>${esc(t.dia)} <b>${r(b.diaMin, b.diaMax)}</b></span>
      <span class="muted">⌀ ${Math.round(b.sysAvg)}/${Math.round(b.diaAvg)} · ${esc(t.cat[b.cat])}</span></div></div>`;
  }

  _stats() {
    if (!this._config.show_stats || !this._data || !this._data.summary) return '';
    const t = this._t();
    const s = this._data.summary;
    const col = this._colors();
    const df = new Intl.DateTimeFormat(this._lang(), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: this._tz(),
    });
    const row = (label, r) =>
      `<div class="row"><div><div>${esc(label)}</div><div class="muted small">${esc(df.format(new Date(r.t)))}${
        r.pulse !== null && r.pulse !== undefined ? ` · ${esc(t.pulse)} ${r.pulse}` : ''
      }</div></div><div class="val"><span class="dot" style="background:${col[classify(r.sys, r.dia, this._config.thresholds)]}"></span>${r.sys}/${r.dia} <span class="muted">mmHg</span></div></div>`;
    return `
      <div class="tiles">
        <div class="tile"><div class="k">${esc(t.sysAvg)}</div><div class="v">${Math.round(s.sysAvg)}<span class="u">mmHg</span></div></div>
        <div class="tile"><div class="k">${esc(t.diaAvg)}</div><div class="v">${Math.round(s.diaAvg)}<span class="u">mmHg</span></div></div>
      </div>
      <div class="catline"><span class="dot" style="background:${col[s.cat]}"></span>${esc(t.cat[s.cat])} · ${esc(t.meas(s.n))} · ${esc(t.basis[this._config.thresholds])}</div>
      <div class="sec">${esc(t.highest)}</div>
      <div class="list">${row(t.sys, s.sysHigh)}${row(t.dia, s.diaHigh)}</div>
      <div class="sec">${esc(t.lowest)}</div>
      <div class="list">${row(t.sys, s.sysLow)}${row(t.dia, s.diaLow)}</div>`;
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;
    const t = this._t();
    if (!this._range) {
      if (this._err) {
        this._els = null;
        this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div class="sel">${esc(t.error)}: ${esc(this._err)}</div></ha-card>`;
      }
      return;
    }
    // The frame is built once and then updated in place, so keyboard focus
    // and the live region survive every click and reload.
    if (!this._els) {
      this.shadowRoot.innerHTML = `
        <style>${STYLE}</style>
        <ha-card>
          <div class="hdr">
            <div class="title"></div>
            <div class="seg">${['week', 'month', 'year'].map((v) => `<button data-view="${v}"></button>`).join('')}</div>
          </div>
          <div class="nav">
            <button data-nav="-1">‹</button>
            <div class="period"></div>
            <button data-nav="1">›</button>
          </div>
          <div class="chart" tabindex="0" role="group"></div>
          <div class="live" aria-live="polite"></div>
          <div class="stats"></div>
        </ha-card>`;
      const q = (s) => this.shadowRoot.querySelector(s);
      this._els = {
        title: q('.title'),
        seg: [...this.shadowRoot.querySelectorAll('[data-view]')],
        prev: q('[data-nav="-1"]'),
        next: q('[data-nav="1"]'),
        period: q('.period'),
        chart: q('.chart'),
        live: q('.live'),
        stats: q('.stats'),
      };
    }
    const e = this._els;
    e.title.textContent = this._config.title !== undefined ? this._config.title : t.title;
    for (const b of e.seg) {
      const v = b.dataset.view;
      b.textContent = this._config.range === 'rolling' ? t.rolling[v] : t[v];
      b.className = v === this._view ? 'on' : '';
      b.setAttribute('aria-pressed', String(v === this._view));
    }
    e.prev.setAttribute('aria-label', t.prev);
    e.next.setAttribute('aria-label', t.next);
    const atEnd = this._offset >= 0;
    // Disabling the focused › would drop focus to the page; hand it to ‹.
    if (atEnd && this.shadowRoot.activeElement === e.next) e.prev.focus();
    e.next.disabled = atEnd;
    e.period.textContent = this._range.label;
    e.chart.setAttribute('aria-label', t.chartHint);
    e.chart.innerHTML = this._chart();
    e.live.innerHTML = this._selection();
    e.stats.innerHTML = this._stats();
  }
}

/* ------------------------------------------------------------------ */
/* Visual editor                                                      */
/* ------------------------------------------------------------------ */

const sensor = { entity: { domain: 'sensor' } };
const EDITOR_SCHEMA = [
  { name: 'systolic', required: true, selector: sensor },
  { name: 'diastolic', required: true, selector: sensor },
  { name: 'pulse', selector: sensor },
  { name: 'title', selector: { text: {} } },
  {
    name: 'range',
    selector: {
      select: {
        mode: 'list',
        options: [
          { value: 'rolling', label: 'Rolling: last 7, 30 or 365 days' },
          { value: 'calendar', label: 'Calendar: this week, month or year' },
        ],
      },
    },
  },
  {
    name: 'thresholds',
    selector: {
      select: {
        mode: 'list',
        options: [
          { value: 'office', label: 'Office (ESH, hypertension from 140/90)' },
          { value: 'home', label: 'Home (ESH, hypertension from 135/85)' },
        ],
      },
    },
  },
  {
    type: 'grid',
    name: '',
    schema: [
      {
        name: 'default_view',
        selector: { select: { mode: 'dropdown', options: VIEWS } },
      },
      {
        name: 'language',
        selector: { select: { mode: 'dropdown', options: [{ value: 'en', label: 'English' }, { value: 'pl', label: 'Polski' }] } },
      },
      { name: 'pair_window', selector: { number: { min: 1, max: 3600, mode: 'box', unit_of_measurement: 's' } } },
      { name: 'height', selector: { number: { min: 120, max: 2000, mode: 'box' } } },
    ],
  },
  { name: 'show_stats', selector: { boolean: {} } },
];

const EDITOR_LABELS = {
  en: {
    systolic: 'Systolic sensor',
    diastolic: 'Diastolic sensor',
    pulse: 'Pulse sensor (optional)',
    title: 'Title (leave empty to hide)',
    thresholds: 'Category thresholds',
    range: 'Periods',
    default_view: 'Default view',
    language: 'Language (default: HA language)',
    pair_window: 'Pairing window',
    height: 'Chart height',
    show_stats: 'Show averages and highest/lowest readings',
  },
  pl: {
    systolic: 'Czujnik skurczowego',
    diastolic: 'Czujnik rozkurczowego',
    pulse: 'Czujnik tętna (opcjonalny)',
    title: 'Tytuł (puste ukrywa tytuł)',
    thresholds: 'Progi kategorii',
    range: 'Okresy',
    default_view: 'Widok domyślny',
    language: 'Język (domyślnie język HA)',
    pair_window: 'Okno parowania',
    height: 'Wysokość wykresu',
    show_stats: 'Pokaż średnie oraz najwyższe i najniższe pomiary',
  },
};

export class BloodPressureCardEditor extends BaseElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _render() {
    if (!this._form) {
      this.attachShadow({ mode: 'open' });
      this._form = document.createElement('ha-form');
      this._form.schema = EDITOR_SCHEMA;
      this._form.computeLabel = (s) => {
        const lang = (this._hass && this._hass.locale && this._hass.locale.language) || 'en';
        return (lang.startsWith('pl') ? EDITOR_LABELS.pl : EDITOR_LABELS.en)[s.name] || s.name;
      };
      this._form.addEventListener('value-changed', (ev) => this._changed(ev));
      this.shadowRoot.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = { ...DEFAULTS, ...this._config };
  }

  _changed(ev) {
    ev.stopPropagation();
    const config = { ...this._config };
    for (const [k, v] of Object.entries(ev.detail.value)) {
      // An empty title is meaningful (it hides the title); other empty fields are unset.
      if (v === undefined || (v === '' && k !== 'title')) delete config[k];
      else config[k] = v;
    }
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }
}

const STYLE = `
  :host { display:block; }
  ha-card { display:block; padding:16px; }
  .hdr { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
  .title { font-size:1.15em; font-weight:500; }
  .seg { display:inline-flex; background:var(--secondary-background-color); border-radius:999px; padding:3px; }
  .seg button { border:0; background:transparent; color:var(--primary-text-color); padding:5px 14px; border-radius:999px; font:inherit; font-size:.9em; cursor:pointer; }
  .seg button.on { background:var(--primary-color); color:var(--text-primary-color, #fff); }
  button:focus-visible, .chart:focus-visible { outline:2px solid var(--primary-color); outline-offset:2px; }
  .chart:focus:not(:focus-visible) { outline:none; }
  .chart:focus-visible { border-radius:8px; }
  .nav { display:flex; align-items:center; justify-content:space-between; margin:10px 0 2px; }
  .nav button { border:0; background:transparent; color:var(--primary-text-color); font-size:1.6em; line-height:1; width:36px; height:32px; border-radius:8px; cursor:pointer; }
  .nav button:hover:not([disabled]) { background:var(--secondary-background-color); }
  .nav button[disabled] { opacity:.25; cursor:default; }
  .period { font-weight:500; }
  .period::first-letter { text-transform:uppercase; }
  .chart { position:relative; }
  svg { width:100%; height:auto; display:block; overflow:visible; }
  .grid { stroke:var(--divider-color, rgba(127,127,127,.2)); stroke-width:1; opacity:.5; }
  .grid.major { opacity:1; }
  .ref { stroke-width:1; stroke-dasharray:4 4; opacity:.45; }
  .ylab, .xlab { fill:var(--secondary-text-color); font-size:12px; }
  .xlab.fut { opacity:.4; }
  .cap { fill:var(--ha-card-background, var(--card-background-color, #1c1c1c)); stroke-width:2.5; }
  .selbg { fill:var(--primary-text-color); opacity:.06; }
  .hit { cursor:pointer; }
  .overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center; padding:0 24px; color:var(--secondary-text-color); pointer-events:none; }
  .sel { margin-top:8px; padding:10px 12px; border-radius:10px; background:var(--secondary-background-color); font-size:.92em; }
  .selrow { display:flex; flex-wrap:wrap; align-items:center; gap:4px 14px; margin-top:4px; }
  .dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:6px; vertical-align:middle; }
  .muted { color:var(--secondary-text-color); }
  .small { font-size:.82em; }
  .tiles { display:grid; grid-template-columns:1fr 1fr; gap:1px; background:var(--divider-color); border-radius:12px; overflow:hidden; margin-top:14px; }
  .tile { background:var(--secondary-background-color); padding:12px 14px; }
  .tile .k { color:var(--secondary-text-color); font-size:.85em; }
  .tile .v { font-size:2em; font-weight:600; line-height:1.25; }
  .tile .u { font-size:.45em; font-weight:400; color:var(--secondary-text-color); margin-left:4px; }
  .catline { margin-top:8px; font-size:.9em; color:var(--secondary-text-color); }
  .sec { margin-top:14px; font-weight:500; }
  .list { background:var(--secondary-background-color); border-radius:12px; margin-top:6px; }
  .row { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid var(--divider-color); }
  .row:last-child { border-bottom:0; }
  .val { font-weight:600; white-space:nowrap; }
`;

if (typeof customElements !== 'undefined' && !customElements.get('blood-pressure-card')) {
  customElements.define('blood-pressure-card', BloodPressureCard);
  customElements.define('blood-pressure-card-editor', BloodPressureCardEditor);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'blood-pressure-card',
    name: 'Blood Pressure Card',
    description: 'Withings-style systolic/diastolic range chart per day/month.',
    preview: true,
    documentationURL: 'https://github.com/uded/blood-pressure-card',
    getEntitySuggestion: suggestCard,
  });
  console.info(`%c BLOOD-PRESSURE-CARD %c ${VERSION} `, 'background:#E53935;color:#fff', 'background:#333;color:#fff');
}
