// Eraldi statistikaleht: filtrid ja statistika kõrvuti, ilma kaardita.

import './style.css';
import { startAnalytics } from './analytics';
import { loadData, type Data } from './data';
import { activeFilterCount, applyFilters, buildFilterPanel, filtersFromParams, syncFiltersToUrl } from './filters';
import { DAYS, DAYS_SHORT, escapeHtml, fmt, MONTHS, MONTHS_SHORT, plural } from './labels';
import { barList, buildStatsPanel, hourHeatmap, placeNote, type HeatCols } from './stats';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Lisakaardid, mis kitsas kaardipaneelis ei mahu, aga laial lehel on kasulikud */
function buildExtraCards(root: HTMLElement, data: Data) {
  root.insertAdjacentHTML(
    'beforeend',
    `<section class="card">
      <div class="card-head">
        <h2>Millal aasta jooksul?</h2>
        <label class="visually-hidden" for="x-kuu-veerud">Veerud</label>
        <select id="x-kuu-veerud">
          <option value="kell">Kellaaeg</option>
          <option value="paev">Nädalapäev</option>
        </select>
      </div>
      <p class="hint" id="x-kuu-hint"></p>
      <div class="heat-wrap" id="x-kuu"></div>
    </section>
    <section class="card">
      <h2>Maakond</h2>
      <div id="x-mk"></div>
    </section>`,
  );
  const el = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  const count = (indices: Uint32Array, key: (i: number) => number | string) => {
    const m = new Map<number | string, number>();
    for (const i of indices) {
      const k = key(i);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const sorted = (m: Map<number | string, number>, label: (k: number | string) => string, top = 99) =>
    [...m].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => ({ label: label(k), value: v }));

  // Kuu soojustabeli veerud: kellaaeg (vaikimisi) või nädalapäev
  const dayCols: HeatCols = {
    key: (i) => data.dow[i],
    short: DAYS_SHORT,
    long: DAYS,
    name: 'nädalapäeva',
    showLabel: () => true,
    cellTip: (row, d) => `${row}, ${DAYS[d]}`,
  };
  const hints = {
    kell: 'Õnnetuste arv kuu ja kellaaja järgi. Mida tumedam ruut, seda rohkem õnnetusi. Protsent rea lõpus näitab kuu osakaalu, tulbad all kellaaja osakaalu. Arvesse ei lähe õnnetused, mille kellaaeg on teadmata.',
    paev: 'Õnnetuste arv kuu ja nädalapäeva järgi. Mida tumedam ruut, seda rohkem õnnetusi. Protsent rea lõpus näitab kuu osakaalu, tulbad all nädalapäeva osakaalu.',
  };
  let kuuCols: 'kell' | 'paev' = 'kell';
  let last: Uint32Array = new Uint32Array();
  const renderKuu = () => {
    el('x-kuu-hint').textContent = hints[kuuCols];
    el('x-kuu').innerHTML = hourHeatmap(data, last, (i) => data.month[i], MONTHS_SHORT, MONTHS, 'kuu', true, kuuCols === 'paev' ? dayCols : undefined);
  };
  el('x-kuu-veerud').addEventListener('change', (e) => {
    kuuCols = (e.target as HTMLSelectElement).value as 'kell' | 'paev';
    renderKuu();
  });

  return (indices: Uint32Array) => {
    const total = indices.length;
    last = indices;
    renderKuu();
    const mk = count(indices, (i) => data.cat.mk[i]);
    el('x-mk').innerHTML = barList(sorted(mk, (k) => data.dict.mk[k as number] || 'Teadmata'), total);
  };
}

async function main() {
  startAnalytics();
  const summary = $('summary');
  let data: Data;
  try {
    data = await loadData(`${import.meta.env.BASE_URL}data/onnetused.json`);
  } catch (e) {
    summary.textContent = 'Andmete laadimine ebaõnnestus. Proovi lehte uuesti laadida.';
    throw e;
  }

  const stats = buildStatsPanel($('stat'), data);
  const updateExtra = buildExtraCards($('stat'), data);

  let frame = 0;
  const filters = buildFilterPanel($('filtrid'), data, () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(refresh);
  }, filtersFromParams(data, new URLSearchParams(location.search)));

  function refresh() {
    const st = filters.state;
    const indices = applyFilters(data, st);
    let dead = 0;
    for (const i of indices) dead += data.dead[i];
    const active = activeFilterCount(data, st);
    const years = st.yearFrom === st.yearTo ? String(st.yearFrom) : `${st.yearFrom}-${st.yearTo}`;
    summary.innerHTML = `<strong>${plural(indices.length, 'õnnetus', 'õnnetust')}</strong>, ${plural(dead, 'hukkunu', 'hukkunut')} · ${escapeHtml(years)}`;
    $('filter-state').innerHTML = active ? `<span class="badge">${plural(active, 'filter', 'filtrit')}</span>` : 'Kõik õnnetused';
    $('filter-reset').hidden = !active;
    const place = placeNote(data, st);
    stats.update(
      indices,
      place.note
        ? `Arvestatakse valitud haldusüksuse õnnetusi, mis vastavad filtritele (${fmt(indices.length)}).${place.note}`
        : `Arvestatakse kõiki filtritele vastavaid õnnetusi (${fmt(indices.length)}), ka neid, millel asukoht puudub.`,
      place.years,
    );
    updateExtra(indices);
    $<HTMLAnchorElement>('map-link').href = `./${syncFiltersToUrl(data, st)}`;
  }

  // Kitsal ekraanil saab filtrid kokku klappida; laial ekraanil on need alati näha
  const toggle = $<HTMLButtonElement>('filter-toggle');
  $('filter-head').addEventListener('click', (e) => {
    if (!(e.target as Element).closest('button')) toggle.click();
  });
  $('filter-reset').addEventListener('click', () => filters.reset());
  const narrow = window.matchMedia('(max-width: 860px)');
  const setOpen = (open: boolean) => {
    toggle.setAttribute('aria-expanded', String(open));
    $('filtrid').hidden = !open;
  };
  toggle.addEventListener('click', () => {
    if (narrow.matches) setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });
  const syncWidth = () => setOpen(!narrow.matches);
  narrow.addEventListener('change', syncWidth);
  syncWidth();

  refresh();
}

main();
