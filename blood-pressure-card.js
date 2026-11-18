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

export const VERSION = '0.1.0';

const DAY = 86400000;

// ESH 2023 office blood pressure categories.
export function classify(sys, dia) {
  if (sys >= 180 || dia >= 110) return 'g3';
  if (sys >= 160 || dia >= 100) return 'g2';
  if (sys >= 140 || dia >= 90) return 'g1';
  if (sys >= 130 || dia >= 85) return 'hn';
  if (sys >= 120 || dia >= 80) return 'n';
  return 'o';
}

const DEFAULT_COLORS = {
  o: '#66BB6A',
  n: '#9CCC65',
  hn: '#FFCA28',
  g1: '#FFA726',
  g2: '#FF7043',
  g3: '#E53935',
};

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
export function parseSeries(list, startMs = -Infinity) {
  const points = [];
  const events = [];
  let last = null;
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

export function aggregate(readings, buckets) {
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
    b.cat = classify(Math.round(b.sysAvg), Math.round(b.diaAvg));
  }
  return rows;
}

export function summarize(readings) {
  if (!readings.length) return null;
  const by = (key, dir) =>
    readings.reduce((best, r) => (best === null || (dir > 0 ? r[key] > best[key] : r[key] < best[key]) ? r : best), null);
  const sysAvg = readings.reduce((a, r) => a + r.sys, 0) / readings.length;
  const diaAvg = readings.reduce((a, r) => a + r.dia, 0) / readings.length;
  return {
    n: readings.length,
    sysAvg,
    diaAvg,
    cat: classify(Math.round(sysAvg), Math.round(diaAvg)),
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
};

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

/** Period boundaries + buckets for a view ('week' | 'month' | 'year'). */
export function makeRange(view, offset, now, lang) {
  const buckets = [];
  let start;
  let end;
  let label;
  const y = now.getFullYear();
  const m = now.getMonth();
  if (view === 'week') {
    const dow = (now.getDay() + 6) % 7; // Monday first
    start = new Date(y, m, now.getDate() - dow + 7 * offset);
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    const wd = new Intl.DateTimeFormat(lang, { weekday: 'narrow' });
    const tf = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' });
    for (let i = 0; i < 7; i++) {
      const s = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1);
      buckets.push({ s, e, label: wd.format(s), title: tf.format(s) });
    }
    const f = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' });
    label = `${f.format(start)} – ${f.format(new Date(end.getTime() - 1))}`;
  } else if (view === 'year') {
    const yy = y + offset;
    start = new Date(yy, 0, 1);
    end = new Date(yy + 1, 0, 1);
    const mf = new Intl.DateTimeFormat(lang, { month: 'narrow' });
    const tf = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' });
    for (let i = 0; i < 12; i++) {
      const s = new Date(yy, i, 1);
      buckets.push({ s, e: new Date(yy, i + 1, 1), label: mf.format(s), title: tf.format(s) });
    }
    label = String(yy);
  } else {
    start = new Date(y, m + offset, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const days = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    const tf = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' });
    for (let d = 1; d <= days; d++) {
      const s = new Date(start.getFullYear(), start.getMonth(), d);
      const e = new Date(start.getFullYear(), start.getMonth(), d + 1);
      buckets.push({ s, e, label: (d - 1) % 7 === 0 ? String(d) : '', title: tf.format(s) });
    }
    label = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(start);
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

  static getStubConfig(hass) {
    const ids = Object.keys((hass && hass.states) || {});
    return {
      systolic: ids.find((i) => /systolic/.test(i)) || 'sensor.withings_systolic_blood_pressure',
      diastolic: ids.find((i) => /diastolic/.test(i)) || 'sensor.withings_diastolic_blood_pressure',
    };
  }

  setConfig(config) {
    this._config = normalizeConfig(config);
    if (!this._view) this._view = this._config.default_view;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
    }
    this._data = null;
    if (this._hass) this._load();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    const c = this._config;
    if (!c) return;
    const key = [c.systolic, c.diastolic]
      .map((id) => (hass.states[id] ? hass.states[id].last_updated : ''))
      .join('|');
    if (first || key !== this._key) {
      this._key = key;
      this._load();
    }
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

  _t() {
    return this._lang().startsWith('pl') ? I18N.pl : I18N.en;
  }

  _colors() {
    return { ...DEFAULT_COLORS, ...((this._config && this._config.colors) || {}) };
  }

  async _load() {
    if (!this._hass || !this._config) return;
    const id = ++this._req;
    const c = this._config;
    const ids = [c.systolic, c.diastolic];
    if (c.pulse) ids.push(c.pulse);
    try {
      const range = makeRange(this._view, this._offset, new Date(), this._lang());
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
      const sys = parseSeries(res[c.systolic], fetchStart);
      const dia = parseSeries(res[c.diastolic], fetchStart);
      const pulse = c.pulse ? parseSeries(res[c.pulse], fetchStart) : null;
      const readings = buildReadings(sys, dia, pulse, range.start.getTime(), range.end.getTime(), pw);
      this._data = { buckets: aggregate(readings, range.buckets), summary: summarize(readings) };
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
    // Reference: hypertension thresholds 140 / 90.
    for (const v of [140, 90]) {
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
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H}">${svg}</svg>${
      overlay ? `<div class="overlay">${esc(overlay)}</div>` : ''
    }</div>`;
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
    const df = new Intl.DateTimeFormat(this._lang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const row = (label, r) =>
      `<div class="row"><div><div>${esc(label)}</div><div class="muted small">${esc(df.format(new Date(r.t)))}${
        r.pulse !== null && r.pulse !== undefined ? ` · ${esc(t.pulse)} ${r.pulse}` : ''
      }</div></div><div class="val"><span class="dot" style="background:${col[classify(r.sys, r.dia)]}"></span>${r.sys}/${r.dia} <span class="muted">mmHg</span></div></div>`;
    return `
      <div class="tiles">
        <div class="tile"><div class="k">${esc(t.sysAvg)}</div><div class="v">${Math.round(s.sysAvg)}<span class="u">mmHg</span></div></div>
        <div class="tile"><div class="k">${esc(t.diaAvg)}</div><div class="v">${Math.round(s.diaAvg)}<span class="u">mmHg</span></div></div>
      </div>
      <div class="catline"><span class="dot" style="background:${col[s.cat]}"></span>${esc(t.cat[s.cat])} · ${esc(t.meas(s.n))}</div>
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
        this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div class="sel">${esc(t.error)}: ${esc(this._err)}</div></ha-card>`;
      }
      return;
    }
    const title = this._config.title !== undefined ? this._config.title : t.title;
    const seg = ['week', 'month', 'year']
      .map((v) => `<button data-view="${v}" class="${v === this._view ? 'on' : ''}">${esc(t[v])}</button>`)
      .join('');
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="hdr">
          ${title ? `<div class="title">${esc(title)}</div>` : '<div></div>'}
          <div class="seg">${seg}</div>
        </div>
        <div class="nav">
          <button data-nav="-1" aria-label="previous">‹</button>
          <div class="period">${esc(this._range.label)}</div>
          <button data-nav="1" aria-label="next" ${this._offset >= 0 ? 'disabled' : ''}>›</button>
        </div>
        ${this._chart()}
        ${this._selection()}
        ${this._stats()}
      </ha-card>`;
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
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'blood-pressure-card',
    name: 'Blood Pressure Card',
    description: 'Withings-style systolic/diastolic range chart per day/month.',
    preview: false,
    documentationURL: 'https://github.com/uded/blood-pressure-card',
  });
  console.info(`%c BLOOD-PRESSURE-CARD %c ${VERSION} `, 'background:#E53935;color:#fff', 'background:#333;color:#fff');
}
