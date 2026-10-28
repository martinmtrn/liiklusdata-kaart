// Filtrite olek, filtreerimise loogika ja filtripaneeli kasutajaliides.

import type { Data } from './data';
import {
  DAYS_SHORT, DAYS, liikLabel, MONTHS, MONTHS_SHORT, participantMask, PARTICIPANTS, valgLabel, type ParticipantGroup,
} from './labels';

export type Severity = 'all' | 'fatal' | 'injury';

export interface FilterState {
  yearFrom: number;
  yearTo: number;
  months: Set<number>;
  dows: Set<number>;
  hourFrom: number;
  hourTo: number;
  severity: Severity;
  liik: Set<number>;
  /** valitud liiklejad ja osaleja tunnused (PARTICIPANTS võtmed) */
  liiklejad: Set<string>;
  tunnused: Set<string>;
  /** true = ainult õnnetused, kus osalesid kõik valitud (JA); false = vähemalt üks valitutest (VÕI) */
  liiklejadKoos: boolean;
  tunnusedKoos: boolean;
  valg: Set<number>;
  /** maakonna ja omavalitsuse sõnastikuindeks, -1 = kõik */
  mk: number;
  ov: number;
}

export function defaultState(data: Data): FilterState {
  return {
    yearFrom: data.years[0],
    yearTo: data.years[data.years.length - 1],
    months: new Set(),
    dows: new Set(),
    hourFrom: 0,
    hourTo: 23,
    severity: 'all',
    liik: new Set(),
    liiklejad: new Set(),
    tunnused: new Set(),
    liiklejadKoos: false,
    tunnusedKoos: false,
    valg: new Set(),
    mk: -1,
    ov: -1,
  };
}

// --- Filtrid lingi aadressis ---
// Sõnastikupõhised väärtused (liik, valgustus, maakond, omavalitsus) kirjutatakse nimega, mitte indeksiga,
// sest indeksid võivad andmete uuendamisel muutuda. Tühi väärtus ("teadmata") on '-'.

const SEV_PARAM: Record<Severity, string> = { all: '', fatal: 'hukkunuga', injury: 'vigastatuga' };
const EMPTY = '-';

const nums = (v: string | null) => (v ? v.split(',').map(Number).filter(Number.isInteger) : []);
const dictName = (v: string) => v || EMPTY;
const dictIndex = (dict: string[], name: string) => dict.indexOf(name === EMPTY ? '' : name);

/** Filtrite olek URL-i parameetriteks (vaikeväärtusi ei kirjutata) */
export function filtersToParams(data: Data, st: FilterState): URLSearchParams {
  const d = defaultState(data);
  const p = new URLSearchParams();
  if (st.yearFrom !== d.yearFrom || st.yearTo !== d.yearTo) p.set('aastad', st.yearFrom === st.yearTo ? String(st.yearFrom) : `${st.yearFrom}-${st.yearTo}`);
  if (st.months.size) p.set('kuu', [...st.months].sort((a, b) => a - b).map((m) => m + 1).join(','));
  if (st.dows.size) p.set('paev', [...st.dows].sort((a, b) => a - b).map((x) => x + 1).join(','));
  if (st.hourFrom !== 0 || st.hourTo !== 23) p.set('kell', `${st.hourFrom}-${st.hourTo}`);
  if (st.severity !== 'all') p.set('raskus', SEV_PARAM[st.severity]);
  for (const i of st.liik) p.append('liik', dictName(data.dict.liik[i]));
  if (st.liiklejad.size) p.set('liikleja', [...st.liiklejad].join(','));
  if (st.tunnused.size) p.set('tunnus', [...st.tunnused].join(','));
  if (st.liiklejadKoos && st.liiklejad.size > 1) p.set('liikleja-koos', '1');
  if (st.tunnusedKoos && st.tunnused.size > 1) p.set('tunnus-koos', '1');
  for (const i of st.valg) p.append('valgus', dictName(data.dict.valg[i]));
  if (st.mk >= 0) p.set('maakond', dictName(data.dict.mk[st.mk]));
  if (st.ov >= 0) p.set('omavalitsus', dictName(data.dict.ov[st.ov]));
  return p;
}

/** URL-i parameetritest filtrite olek; tundmatud või vigased väärtused jäetakse vahele */
export function filtersFromParams(data: Data, p: URLSearchParams): FilterState {
  const st = defaultState(data);
  const first = data.years[0];
  const last = data.years[data.years.length - 1];
  const clampYear = (y: number) => Math.min(last, Math.max(first, y));
  const years = nums(p.get('aastad')?.replace('-', ',') ?? null);
  if (years.length) {
    st.yearFrom = clampYear(years[0]);
    st.yearTo = clampYear(years[1] ?? years[0]);
    if (st.yearFrom > st.yearTo) [st.yearFrom, st.yearTo] = [st.yearTo, st.yearFrom];
  }
  for (const m of nums(p.get('kuu'))) if (m >= 1 && m <= 12) st.months.add(m - 1);
  for (const x of nums(p.get('paev'))) if (x >= 1 && x <= 7) st.dows.add(x - 1);
  const hours = nums(p.get('kell')?.replace('-', ',') ?? null);
  if (hours.length === 2 && hours.every((h) => h >= 0 && h <= 23)) [st.hourFrom, st.hourTo] = hours;
  const sev = (Object.keys(SEV_PARAM) as Severity[]).find((k) => SEV_PARAM[k] && SEV_PARAM[k] === p.get('raskus'));
  if (sev) st.severity = sev;
  const addDict = (key: string, dict: string[], set: Set<number>) => {
    for (const name of p.getAll(key)) {
      const i = dictIndex(dict, name);
      if (i >= 0) set.add(i);
    }
  };
  addDict('liik', data.dict.liik, st.liik);
  addDict('valgus', data.dict.valg, st.valg);
  const groupOf = new Map(PARTICIPANTS.map((x) => [x.key, x.group]));
  const addOsa = (k: string, only?: ParticipantGroup) => {
    const g = groupOf.get(k);
    if (g && (!only || g === only)) (g === 'liikleja' ? st.liiklejad : st.tunnused).add(k);
  };
  for (const k of p.get('liikleja')?.split(',') ?? []) addOsa(k, 'liikleja');
  for (const k of p.get('tunnus')?.split(',') ?? []) addOsa(k, 'tunnus');
  st.liiklejadKoos = p.get('liikleja-koos') === '1';
  st.tunnusedKoos = p.get('tunnus-koos') === '1';
  // Vanad lingid: üks segaparameeter, kus mootorrattur ja mopeed olid eraldi
  for (const k of p.get('osalised')?.split(',') ?? []) addOsa(k === 'mootorrattur' || k === 'mopeed' ? 'mootorratas' : k);
  const mk = p.get('maakond');
  if (mk !== null) st.mk = dictIndex(data.dict.mk, mk);
  const ov = p.get('omavalitsus');
  if (ov !== null) st.ov = dictIndex(data.dict.ov, ov);
  // Omavalitsus peab kuuluma valitud maakonda
  if (st.ov >= 0 && st.mk >= 0 && !ovByMk(data).get(st.mk)?.has(st.ov)) st.ov = -1;
  return st;
}

/** Kas õnnetus jääb valitud haldusüksuse filtrist välja, sest tal puudub andmetes maakond või omavalitsus */
export function placeMissing(data: Data, st: FilterState): ((i: number) => boolean) | null {
  if (st.mk < 0 && st.ov < 0) return null;
  const emptyMk = data.dict.mk.indexOf('');
  const emptyOv = data.dict.ov.indexOf('');
  return (i) => (st.mk >= 0 && data.cat.mk[i] === emptyMk) || (st.ov >= 0 && data.cat.ov[i] === emptyOv);
}

const ovByMkCache = new WeakMap<Data, Map<number, Set<number>>>();
/** Millised omavalitsused igas maakonnas andmetes esinevad */
function ovByMk(data: Data): Map<number, Set<number>> {
  let m = ovByMkCache.get(data);
  if (!m) {
    m = new Map();
    for (let i = 0; i < data.n; i++) {
      const k = data.cat.mk[i];
      if (!m.has(k)) m.set(k, new Set());
      m.get(k)!.add(data.cat.ov[i]);
    }
    ovByMkCache.set(data, m);
  }
  return m;
}

/** Hoiab filtrid lehe aadressis (ilma uut ajalookirjet tegemata) ja tagastab päringuosa teiste lehtede linkide jaoks */
/** Kirjutab filtrid (ja extra parameetrid, nt teekonna) lehe aadressi. Tagastab ainult filtrite osa, et seda saaks teistele lehtedele kaasa anda. */
export function syncFiltersToUrl(data: Data, st: FilterState, extra?: Record<string, string> | null): string {
  const params = filtersToParams(data, st);
  const search = (p: URLSearchParams) => {
    const qs = p.toString().replace(/%2C/g, ',').replace(/%3B/g, ';');
    return qs ? `?${qs}` : '';
  };
  const filtersOnly = search(params);
  for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
  const full = search(params);
  if (full !== location.search) history.replaceState(history.state, '', `${location.pathname}${full}${location.hash}`);
  return filtersOnly;
}

/** Tagastab filtritele vastavate õnnetuste indeksid */
export function applyFilters(data: Data, st: FilterState): Uint32Array {
  const out = new Uint32Array(data.n);
  let k = 0;
  const hourFiltered = st.hourFrom > 0 || st.hourTo < 23;
  // Iga valiku mask eraldi; VÕI korral piisab ühest, JA korral peavad kõik klappima
  const masks = (keys: Set<string>) => PARTICIPANTS.filter((p) => keys.has(p.key)).map((p) => participantMask(data.flagNames, p));
  const osaTest = (list: number[], koos: boolean): ((f: number) => boolean) | null => {
    if (!list.length) return null;
    if (koos) return (f) => list.every((m) => (f & m) !== 0);
    const any = list.reduce((a, m) => a | m, 0);
    return (f) => (f & any) !== 0;
  };
  const liiklejaTest = osaTest(masks(st.liiklejad), st.liiklejadKoos);
  const tunnusTest = osaTest(masks(st.tunnused), st.tunnusedKoos);

  for (let i = 0; i < data.n; i++) {
    const y = data.year[i];
    if (y < st.yearFrom || y > st.yearTo) continue;
    if (st.months.size && !st.months.has(data.month[i])) continue;
    if (st.dows.size && !st.dows.has(data.dow[i])) continue;
    if (hourFiltered) {
      const h = data.hour[i];
      if (h < 0) continue;
      if (st.hourFrom <= st.hourTo ? h < st.hourFrom || h > st.hourTo : h < st.hourFrom && h > st.hourTo) continue;
    }
    if (st.severity === 'fatal' && data.dead[i] === 0) continue;
    if (st.severity === 'injury' && data.dead[i] > 0) continue;
    if (st.liik.size && !st.liik.has(data.cat.liik[i])) continue;
    if (liiklejaTest && !liiklejaTest(data.flags[i])) continue;
    if (tunnusTest && !tunnusTest(data.flags[i])) continue;
    if (st.valg.size && !st.valg.has(data.cat.valg[i])) continue;
    if (st.mk >= 0 && data.cat.mk[i] !== st.mk) continue;
    if (st.ov >= 0 && data.cat.ov[i] !== st.ov) continue;
    out[k++] = i;
  }
  return out.subarray(0, k);
}

type Option<T> = { value: T; label: string; title?: string };

/** Mitme valiku kombineerimise lüliti: vähemalt üks valitutest või kõik koos */
interface GroupMode {
  id: string;
  get: () => boolean;
  set: (koos: boolean) => void;
  /** õnnetuste arv [vähemalt üks, kõik koos] praeguste filtritega */
  counts: () => [number, number];
}

/** Nupurühm, kus saab valida mitu väärtust (tühi valik = kõik). cols: võrdse laiusega veergude arv. */
function chipGroup<T>(legend: string, options: Option<T>[], selected: Set<T>, onChange: () => void, cols: number, hint?: string, mode?: GroupMode) {
  const fs = document.createElement('fieldset');
  fs.className = 'field';
  fs.innerHTML = `<legend>${legend}</legend>${hint ? `<p class="hint">${hint}</p>` : ''}`;
  const wrap = document.createElement('div');
  wrap.className = 'chips chips-grid';
  wrap.style.setProperty('--cols', String(cols));
  const buttons: HTMLButtonElement[] = [];
  for (const opt of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = opt.label;
    b.dataset.label = opt.label;
    if (opt.title) b.title = opt.title;
    b.addEventListener('click', () => {
      if (selected.has(opt.value)) selected.delete(opt.value);
      else selected.add(opt.value);
      sync();
      onChange();
    });
    buttons.push(b);
    wrap.append(b);
  }
  fs.append(wrap);

  // Lüliti on alati nähtaval, et paigutus valimisel ei hüppaks; alla kahe valiku korral on see mitteaktiivne
  let refreshMode = () => {};
  if (mode) {
    const mw = document.createElement('div');
    mw.className = 'chips chips-grid mode-toggle';
    mw.style.setProperty('--cols', '2');
    mw.setAttribute('role', 'radiogroup');
    mw.setAttribute('aria-label', `${legend}: mitme valiku korral`);
    const labels = ['Vähemalt üks', 'Kõik koos'];
    const spans = labels.map((text, k) => {
      const lab = document.createElement('label');
      lab.className = 'radio-chip';
      lab.innerHTML = `<input type="radio" name="${mode.id}" value="${k}"><span></span>`;
      const input = lab.querySelector('input')!;
      input.checked = mode.get() === (k === 1);
      input.addEventListener('change', () => {
        mode.set(k === 1);
        onChange();
      });
      mw.append(lab);
      return { input, span: lab.querySelector('span')!, text };
    });
    const note = document.createElement('p');
    note.className = 'hint mode-hint';
    note.textContent = 'Kõik koos: ainult õnnetused, kus osalesid kõik valitud.';
    fs.append(mw, note);
    refreshMode = () => {
      const multi = selected.size > 1;
      const counts = multi ? mode.counts() : null;
      for (const [k, o] of spans.entries()) {
        o.input.disabled = !multi;
        o.input.checked = mode.get() === (k === 1);
        const label = counts ? `${o.text} · ${counts[k].toLocaleString('et-EE')}` : o.text;
        o.span.textContent = label;
        o.span.dataset.label = label;
      }
    };
  }

  const sync = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(selected.has(options[i].value))));
  sync();
  refreshMode();
  return { el: fs, refresh: refreshMode };
}

function select(id: string, label: string, options: Option<number>[], value: number, onChange: (v: number) => void) {
  const wrap = document.createElement('div');
  wrap.className = 'select-field';
  wrap.innerHTML = `<label for="${id}">${label}</label>`;
  const s = document.createElement('select');
  s.id = id;
  for (const o of options) s.add(new Option(o.label, String(o.value)));
  s.value = String(value);
  s.addEventListener('change', () => onChange(Number(s.value)));
  wrap.append(s);
  return { el: wrap, select: s };
}

export interface FilterPanel {
  state: FilterState;
  reset: () => void;
}

export function buildFilterPanel(root: HTMLElement, data: Data, notify: () => void, initial?: FilterState): FilterPanel {
  let st = initial ?? defaultState(data);
  // Lülitite arvud sõltuvad kõigist filtritest, seega uuendatakse neid iga muudatuse peale
  let refreshers: (() => void)[] = [];
  const onChange = () => {
    for (const r of refreshers) r();
    notify();
  };

  const render = () => {
    root.innerHTML = '';

    // Aeg
    const time = document.createElement('fieldset');
    time.className = 'field';
    time.innerHTML = '<legend>Aeg</legend>';
    const row = document.createElement('div');
    row.className = 'row';
    const yearOpts = data.years.map((y) => ({ value: y, label: String(y) }));
    const from = select('f-year-from', 'Alates aastast', yearOpts, st.yearFrom, (v) => {
      st.yearFrom = v;
      if (st.yearTo < v) (st.yearTo = v), (to.select.value = String(v));
      onChange();
    });
    const to = select('f-year-to', 'Kuni aastani', yearOpts, st.yearTo, (v) => {
      st.yearTo = v;
      if (st.yearFrom > v) (st.yearFrom = v), (from.select.value = String(v));
      onChange();
    });
    row.append(from.el, to.el);
    time.append(row);

    const hourOpts = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` }));
    const hourToOpts = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:59` }));
    const hrow = document.createElement('div');
    hrow.className = 'row';
    hrow.append(
      select('f-hour-from', 'Kellaaeg alates', hourOpts, st.hourFrom, (v) => ((st.hourFrom = v), onChange())).el,
      select('f-hour-to', 'Kellaaeg kuni', hourToOpts, st.hourTo, (v) => ((st.hourTo = v), onChange())).el,
    );
    time.append(hrow);
    const hourHint = document.createElement('p');
    hourHint.className = 'hint';
    hourHint.textContent = 'Kellaaja valimisel jäävad välja õnnetused, mille kellaaeg on teadmata.';
    time.append(hourHint);
    root.append(time);

    // Haldusüksus
    const place = document.createElement('fieldset');
    place.className = 'field';
    place.innerHTML = '<legend>Haldusüksus</legend>';
    const byName = (a: Option<number>, b: Option<number>) => a.label.localeCompare(b.label, 'et');
    const dictOpts = (dict: string[], only?: Set<number>) =>
      dict.map((v, i) => ({ value: i, label: v || 'Teadmata' })).filter((o) => !only || only.has(o.value)).sort(byName);
    const ovOpts = () => [{ value: -1, label: 'Kõik omavalitsused' }, ...dictOpts(data.dict.ov, st.mk >= 0 ? ovByMk(data).get(st.mk) : undefined)];
    const prow = document.createElement('div');
    prow.className = 'row';
    const mkSel = select('f-mk', 'Maakond', [{ value: -1, label: 'Kõik maakonnad' }, ...dictOpts(data.dict.mk)], st.mk, (v) => {
      st.mk = v;
      const opts = ovOpts();
      if (!opts.some((o) => o.value === st.ov)) st.ov = -1;
      ovSel.select.replaceChildren(...opts.map((o) => new Option(o.label, String(o.value))));
      ovSel.select.value = String(st.ov);
      onChange();
    });
    const ovSel = select('f-ov', 'Omavalitsus', ovOpts(), st.ov, (v) => {
      st.ov = v;
      onChange();
    });
    prow.append(mkSel.el, ovSel.el);
    place.append(prow);
    root.append(place);

    const months = chipGroup('Kuu', MONTHS_SHORT.map((m, i) => ({ value: i, label: m, title: MONTHS[i] })), st.months, onChange, 4);
    const dows = chipGroup('Nädalapäev', DAYS_SHORT.map((d, i) => ({ value: i, label: d, title: DAYS[i] })), st.dows, onChange, 7);
    root.append(months.el, dows.el);

    // Raskusaste
    const sev = document.createElement('fieldset');
    sev.className = 'field';
    sev.innerHTML = '<legend>Raskusaste</legend>';
    const sevWrap = document.createElement('div');
    sevWrap.className = 'chips chips-grid';
    sevWrap.style.setProperty('--cols', '3');
    const sevOpts: Option<Severity>[] = [
      { value: 'all', label: 'Kõik' },
      { value: 'fatal', label: 'Hukkunuga' },
      { value: 'injury', label: 'Ainult vigastatutega' },
    ];
    for (const o of sevOpts) {
      const id = `f-sev-${o.value}`;
      const lab = document.createElement('label');
      lab.className = 'radio-chip';
      lab.innerHTML = `<input type="radio" name="sev" id="${id}" value="${o.value}" ${st.severity === o.value ? 'checked' : ''}><span data-label="${o.label}">${o.label}</span>`;
      lab.querySelector('input')!.addEventListener('change', () => ((st.severity = o.value), onChange()));
      sevWrap.append(lab);
    }
    sev.append(sevWrap);
    root.append(sev);

    // Õnnetuse liik ja osalised
    const liikOpts = data.dict.liik.map((v, i) => ({ value: i, label: liikLabel(v) })).sort((a, b) => (a.value === 0 ? 1 : b.value === 0 ? -1 : 0));
    const liik = chipGroup('Õnnetuse liik', liikOpts, st.liik, onChange, 2);
    const osaOpts = (g: ParticipantGroup) => PARTICIPANTS.filter((p) => p.group === g).map((p) => ({ value: p.key, label: p.label, title: p.title }));
    const countBoth = (key: 'liiklejadKoos' | 'tunnusedKoos'): [number, number] => [
      applyFilters(data, { ...st, [key]: false }).length,
      applyFilters(data, { ...st, [key]: true }).length,
    ];
    const liiklejad = chipGroup(
      'Liikleja',
      osaOpts('liikleja'),
      st.liiklejad,
      onChange,
      2,
      undefined,
      { id: 'f-liikleja-koos', get: () => st.liiklejadKoos, set: (v) => (st.liiklejadKoos = v), counts: () => countBoth('liiklejadKoos') },
    );
    const tunnused = chipGroup(
      'Osaleja tunnused',
      osaOpts('tunnus'),
      st.tunnused,
      onChange,
      2,
      'Andmetest ei selgu, kas tunnus käib sama isiku kohta, kes on valitud liikleja all.',
      { id: 'f-tunnus-koos', get: () => st.tunnusedKoos, set: (v) => (st.tunnusedKoos = v), counts: () => countBoth('tunnusedKoos') },
    );
    refreshers = [liiklejad.refresh, tunnused.refresh];
    root.append(liik.el, liiklejad.el, tunnused.el);

    // Olud
    const valgOpts = data.dict.valg.map((v, i) => ({ value: i, label: valgLabel(v) })).sort((a, b) => (a.value === 0 ? 1 : b.value === 0 ? -1 : 0));
    const valg = chipGroup('Valgustus', valgOpts, st.valg, onChange, 3);
    root.append(valg.el);



  };

  render();
  return {
    get state() {
      return st;
    },
    reset: () => {
      st = defaultState(data);
      render();
      onChange();
    },
  };
}

/** Lühike tekstiline kokkuvõte aktiivsetest filtritest */
export function activeFilterCount(data: Data, st: FilterState): number {
  const d = defaultState(data);
  let n = 0;
  if (st.yearFrom !== d.yearFrom || st.yearTo !== d.yearTo) n++;
  if (st.hourFrom !== 0 || st.hourTo !== 23) n++;
  if (st.severity !== 'all') n++;
  if (st.mk >= 0) n++;
  if (st.ov >= 0) n++;
  for (const s of [st.months, st.dows, st.liik, st.liiklejad, st.tunnused, st.valg]) if (s.size) n++;
  return n;
}
