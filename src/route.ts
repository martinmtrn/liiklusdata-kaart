// "Minu teekond": algus ja sihtkoht, teekond OpenStreetMapi marsruutijast ja õnnetused teekonna ääres.

import { addressCombo, labelFromUrl, labelToUrl, pointFromUrl, pointToUrl, type Place } from './address';
import { hasCoords, type Data } from './data';
import { escapeHtml, fmt, formatDate, liikDetailLabel, liikLabel, participantMask, PARTICIPANTS, plural } from './labels';
import type { AccidentMap, Waypoint } from './map';
import { barList, installHeatTip, missingLocationNote } from './stats';

// FOSSGIS-e avalik OSRM-teenus: tasuta, võtit pole vaja, brauserist lubatud (CORS)
const ROUTER = 'https://routing.openstreetmap.de';
const MODES = [
  { key: 'auto', label: 'Auto', path: 'routed-car' },
  { key: 'ratas', label: 'Jalgratas', path: 'routed-bike' },
  { key: 'jalgsi', label: 'Jalgsi', path: 'routed-foot' },
] as const;
type Mode = (typeof MODES)[number];
// Arvesse lähevad õnnetused, mis on teekonna joonest kuni nii mitme meetri kaugusel
const WIDTH = 35;
// Profiili lõigu pikkus valitakse nii, et tulpi oleks kuni 50
const BIN_STEPS_KM = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20];
const MAX_BINS = 50;
// Avalik marsruutija lubab rohkem, aga paneelis on üle kümne punkti raske hallata
const MAX_VIA = 10;

export interface RoutePanel {
  update: (indices: Uint32Array, yearFrom: number, yearTo: number) => void;
  /** Teekonna õnnetused, mida kaart peaks näitama, või null, kui kaart näitab kõiki filtritele vastavaid */
  mapIndices: () => Uint32Array | null;
  onShow: () => void;
  onHide: () => void;
  /** Teekond lingi aadressi jaoks; null, kui algus või sihtkoht puudub */
  urlParams: () => Record<string, string> | null;
  /** Loeb teekonna lingi aadressist; tagastab true, kui seal oli teekond */
  loadFromUrl: (params: URLSearchParams) => boolean;
}


interface Route {
  line: [number, number][];
  /** Kaugus algusest iga punktini meetrites */
  cum: Float64Array;
  lengthM: number;
  durationS: number;
}

interface Hit {
  i: number;
  /** Kaugus teekonna algusest meetrites */
  along: number;
}

/** Leiab õnnetused, mis on teekonnast kuni width meetri kaugusel. Lõigud pannakse ruudustikku, et iga punkt võrdleks ainult lähedasi lõike. */
function matchRoute(data: Data, indices: Uint32Array, route: Route, width: number): Hit[] {
  const { line, cum } = route;
  const lat0 = line.reduce((s, p) => s + p[1], 0) / line.length;
  const ky = 111320;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const xs = line.map((p) => p[0] * kx);
  const ys = line.map((p) => p[1] * ky);
  const cell = Math.max(250, width * 2);
  const key = (cx: number, cy: number) => cx * 1e6 + cy;
  const grid = new Map<number, number[]>();
  for (let s = 0; s < line.length - 1; s++) {
    const x0 = Math.floor((Math.min(xs[s], xs[s + 1]) - width) / cell);
    const x1 = Math.floor((Math.max(xs[s], xs[s + 1]) + width) / cell);
    const y0 = Math.floor((Math.min(ys[s], ys[s + 1]) - width) / cell);
    const y1 = Math.floor((Math.max(ys[s], ys[s + 1]) + width) / cell);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy);
        const arr = grid.get(k);
        if (arr) arr.push(s);
        else grid.set(k, [s]);
      }
  }

  const hits: Hit[] = [];
  for (const i of indices) {
    if (!hasCoords(data, i)) continue;
    const px = data.lon[i] * kx;
    const py = data.lat[i] * ky;
    const segs = grid.get(key(Math.floor(px / cell), Math.floor(py / cell)));
    if (!segs) continue;
    let best = Infinity;
    let along = 0;
    for (const s of segs) {
      const dx = xs[s + 1] - xs[s];
      const dy = ys[s + 1] - ys[s];
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((px - xs[s]) * dx + (py - ys[s]) * dy) / len2)) : 0;
      const d = Math.hypot(px - (xs[s] + t * dx), py - (ys[s] + t * dy));
      if (d < best) (best = d), (along = cum[s] + t * (cum[s + 1] - cum[s]));
    }
    if (best <= width) hits.push({ i, along });
  }
  return hits;
}

function kmText(m: number) {
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : fmt(Math.round(km))} km`;
}

function durationText(s: number) {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Punkti lähim koht teekonnal: kaugus algusest meetrites */
function alongRoute(route: Route, [lon, lat]: [number, number]) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 111320;
  let best = Infinity;
  let along = 0;
  const { line, cum } = route;
  for (let s = 0; s < line.length - 1; s++) {
    const x0 = (line[s][0] - lon) * kx;
    const y0 = (line[s][1] - lat) * ky;
    const dx = (line[s + 1][0] - line[s][0]) * kx;
    const dy = (line[s + 1][1] - line[s][1]) * ky;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(x0 * dx + y0 * dy) / len2)) : 0;
    const d = Math.hypot(x0 + t * dx, y0 + t * dy);
    if (d < best) (best = d), (along = cum[s] + t * (cum[s + 1] - cum[s]));
  }
  return along;
}

/** Sagedaseim väärtus loendis (tühjad jäetakse välja) */
function mostCommon(values: string[]) {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

/** onChange kutsutakse, kui teekond või selle nähtavus muutub (kaart ja lingi aadress uuenevad) */
export function buildRoutePanel(root: HTMLElement, data: Data, amap: AccidentMap, onChange: () => void): RoutePanel {
  let from: Place | null = null;
  let to: Place | null = null;
  /** Vahepunktid sõidu järjekorras */
  let via: [number, number][] = [];
  let mode: Mode = MODES[0];
  let route: Route | null = null;
  let hits: Hit[] = [];
  let filtered: Uint32Array = new Uint32Array();
  let yearFrom = data.years[0];
  let yearTo = data.years[data.years.length - 1];
  let visible = false;
  let picking: 'from' | 'to' | 'via' | null = null;
  let routeSeq = 0;

  const field = (id: string, label: string, placeholder: string) => `
    <div class="field combo">
      <label for="r-${id}">${label}</label>
      <div class="combo-row">
        <input id="r-${id}" type="search" autocomplete="off" placeholder="${placeholder}"
          role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="r-${id}-list">
        <button type="button" class="btn" id="r-pick-${id}" aria-pressed="false">Kaardilt</button>
      </div>
      <ul id="r-${id}-list" class="combo-list" role="listbox" aria-label="Aadressid" hidden></ul>
    </div>`;

  root.innerHTML = `
    <p class="lead">Vaata, kui palju õnnetusi on juhtunud sinu igapäevasel teel, näiteks kodust kooli või tööle.</p>
    ${field('from', 'Algus', 'nt Telliskivi 60a, Tallinn')}
    ${field('to', 'Sihtkoht', 'nt Narva mnt 25, Tallinn')}
    <div class="row row-buttons">
      <button type="button" class="btn" id="r-geo">Minu asukoht algusesse</button>
      <button type="button" class="btn" id="r-swap">Vaheta suunda</button>
    </div>
    <div class="field" id="r-via-box" hidden>
      <span class="field-title">Vahepunktid</span>
      <p class="hint">Klõpsa teekonna joonel, et lisada vahepunkt, ja lohista seda kaardil. Punkte A ja B saab samuti lohistada.</p>
      <ol class="via-list" id="r-via-list"></ol>
      <div class="row">
        <button type="button" class="btn" id="r-pick-via" aria-pressed="false">Lisa vahepunkt kaardilt</button>
        <button type="button" class="btn" id="r-via-clear" hidden>Eemalda vahepunktid</button>
      </div>
    </div>
    <fieldset class="field">
      <legend>Liikumisviis</legend>
      <div class="chips chips-grid" style="--cols: 3" id="r-mode">${MODES.map(
        (m) => `<label class="radio-chip"><input type="radio" name="r-mode" value="${m.key}" ${m === mode ? 'checked' : ''}><span data-label="${m.label}">${m.label}</span></label>`,
      ).join('')}</div>
    </fieldset>
    <p class="hint" id="r-status" aria-live="polite"></p>
    <div id="r-result"></div>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const inputs = { from: $<HTMLInputElement>('r-from'), to: $<HTMLInputElement>('r-to') };
  const pickBtns = { from: $<HTMLButtonElement>('r-pick-from'), to: $<HTMLButtonElement>('r-pick-to'), via: $<HTMLButtonElement>('r-pick-via') };
  const pickLabels = { from: 'Kaardilt', to: 'Kaardilt', via: 'Lisa vahepunkt kaardilt' };
  const status = $('r-status');
  const out = $('r-result');

  function setStatus(msg: string) {
    status.textContent = msg;
  }

  function choose(which: 'from' | 'to', p: Place) {
    if (which === 'from') from = p;
    else to = p;
    inputs[which].value = p.label;
    setPicking(null);
    loadRoute();
  }

  addressCombo(inputs.from, $<HTMLUListElement>('r-from-list'), (p) => choose('from', p), setStatus);
  addressCombo(inputs.to, $<HTMLUListElement>('r-to-list'), (p) => choose('to', p), setStatus);

  function setPicking(which: 'from' | 'to' | 'via' | null) {
    picking = which;
    for (const k of ['from', 'to', 'via'] as const) {
      pickBtns[k].setAttribute('aria-pressed', String(k === which));
      pickBtns[k].textContent = k === which ? 'Klõpsa kaardil...' : pickLabels[k];
    }
    amap.onPick(
      which === 'via'
        ? (lngLat) => {
            setPicking(null);
            addVia(lngLat);
          }
        : which
          ? (lngLat) => choose(which, { label: 'Kaardilt valitud koht', lngLat })
          : null,
    );
    if (which) document.dispatchEvent(new Event('sheet:collapse'));
  }
  pickBtns.from.addEventListener('click', () => setPicking(picking === 'from' ? null : 'from'));
  pickBtns.to.addEventListener('click', () => setPicking(picking === 'to' ? null : 'to'));
  pickBtns.via.addEventListener('click', () => setPicking(picking === 'via' ? null : 'via'));

  /** Uus vahepunkt pannakse järjekorda selle järgi, kuhu ta praegusel teekonnal jääb */
  function addVia(lngLat: [number, number]) {
    if (!route || via.length >= MAX_VIA) return;
    const a = alongRoute(route, lngLat);
    const k = via.findIndex((v) => alongRoute(route!, v) > a);
    via.splice(k < 0 ? via.length : k, 0, lngLat);
    loadRoute();
  }

  function renderVia() {
    $('r-via-box').hidden = !(from && to);
    $('r-via-clear').hidden = !via.length;
    pickBtns.via.disabled = !route || via.length >= MAX_VIA;
    $('r-via-list').innerHTML = via
      .map(
        (_, k) => `<li><span class="wp-marker wp-via" aria-hidden="true">${k + 1}</span><span>Vahepunkt ${k + 1}</span>
          <button type="button" class="via-remove" data-k="${k}" aria-label="Eemalda vahepunkt ${k + 1}">Eemalda</button></li>`,
      )
      .join('');
  }
  $('r-via-list').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-k]');
    if (!b) return;
    via.splice(Number(b.dataset.k), 1);
    loadRoute();
  });
  $('r-via-clear').addEventListener('click', () => {
    via = [];
    loadRoute();
  });

  /** Kaardi tähised A, vahepunktid ja B; lohistamine muudab vastavat punkti */
  function showMarkers() {
    const pts: Waypoint[] = [];
    if (from) pts.push({ lngLat: from.lngLat, label: 'A', kind: 'end' });
    via.forEach((v, k) => pts.push({ lngLat: v, label: String(k + 1), kind: 'via' }));
    if (to) pts.push({ lngLat: to.lngLat, label: 'B', kind: 'end' });
    amap.setWaypoints(visible ? pts : [], (k, lngLat) => {
      const moved = { label: 'Kaardilt valitud koht', lngLat };
      if (from && k === 0) {
        from = moved;
        inputs.from.value = moved.label;
      } else if (to && k === pts.length - 1) {
        to = moved;
        inputs.to.value = moved.label;
      } else via[k - (from ? 1 : 0)] = lngLat;
      loadRoute();
    });
    amap.onRouteClick(visible && route ? addVia : null);
  }

  $('r-geo').addEventListener('click', () => {
    if (!navigator.geolocation) return setStatus('Sinu brauser ei toeta asukoha määramist.');
    setStatus('Määran asukohta...');
    navigator.geolocation.getCurrentPosition(
      (pos) => choose('from', { label: 'Minu asukoht', lngLat: [pos.coords.longitude, pos.coords.latitude] }),
      () => setStatus('Asukohta ei õnnestunud määrata. Kirjuta aadress või vali koht kaardilt.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });

  $('r-swap').addEventListener('click', () => {
    [from, to] = [to, from];
    via.reverse();
    inputs.from.value = from?.label ?? '';
    inputs.to.value = to?.label ?? '';
    loadRoute();
  });

  $('r-mode').addEventListener('change', (e) => {
    mode = MODES.find((m) => m.key === (e.target as HTMLInputElement).value)!;
    loadRoute();
  });

  async function loadRoute() {
    renderVia();
    showMarkers();
    if (!from || !to) {
      route = null;
      via = [];
      rematch();
      if (from || to) setStatus(from ? 'Vali ka sihtkoht.' : 'Vali ka algus.');
      return;
    }
    const seq = ++routeSeq;
    setStatus('Arvutan teekonda...');
    try {
      const coords = [from.lngLat, ...via, to.lngLat].map((p) => p.join(',')).join(';');
      const res = await fetch(`${ROUTER}/${mode.path}/route/v1/driving/${coords}?overview=full&geometries=geojson`);
      const json = (await res.json()) as {
        code: string;
        routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
        waypoints?: { location: [number, number] }[];
      };
      if (seq !== routeSeq) return;
      const r = json.routes?.[0];
      if (json.code !== 'Ok' || !r || r.geometry.coordinates.length < 2) {
        route = null;
        rematch();
        setStatus('Nende kohtade vahel teed ei leitud. Proovi valida koht tee lähedal.');
        return;
      }
      const line = r.geometry.coordinates;
      // Vahepunkti tähis liigub kohta, kuhu marsruutija selle teele paigutas
      if (json.waypoints?.length === via.length + 2) via = via.map((_, k) => json.waypoints![k + 1].location);
      const cum = new Float64Array(line.length);
      const lat0 = (line[0][1] * Math.PI) / 180;
      for (let k = 1; k < line.length; k++) {
        const dx = (line[k][0] - line[k - 1][0]) * 111320 * Math.cos(lat0);
        const dy = (line[k][1] - line[k - 1][1]) * 111320;
        cum[k] = cum[k - 1] + Math.hypot(dx, dy);
      }
      const first = !route;
      route = { line, cum, lengthM: r.distance, durationS: r.duration };
      setStatus('');
      rematch();
      // Vahepunkti lisamisel või lohistamisel kaart ei hüppa
      if (first) {
        fitTo(line);
        document.dispatchEvent(new Event('sheet:open'));
      }
    } catch {
      if (seq !== routeSeq) return;
      route = null;
      rematch();
      setStatus('Teekonna arvutamise teenus ei vasta. Proovi hiljem uuesti.');
    }
  }

  function fitTo(line: [number, number][]) {
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of line) (w = Math.min(w, x)), (e = Math.max(e, x)), (s = Math.min(s, y)), (n = Math.max(n, y));
    amap.map.fitBounds([[w, s], [e, n]], { padding: 50, duration: 800, maxZoom: 16 });
  }

  /** Arvutab teekonna õnnetused uuesti (uus teekond või filtrid) */
  function rematch() {
    hits = route ? matchRoute(data, filtered, route, WIDTH) : [];
    if (visible) amap.showRoute(route?.line ?? null);
    renderVia();
    showMarkers();
    render();
    onChange();
  }

  function render() {
    if (!route) {
      out.innerHTML = '';
      return;
    }
    const period = yearFrom === yearTo ? `${yearFrom}. aastal` : `${yearFrom}-${yearTo} jooksul`;
    const head = `Teekond on ${kmText(route.lengthM)} pikk (${mode.label.toLowerCase()}, umbes ${durationText(route.durationS)}).`;
    const coords = missingLocationNote(
      data,
      filtered,
      (i) => !hasCoords(data, i),
      (n) => `Filtritele vastavatest õnnetustest on üle Eesti ${n} asukohata, neid ei saa teekonnaga siduda.`,
    );
    if (!hits.length) {
      out.innerHTML = `<div class="answer"><p>${head} Teest kuni ${WIDTH} m kaugusel ei ole ${period} registreeritud ühtegi inimkannatanutega liiklusõnnetust, mis vastaks valitud filtritele.</p></div>`;
      return;
    }

    let dead = 0;
    let inj = 0;
    const liik = new Map<number, number>();
    const bits = PARTICIPANTS.filter((p) => p.group === 'liikleja' && p.key !== 'soiduauto').map((p) => [p, participantMask(data.flagNames, p)] as const);
    const osa = new Map<string, number>();
    for (const { i } of hits) {
      dead += data.dead[i];
      inj += data.inj[i];
      liik.set(data.cat.liik[i], (liik.get(data.cat.liik[i]) ?? 0) + 1);
      for (const [p, b] of bits) if (data.flags[i] & b) osa.set(p.key, (osa.get(p.key) ?? 0) + 1);
    }
    const parts = bits
      .map(([p]) => [p, osa.get(p.key) ?? 0] as const)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([p, v]) => `${fmt(v)} ${p.kaas}`);
    const summary = `${head} Teest kuni ${WIDTH} m kaugusel toimus ${period} <strong>${plural(hits.length, 'õnnetus', 'õnnetust')}</strong>${
      parts.length ? `, neist ${parts.join(' ja ')}` : ''
    }. ${dead ? `Hukkus ${plural(dead, 'inimene', 'inimest')} ja` : ''} ${dead ? 'vigastada' : 'Vigastada'} sai ${plural(inj, 'inimene', 'inimest')}.`;

    // Õnnetused teekonna pikkuses
    const lenKm = route.lengthM / 1000;
    const binKm = BIN_STEPS_KM.find((b) => lenKm / b <= MAX_BINS) ?? 50;
    const binM = binKm * 1000;
    const nBins = Math.max(1, Math.ceil(route.lengthM / binM));
    const bins = Array.from({ length: nBins }, () => ({ n: 0, fatal: false, idx: [] as number[] }));
    for (const h of hits) {
      const b = bins[Math.min(nBins - 1, Math.floor(h.along / binM))];
      b.n++;
      b.fatal ||= data.dead[h.i] > 0;
      b.idx.push(h.i);
    }
    const maxBin = Math.max(1, ...bins.map((b) => b.n));
    const binName = (k: number) => {
      const idx = bins[k].idx;
      const road = mostCommon(idx.map((i) => data.dict.tanav[data.cat.tanav[i]] || (data.teeNr[i] ? `tee nr ${data.teeNr[i]}` : '')));
      const where = mostCommon(idx.map((i) => (data.ligikaudne[i] ? '' : data.dict.ay[data.cat.ay[i]]) || data.dict.ov[data.cat.ov[i]]));
      return [road, where].filter(Boolean).join(', ');
    };
    const binRange = (k: number) => {
      const a = k * binKm;
      const b = Math.min(lenKm, (k + 1) * binKm);
      // 0,25 km sammul on vaja kahte kohta, muidu piisab ühest
      const f = (v: number) => (binKm < 1 ? v.toFixed(Number.isInteger(binKm * 10) ? 1 : 2) : String(Math.round(v * 10) / 10)).replace('.', ',');
      return `${f(a)}-${f(b)} km`;
    };
    const top = bins
      .map((b, k) => [k, b.n] as const)
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const recent = [...hits].sort((a, b) => data.dateMs[b.i] - data.dateMs[a.i]).slice(0, 15);
    installHeatTip();

    out.innerHTML = `
      <div class="answer"><p>${summary}</p></div>
      ${coords.note ? `<p class="hint route-note">${coords.note.trim()}</p>` : ''}
      <p class="hint route-note">Kaardil on nüüd näha ainult teekonna õnnetused. Teistes vaadetes on jälle kõik õnnetused.</p>
      <section class="card"><h3>Kus teekonnal?</h3>
        <p class="hint">Iga tulp on ${binKm < 1 ? `${binKm * 1000} m` : `${String(binKm).replace('.', ',')} km`} teelõik. Klõpsa tulbal, et seda kaardil näha.</p>
        <div class="route-profile">${bins
          .map(
            (b, k) => `<button type="button" class="rp-bar${b.fatal ? ' rp-fatal' : ''}" data-bin="${k}"
              aria-label="${binRange(k)}: ${plural(b.n, 'õnnetus', 'õnnetust')}" data-tip="${binRange(k)}: ${plural(b.n, 'õnnetus', 'õnnetust')}">
              <span style="height:${(b.n / maxBin) * 100}%"></span></button>`,
          )
          .join('')}</div>
        <div class="rp-axis"><span>A · 0 km</span><span>${kmText(route.lengthM)} · B</span></div>
        ${top.length ? `<h3 class="card-subhead">Kõige rohkem õnnetusi</h3>
          <ul class="recent">${top
            .map(
              ([k, n]) => `<li><button type="button" class="link" data-bin="${k}">
                <span><strong>${binRange(k)}</strong> ${escapeHtml(binName(k))}</span>
                <span class="rp-count">${plural(n, 'õnnetus', 'õnnetust')}</span></button></li>`,
            )
            .join('')}</ul>` : ''}
      </section>
      <section class="card"><h3>Õnnetuse liik</h3>${barList(
        [...liik].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: liikLabel(data.dict.liik[k]), value: v })),
        hits.length,
      )}</section>
      <section class="card"><h3>Viimased õnnetused</h3>
        <ul class="recent">${recent
          .map(
            ({ i, along }) => `<li><button type="button" class="link" data-i="${i}">
              <span class="dot dot-${data.dead[i] ? 'fatal' : 'injury'}" aria-hidden="true"></span>
              <span><strong>${escapeHtml(formatDate(data.dateMs[i], data.hour[i]).split(',').slice(0, 1).join(''))}</strong>
              ${escapeHtml(liikDetailLabel(data.dict.liikD[data.cat.liikD[i]]))}${data.dead[i] ? ` <em>(hukkunuga)</em>` : ''}
              <span class="rp-km">${kmText(along)} algusest</span></span>
            </button></li>`,
          )
          .join('')}</ul>
        ${hits.length > recent.length ? `<p class="hint">Näidatud ${recent.length} viimast ${fmt(hits.length)}-st.</p>` : ''}
      </section>`;

    out.querySelectorAll<HTMLButtonElement>('button[data-bin]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = Number(b.dataset.bin);
        const a = k * binM;
        const z = (k + 1) * binM;
        const part = route!.line.filter((_, j) => route!.cum[j] >= a && route!.cum[j] <= z);
        // Lühikesel lõigul ei pruugi olla ühtki vahepunkti, siis võetakse lähim punkt
        if (!part.length) part.push(route!.line[route!.cum.findIndex((c) => c >= a)] ?? route!.line[route!.line.length - 1]);
        for (const i of bins[k].idx) part.push([data.lon[i], data.lat[i]]);
        fitTo(part);
        document.dispatchEvent(new Event('sheet:collapse'));
      }),
    );
    out.querySelectorAll<HTMLButtonElement>('button[data-i]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        amap.map.easeTo({ center: [data.lon[i], data.lat[i]], zoom: Math.max(amap.map.getZoom(), 16) });
        amap.openPopup([i]);
      }),
    );
  }

  return {
    update(indices, yFrom, yTo) {
      filtered = indices;
      yearFrom = yFrom;
      yearTo = yTo;
      hits = route ? matchRoute(data, filtered, route, WIDTH) : [];
      render();
    },
    mapIndices() {
      return visible && route ? Uint32Array.from(hits, (h) => h.i) : null;
    },
    onShow() {
      visible = true;
      amap.showRoute(route?.line ?? null);
      showMarkers();
      onChange();
    },
    onHide() {
      if (!visible) return;
      visible = false;
      setPicking(null);
      amap.showRoute(null);
      showMarkers();
      onChange();
    },
    urlParams() {
      if (!from || !to) return null;
      const out: Record<string, string> = { teekond: [from.lngLat, ...via, to.lngLat].map(pointToUrl).join(';') };
      if (mode !== MODES[0]) out.liikumine = mode.key;
      if (labelToUrl(from)) out.algus = labelToUrl(from);
      if (labelToUrl(to)) out.siht = labelToUrl(to);
      return out;
    },
    loadFromUrl(params) {
      const pts = (params.get('teekond') ?? '')
        .split(';')
        .map(pointFromUrl)
        .filter((p): p is [number, number] => p !== null);
      if (pts.length < 2 || pts.length > MAX_VIA + 2) return false;
      const m = MODES.find((x) => x.key === params.get('liikumine'));
      if (m) {
        mode = m;
        root.querySelector<HTMLInputElement>(`#r-mode input[value="${m.key}"]`)!.checked = true;
      }
      from = { label: labelFromUrl(params.get('algus')), lngLat: pts[0] };
      to = { label: labelFromUrl(params.get('siht')), lngLat: pts[pts.length - 1] };
      via = pts.slice(1, -1);
      inputs.from.value = from.label;
      inputs.to.value = to.label;
      loadRoute();
      return true;
    },
  };
}
