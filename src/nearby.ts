// "Minu ümbrus": aadressiotsing (Maa- ja Ruumiameti In-ADS), raadius ja kokkuvõte.

import { addressCombo, labelFromUrl, labelToUrl, pointFromUrl, pointToUrl, type Place } from './address';
import { hasCoords, lastFullYear, type Data } from './data';
import { escapeHtml, fmt, formatDate, liikDetailLabel, liikLabel, participantMask, PARTICIPANTS, pct, plural } from './labels';
import type { AccidentMap } from './map';
import { barList } from './stats';

const RADII = [250, 500, 1000];

export interface NearbyPanel {
  update: (indices: Uint32Array, yearFrom: number, yearTo: number) => void;
  onShow: () => void;
  onHide: () => void;
  /** Koht ja raadius lingi aadressi jaoks; null, kui kohta pole valitud */
  urlParams: () => Record<string, string> | null;
  /** Loeb koha lingi aadressist; tagastab true, kui seal oli koht */
  loadFromUrl: (params: URLSearchParams) => boolean;
}

function distanceM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const k = Math.PI / 180;
  const x = (lon2 - lon1) * k * Math.cos(((lat1 + lat2) / 2) * k);
  const y = (lat2 - lat1) * k;
  return Math.sqrt(x * x + y * y) * 6371000;
}

/** onChange kutsutakse, kui koht või raadius muutub (lingi aadress uueneb) */
export function buildNearbyPanel(root: HTMLElement, data: Data, amap: AccidentMap, onChange: () => void): NearbyPanel {
  let place: Place | null = null;
  let radius = 500;
  let filtered: Uint32Array = new Uint32Array();
  let yearFrom = data.years[0];
  let yearTo = data.years[data.years.length - 1];
  let picking = false;

  root.innerHTML = `
    <p class="lead">Vaata, kui palju õnnetusi on juhtunud sinu kodu, kooli või töökoha lähedal.</p>
    <div class="field combo">
      <label for="n-search">Aadress</label>
      <input id="n-search" type="search" autocomplete="off" placeholder="nt Telliskivi 60a, Tallinn"
        role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="n-results">
      <ul id="n-results" class="combo-list" role="listbox" aria-label="Aadressid" hidden></ul>
    </div>
    <div class="row row-buttons">
      <button type="button" class="btn btn-secondary" id="n-pick" aria-pressed="false">Vali kaardilt</button>
      <button type="button" class="btn btn-secondary" id="n-geo">Minu asukoht</button>
    </div>
    <fieldset class="field">
      <legend>Raadius</legend>
      <div class="chips" id="n-radius">${RADII.map(
        (r) => `<label class="radio-chip"><input type="radio" name="radius" value="${r}" ${r === radius ? 'checked' : ''}><span data-label="${r < 1000 ? `${r} m` : `${r / 1000} km`}">${r < 1000 ? `${r} m` : `${r / 1000} km`}</span></label>`,
      ).join('')}</div>
    </fieldset>
    <p class="hint" id="n-status" aria-live="polite"></p>
    <div id="n-result"></div>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const input = $<HTMLInputElement>('n-search');
  const list = $<HTMLUListElement>('n-results');
  const status = $('n-status');
  const pickBtn = $<HTMLButtonElement>('n-pick');

  function setStatus(msg: string) {
    status.textContent = msg;
  }

  function choose(p: Place) {
    place = p;
    input.value = p.label;
    setPicking(false);
    render(true);
    document.dispatchEvent(new Event('sheet:open'));
    onChange();
  }

  addressCombo(input, list, choose, setStatus);

  function setPicking(on: boolean) {
    picking = on;
    pickBtn.setAttribute('aria-pressed', String(on));
    pickBtn.textContent = on ? 'Klõpsa kaardil...' : 'Vali kaardilt';
    amap.onPick(on ? (lngLat) => choose({ label: 'Kaardilt valitud koht', lngLat }) : null);
    if (on) document.dispatchEvent(new Event('sheet:collapse'));
  }
  pickBtn.addEventListener('click', () => setPicking(!picking));

  $('n-geo').addEventListener('click', () => {
    if (!navigator.geolocation) return setStatus('Sinu brauser ei toeta asukoha määramist.');
    setStatus('Määran asukohta...');
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ label: 'Minu asukoht', lngLat: [pos.coords.longitude, pos.coords.latitude] }),
      () => setStatus('Asukohta ei õnnestunud määrata. Kirjuta aadress või vali koht kaardilt.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });

  $('n-radius').addEventListener('change', (e) => {
    radius = Number((e.target as HTMLInputElement).value);
    render(true);
    onChange();
  });

  function render(fly = false) {
    const out = $('n-result');
    if (!place) {
      out.innerHTML = '';
      amap.showCircle(null, 0);
      return;
    }
    const [lon, lat] = place.lngLat;
    amap.showCircle(place.lngLat, radius);
    if (fly) {
      const dLat = (radius * 1.6) / 111320;
      const dLon = dLat / Math.cos((lat * Math.PI) / 180);
      amap.map.fitBounds([[lon - dLon, lat - dLat], [lon + dLon, lat + dLat]], { duration: 800 });
    }

    // Õnnetused ringis ja lähima õnnetuse omavalitsus võrdluse jaoks
    const inside: number[] = [];
    let nearestOv = -1;
    let nearestD = Infinity;
    for (const i of filtered) {
      if (!hasCoords(data, i)) continue;
      const d = distanceM(lat, lon, data.lat[i], data.lon[i]);
      if (d <= radius) inside.push(i);
      if (d < nearestD && data.cat.ov[i]) (nearestD = d), (nearestOv = data.cat.ov[i]);
    }
    const ovIdx = place.ov ? data.dict.ov.indexOf(place.ov) : nearestOv;
    const ovName = ovIdx > 0 ? data.dict.ov[ovIdx] : '';

    let dead = 0;
    let inj = 0;
    const liik = new Map<number, number>();
    const bits = PARTICIPANTS.filter((p) => p.group === 'liikleja' && p.key !== 'soiduauto').map((p) => [p, participantMask(data.flagNames, p)] as const);
    const osa = new Map<string, number>();
    for (const i of inside) {
      dead += data.dead[i];
      inj += data.inj[i];
      liik.set(data.cat.liik[i], (liik.get(data.cat.liik[i]) ?? 0) + 1);
      for (const [p, b] of bits) if (data.flags[i] & b) osa.set(p.key, (osa.get(p.key) ?? 0) + 1);
    }

    const rText = radius < 1000 ? `${radius} m` : `${radius / 1000} km`;
    const period = yearFrom === yearTo ? `${yearFrom}. aastal` : `${yearFrom}-${yearTo} jooksul`;
    if (!inside.length) {
      out.innerHTML = `<div class="answer"><p>Valitud kohast ${rText} raadiuses ei ole ${period} registreeritud ühtegi inimkannatanutega liiklusõnnetust, mis vastaks valitud filtritele.</p></div>`;
      return;
    }

    const topOsa = bits
      .map(([p]) => [p, osa.get(p.key) ?? 0] as const)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    const parts = topOsa.slice(0, 2).map(([p, v]) => `${fmt(v)} ${p.kaas}`);
    const summary = `Valitud kohast ${rText} raadiuses toimus ${period} <strong>${plural(inside.length, 'õnnetus', 'õnnetust')}</strong>${
      parts.length ? `, neist ${parts.join(' ja ')}` : ''
    }. ${dead ? `Hukkus ${plural(dead, 'inimene', 'inimest')} ja` : ''} ${dead ? 'vigastada' : 'Vigastada'} sai ${plural(inj, 'inimene', 'inimest')}.`;

    // Viimaste täisaastate trend
    const lastFull = Math.min(lastFullYear(data), yearTo);
    const trendYears = Array.from({ length: 5 }, (_, k) => lastFull - 4 + k).filter((y) => y >= yearFrom);
    const perYear = new Map<number, number>(trendYears.map((y) => [y, 0]));
    for (const i of inside) if (perYear.has(data.year[i])) perYear.set(data.year[i], perYear.get(data.year[i])! + 1);
    const maxY = Math.max(1, ...perYear.values());

    // Võrdlus omavalitsusega: osakaalud, mitte absoluutarvud (pindala ei ole teada)
    let compare = '';
    if (ovIdx > 0 && inside.length >= 5) {
      let ovTotal = 0;
      const ovOsa = new Map<string, number>();
      for (const i of filtered) {
        if (data.cat.ov[i] !== ovIdx) continue;
        ovTotal++;
        for (const [p, b] of bits) if (data.flags[i] & b) ovOsa.set(p.key, (ovOsa.get(p.key) ?? 0) + 1);
      }
      const rows = topOsa.slice(0, 4).map(([p, v]) => {
        const here = pct(v, inside.length);
        const there = pct(ovOsa.get(p.key) ?? 0, ovTotal);
        const diff = here - there;
        const note = Math.abs(diff) < 5 ? 'sarnane' : diff > 0 ? 'rohkem' : 'vähem';
        return `<tr><th scope="row">${escapeHtml(p.label)}</th><td>${here}%</td><td>${there}%</td><td class="cmp-${note}">${note}</td></tr>`;
      });
      if (rows.length && ovTotal) {
        compare = `<section class="card"><h3>Võrdlus: ${escapeHtml(ovName)}</h3>
          <p class="hint">Mitmes õnnetuses osales see liikleja siin ja omavalitsuses tervikuna (samade filtritega).</p>
          <table class="data-table cmp"><thead><tr><th scope="col">Osaline</th><th scope="col">Siin</th><th scope="col">Omavalitsus</th><th scope="col"></th></tr></thead>
          <tbody>${rows.join('')}</tbody></table></section>`;
      }
    }

    const recent = [...inside].sort((a, b) => data.dateMs[b] - data.dateMs[a]).slice(0, 15);

    out.innerHTML = `
      <div class="answer"><p>${summary}</p></div>
      ${trendYears.length > 1 ? `<section class="card"><h3>Viimased ${trendYears.length} täisaastat</h3>
        <div class="mini-bars" role="list">${trendYears
          .map((y) => {
            const v = perYear.get(y)!;
            return `<div role="listitem" class="mini-bar"><span class="mini-val">${v}</span><span class="mini-track"><span class="mini-fill" style="height:${(v / maxY) * 100}%"></span></span><span class="mini-year">${y}</span></div>`;
          })
          .join('')}</div></section>` : ''}
      <section class="card"><h3>Õnnetuse liik</h3>${barList(
        [...liik].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: liikLabel(data.dict.liik[k]), value: v })),
        inside.length,
      )}</section>
      ${compare}
      <section class="card"><h3>Viimased õnnetused</h3>
        <ul class="recent">${recent
          .map(
            (i) => `<li><button type="button" class="link" data-i="${i}">
              <span class="dot dot-${data.dead[i] ? 'fatal' : 'injury'}" aria-hidden="true"></span>
              <span><strong>${escapeHtml(formatDate(data.dateMs[i], data.hour[i]).split(',').slice(0, 1).join(''))}</strong>
              ${escapeHtml(liikDetailLabel(data.dict.liikD[data.cat.liikD[i]]))}${data.dead[i] ? ` <em>(hukkunuga)</em>` : ''}</span>
            </button></li>`,
          )
          .join('')}</ul>
        ${inside.length > recent.length ? `<p class="hint">Näidatud ${recent.length} viimast ${fmt(inside.length)}-st.</p>` : ''}
      </section>`;

    out.querySelectorAll<HTMLButtonElement>('button[data-i]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        amap.map.easeTo({ center: [data.lon[i], data.lat[i]], zoom: Math.max(amap.map.getZoom(), 16) });
        amap.openPopup([i]);
      }),
    );
  }

  return {
    update(indices, from, to) {
      filtered = indices;
      yearFrom = from;
      yearTo = to;
      render(false);
    },
    onShow() {
      amap.showCircle(place?.lngLat ?? null, radius);
    },
    onHide() {
      setPicking(false);
      amap.showCircle(null, 0);
    },
    urlParams() {
      if (!place) return null;
      const out: Record<string, string> = { koht: pointToUrl(place.lngLat) };
      if (radius !== 500) out.raadius = String(radius);
      if (labelToUrl(place)) out.aadress = labelToUrl(place);
      return out;
    },
    loadFromUrl(params) {
      const lngLat = pointFromUrl(params.get('koht') ?? '');
      if (!lngLat) return false;
      const r = Number(params.get('raadius'));
      if (RADII.includes(r)) {
        radius = r;
        root.querySelector<HTMLInputElement>(`#n-radius input[value="${r}"]`)!.checked = true;
      }
      // Omavalitsus pole lingis; võrdluseks võetakse lähima õnnetuse oma
      place = { label: labelFromUrl(params.get('aadress')), lngLat };
      input.value = place.label;
      render(true);
      return true;
    },
  };
}
