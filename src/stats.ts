// Statistikapaneel: põhinäitajad ja graafikud.

import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from 'chart.js';
import { lastFullYear, type Data } from './data';
import { applyFilters, placeMissing, type FilterState } from './filters';
import { DAYS, DAYS_SHORT, escapeHtml, fmt, liikLabel, MONTHS, participantMask, PARTICIPANTS, pct, plural, type ParticipantGroup } from './labels';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

type Metric = 'onnetused' | 'hukkunud' | 'vigastatud';
const METRIC_LABEL: Record<Metric, string> = { onnetused: 'Õnnetusi', hukkunud: 'Hukkunuid', vigastatud: 'Vigastatuid' };

export interface MissingNote {
  /** selgitus statistika ulatuse juurde (algab tühikuga), tühi kui midagi ei puudu */
  note: string;
  /** aastad, kus puudub vähemalt 5% õnnetustest; aastate graafikul heledamad */
  years: Set<number>;
}

/**
 * Selgitus, kui osa õnnetusi jääb statistikast välja, sest neil puudub asukoht.
 * indices: õnnetused, mida oleks pidanud arvestama; isMissing: kas õnnetus jääb asukoha puudumise tõttu välja.
 */
export function missingLocationNote(
  data: Data,
  indices: Iterable<number>,
  isMissing: (i: number) => boolean,
  sentence = (n: string) => `${n} on arvestamata, sest neil puudub asukoht.`,
): MissingNote {
  const missing = new Map<number, number>();
  const total = new Map<number, number>();
  let n = 0;
  for (const i of indices) {
    const y = data.year[i];
    total.set(y, (total.get(y) ?? 0) + 1);
    if (!isMissing(i)) continue;
    missing.set(y, (missing.get(y) ?? 0) + 1);
    n++;
  }
  if (!n) return { note: '', years: new Set() };
  // Aastad, kus puudub asukoht vähemalt 5% õnnetustel, sest seal on aastate võrdlus moonutatud
  const bigYears = [...missing].filter(([y, m]) => m / total.get(y)! >= 0.05).sort((a, b) => a[0] - b[0]);
  const big = bigYears.map(([y, m]) => `${y} (${pct(m, total.get(y)!)}% õnnetustest)`);
  const years = big.length > 1 ? `aastaid ${big.slice(0, -1).join(', ')} ja ${big[big.length - 1]}` : `aastat ${big[0]}`;
  const note = ` ${sentence(plural(n, 'õnnetus', 'õnnetust'))}${
    big.length ? ` See puudutab eriti ${years}, seega ${big.length > 1 ? 'pole need aastad' : 'pole see aasta'} siin teistega võrreldav${big.length > 1 ? 'ad' : ''}.` : ''
  }`;
  return { note, years: new Set(bigYears.map(([y]) => y)) };
}

/** Selgitus, kui haldusüksuse valimisel jäävad välja õnnetused, millel maakond või omavalitsus puudub */
export function placeNote(data: Data, st: FilterState): MissingNote {
  const isMissing = placeMissing(data, st);
  if (!isMissing) return { note: '', years: new Set() };
  // Asukohata õnnetuste kohta pole teada, mis haldusüksuses need juhtusid, seega arv on üle Eesti
  return missingLocationNote(
    data,
    applyFilters(data, { ...st, mk: -1, ov: -1 }),
    isMissing,
    (n) => `${n} üle Eesti on arvestamata, sest neil puudub asukoht ja pole teada, mis haldusüksuses need juhtusid.`,
  );
}

export interface StatsPanel {
  /** incompleteYears: aastad, mille andmed on selles vaates puudulikud (nt asukohata õnnetused jäid välja); näidatakse heledamalt */
  update: (indices: Uint32Array, label: string, incompleteYears?: Set<number>) => void;
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Horisontaalsed tulbad lihtsa HTML-ina (loetav ka ekraanilugejaga). Tulba pikkus on osakaal kogusummast. */
export function barList(rows: { label: string; value: number; title?: string }[], total: number) {
  const max = Math.max(1, total);
  return `<ul class="bars">${rows
    .map(
      (r) => `<li${r.title ? ` title="${escapeHtml(r.title)}"` : ''}>
        <span class="bar-label">${escapeHtml(r.label)}</span>
        <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${(r.value / max) * 100}%"></span></span>
        <span class="bar-value">${fmt(r.value)} <small>(${pct(r.value, total)}%)</small></span>
      </li>`,
    )
    .join('')}</ul>`;
}

/** onViewportToggle puudumisel (eraldi statistikaleht ilma kaardita) kaardiala lülitit ei näidata */
/**
 * Soojustabel: read on rowKey järgi (nt nädalapäev või kuu), veerud kellaaja järgi.
 * Õnnetused, mille kellaaeg on teadmata, jäetakse välja.
 */
let heatTipInstalled = false;
/**
 * Soojustabeli hõljuktekst. Brauseri enda title-tekst ilmub viivitusega ega tööta puutetundlikul ekraanil,
 * seepärast näitab üks ühine element lahtri data-tip teksti kohe (ka puudutusel).
 * Kasutusel ka teekonna profiili tulpadel.
 */
export function installHeatTip() {
  if (heatTipInstalled) return;
  heatTipInstalled = true;
  const tip = document.createElement('div');
  tip.className = 'heat-tip';
  tip.setAttribute('aria-hidden', 'true');
  tip.hidden = true;
  document.body.append(tip);
  let current: Element | null = null;
  const hide = () => {
    current = null;
    tip.hidden = true;
  };
  const show = (e: PointerEvent) => {
    const cell = (e.target as Element).closest?.('.heat [data-tip], .route-profile [data-tip]');
    if (!cell) return hide();
    if (cell !== current) {
      current = cell;
      tip.textContent = cell.getAttribute('data-tip');
      tip.hidden = false;
    }
    // Teksti kohal kursorit, ekraani servas nihutatakse sissepoole
    const r = tip.getBoundingClientRect();
    const x = Math.min(window.innerWidth - r.width - 8, Math.max(8, e.clientX - r.width / 2));
    const y = e.clientY - r.height - 12 < 8 ? e.clientY + 18 : e.clientY - r.height - 12;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  document.addEventListener('pointermove', show, { passive: true });
  document.addEventListener('pointerdown', show, { passive: true });
  document.addEventListener('scroll', hide, { passive: true, capture: true });
  document.documentElement.addEventListener('pointerleave', hide);
}

/** Soojustabeli veerud. Vaikimisi on veergudeks 24 tundi. */
export interface HeatCols {
  /** Veeru number; -1 jätab õnnetuse välja */
  key: (i: number) => number;
  short: string[];
  long: string[];
  /** Veeru nimi omastavas käändes tabeli kirjelduse jaoks */
  name: string;
  /** Kas veeru silt on päises nähtav (kitsad tunniveerud näitavad iga kolmandat) */
  showLabel: (c: number) => boolean;
  /** Lahtri hõljuktekst ilma arvuta, nt "jaanuar kell 8-9" */
  cellTip: (rowLong: string, c: number) => string;
}

const HOUR_COLS: HeatCols = {
  key: () => -1,
  short: Array.from({ length: 24 }, (_, h) => String(h)),
  long: Array.from({ length: 24 }, (_, h) => `kell ${h}-${h + 1}`),
  name: 'kellaaja',
  showLabel: (h) => h % 3 === 0,
  cellTip: (row, h) => `${row} kell ${h}-${h + 1}`,
};

export function hourHeatmap(
  data: Data,
  indices: Uint32Array,
  rowKey: (i: number) => number,
  rowShort: string[],
  rowLong: string[],
  rowName: string,
  wideLabels = false,
  colSpec?: HeatCols,
) {
  const cols = colSpec ?? { ...HOUR_COLS, key: (i: number) => data.hour[i] };
  const n = cols.short.length;
  const grid = rowShort.map(() => new Array<number>(n).fill(0));
  const rowSum = rowShort.map(() => 0);
  const colSum = new Array<number>(n).fill(0);
  let max = 1;
  let total = 0;
  for (const i of indices) {
    const c = cols.key(i);
    if (c < 0) continue;
    const r = rowKey(i);
    const v = ++grid[r][c];
    if (v > max) max = v;
    rowSum[r]++;
    colSum[c]++;
    total++;
  }
  const maxCol = Math.max(1, ...colSum);
  const share = (v: number) => `${total ? pct(v, total) : 0}%`;
  const idx = Array.from({ length: n }, (_, c) => c);
  installHeatTip();
  return `<table class="heat${wideLabels ? ' heat-wide-labels' : ''}">
      <caption class="visually-hidden">Õnnetuste arv ${rowName} (read) ja ${cols.name} (veerud) järgi; rea lõpus ja tabeli all on osakaal kõigist õnnetustest</caption>
      <colgroup><col class="heat-label-col"><col span="${n}"><col class="heat-pct-col"></colgroup>
      <thead><tr><td></td>${idx.map((c) => `<th scope="col" data-tip="${cols.long[c]}"><span class="${cols.showLabel(c) ? '' : 'visually-hidden'}">${cols.short[c]}</span></th>`).join('')}<th scope="col"><span class="visually-hidden">Osakaal</span></th></tr></thead>
      <tbody>${grid
        .map(
          (row, d) =>
            `<tr><th scope="row" data-tip="${rowLong[d]}">${rowShort[d]}</th>${row
              .map((v, c) => {
                const a = v / max;
                return `<td style="--a:${a.toFixed(3)}" data-tip="${cols.cellTip(rowLong[d], c)}: ${plural(v, 'õnnetus', 'õnnetust')}"><span class="visually-hidden">${fmt(v)}</span></td>`;
              })
              .join('')}<td class="heat-pct" data-tip="${rowLong[d]}: ${share(rowSum[d])} õnnetustest">${share(rowSum[d])}</td></tr>`,
        )
        .join('')}</tbody>
      <tfoot><tr><th scope="row"><span class="visually-hidden">Osakaal</span></th>${colSum
        .map(
          (v, c) =>
            `<td class="heat-bar-cell" data-tip="${cols.long[c]}: ${share(v)} õnnetustest"><span class="heat-bar" style="--h:${(v / maxCol).toFixed(3)}"></span><span class="visually-hidden">${share(v)}</span></td>`,
        )
        .join('')}<td></td></tr></tfoot></table>`;
}

export function buildStatsPanel(root: HTMLElement, data: Data, onViewportToggle?: (on: boolean) => void): StatsPanel {
  let metric: Metric = 'onnetused';
  let current: Uint32Array = new Uint32Array();
  let incomplete = new Set<number>();
  const fullYear = lastFullYear(data);
  const partialYear = data.years[data.years.length - 1] > fullYear ? data.years[data.years.length - 1] : null;
  const lastMonth = MONTHS[Number(data.uuendatud.slice(5, 7)) - 1];

  root.innerHTML = `
    <div class="field stats-scope">
      <label class="switch"${onViewportToggle ? '' : ' hidden'}><input type="checkbox" id="s-viewport"> <span>Arvesta ainult kaardil nähtavat ala</span></label>
      <p class="hint" id="s-scope"></p>
    </div>
    <div class="kpis" id="s-kpis"></div>
    <section class="card">
      <div class="card-head">
        <h2>Aastate kaupa</h2>
        <label class="visually-hidden" for="s-metric">Näitaja</label>
        <select id="s-metric">
          <option value="onnetused">Õnnetused</option>
          <option value="hukkunud">Hukkunud</option>
          <option value="vigastatud">Vigastatud</option>
        </select>
      </div>
      <div class="chart-box"><canvas id="s-years" role="img" aria-label="Tulpdiagramm aastate kaupa"></canvas></div>
      ${partialYear ? `<p class="hint">${partialYear}. aasta andmed on jaanuarist ${lastMonth}ni, seega pole see aasta teiste aastatega võrreldav.</p>` : ''}
      <p class="hint" id="s-years-note" hidden></p>
      <!-- Graafiku andmed tabelina ainult ekraanilugejale -->
      <div class="visually-hidden" id="s-years-table"></div>
    </section>
    <section class="card">
      <h2>Millal õnnetusi juhtub?</h2>
      <p class="hint">Õnnetuste arv nädalapäeva ja kellaaja järgi. Mida tumedam ruut, seda rohkem õnnetusi. Protsent rea lõpus näitab päeva osakaalu, tulbad all kellaaja osakaalu. Arvesse ei lähe õnnetused, mille kellaaeg on teadmata.</p>
      <div class="heat-wrap" id="s-heat"></div>
    </section>
    <section class="card">
      <h2>Õnnetuse liik</h2>
      <div id="s-liik"></div>
    </section>
    <section class="card">
      <h2>Kes osalesid?</h2>
      <p class="hint">Ühes õnnetuses võib olla mitu osalist, seega ei anna osakaalud kokku 100%.</p>
      <div id="s-osalised"></div>
      <h3 class="card-subhead">Osaleja tunnused</h3>
      <p class="hint">Õnnetused, kus vähemalt ühel osalejal oli see tunnus.</p>
      <div id="s-tunnused"></div>
    </section>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  $<HTMLInputElement>('s-viewport').addEventListener('change', (e) => onViewportToggle?.((e.target as HTMLInputElement).checked));
  $<HTMLSelectElement>('s-metric').addEventListener('change', (e) => {
    metric = (e.target as HTMLSelectElement).value as Metric;
    renderYears();
  });

  const chart = new Chart<'bar', number[], string>($<HTMLCanvasElement>('s-years'), {
    type: 'bar',
    data: { labels: [] as string[], datasets: [{ data: [] as number[], backgroundColor: [] as string[], borderRadius: 3 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${METRIC_LABEL[metric]}: ${fmt(ctx.parsed.y ?? 0)}`,
            afterLabel: (ctx) => (incomplete.has(data.years[ctx.dataIndex]) ? 'Osal õnnetustel puudub asukoht, need pole arvestatud' : ''),
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: cssVar('--muted'), maxRotation: 0, autoSkipPadding: 6 } },
        y: { beginAtZero: true, ticks: { color: cssVar('--muted'), precision: 0 }, grid: { color: cssVar('--grid') } },
      },
    },
  });

  function perYear() {
    const map = new Map<number, number>(data.years.map((y) => [y, 0]));
    for (const i of current) {
      const v = metric === 'onnetused' ? 1 : metric === 'hukkunud' ? data.dead[i] : data.inj[i];
      map.set(data.year[i], (map.get(data.year[i]) ?? 0) + v);
    }
    return map;
  }

  function renderYears() {
    const years = perYear();
    const accent = cssVar('--accent');
    const partial = cssVar('--accent-soft');
    const scales = chart.options.scales!;
    scales.x!.ticks!.color = scales.y!.ticks!.color = cssVar('--muted');
    scales.y!.grid!.color = cssVar('--grid');
    const soft = (y: number) => y === partialYear || incomplete.has(y);
    chart.data.labels = [...years.keys()].map((y) => (soft(y) ? `${y}*` : String(y)));
    chart.data.datasets[0].data = [...years.values()];
    chart.data.datasets[0].backgroundColor = [...years.keys()].map((y) => (soft(y) ? partial : accent));
    const shown = data.years.filter((y) => incomplete.has(y));
    const note = $('s-years-note');
    note.hidden = !shown.length;
    note.textContent = shown.length
      ? shown.length > 1
        ? `${shown.slice(0, -1).map((y) => `${y}.`).join(', ')} ja ${shown[shown.length - 1]}. aasta tulbad on heledamad, sest osal nende aastate õnnetustest puudub asukoht ja need ei ole siin arvestatud.`
        : `${shown[0]}. aasta tulp on heledam, sest osal selle aasta õnnetustest puudub asukoht ja see osa ei ole siin arvestatud.`
      : '';
    chart.update();
    $('s-years-table').innerHTML = `<table class="data-table"><thead><tr><th scope="col">Aasta</th><th scope="col">${METRIC_LABEL[metric]}</th></tr></thead><tbody>${[
      ...years,
    ]
      .map(([y, v]) => `<tr><th scope="row">${y}${y === partialYear ? ' (osaline)' : incomplete.has(y) ? ' (asukohad puudulikud)' : ''}</th><td>${fmt(v)}</td></tr>`)
      .join('')}</tbody></table>`;
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderYears());

  function renderKpis() {
    let dead = 0;
    let inj = 0;
    let cur = 0;
    let prev = 0;
    const yearsInSet = new Set<number>();
    for (const i of current) {
      dead += data.dead[i];
      inj += data.inj[i];
      yearsInSet.add(data.year[i]);
    }
    const ref = Math.min(fullYear, Math.max(...yearsInSet, 0));
    for (const i of current) {
      if (data.year[i] === ref) cur++;
      else if (data.year[i] === ref - 1) prev++;
    }
    let trend = '';
    if (yearsInSet.has(ref) && yearsInSet.has(ref - 1) && prev > 0) {
      const ch = Math.round(((cur - prev) / prev) * 100);
      const word = ch > 0 ? 'rohkem' : ch < 0 ? 'vähem' : 'sama palju';
      trend = `<p class="kpi-trend">${ref}: ${fmt(cur)} õnnetust, ${ch === 0 ? 'sama palju kui' : `${Math.abs(ch)}% ${word} kui`} ${ref - 1}. aastal</p>`;
    }
    $('s-kpis').innerHTML = `
      <div class="kpi"><span class="kpi-value">${fmt(current.length)}</span><span class="kpi-label">õnnetust</span></div>
      <div class="kpi kpi-fatal"><span class="kpi-value">${fmt(dead)}</span><span class="kpi-label">hukkunut</span></div>
      <div class="kpi"><span class="kpi-value">${fmt(inj)}</span><span class="kpi-label">vigastatut</span></div>
      ${trend}`;
  }

  function renderHeat() {
    $('s-heat').innerHTML = hourHeatmap(data, current, (i) => data.dow[i], DAYS_SHORT, DAYS, 'nädalapäeva');
  }

  function renderLists() {
    const total = current.length;
    const liik = new Map<number, number>();
    const osa = new Map<string, number>();
    const bits = PARTICIPANTS.map((p) => [p.key, participantMask(data.flagNames, p)] as const);
    for (const i of current) {
      liik.set(data.cat.liik[i], (liik.get(data.cat.liik[i]) ?? 0) + 1);
      for (const [k, b] of bits) if (data.flags[i] & b) osa.set(k, (osa.get(k) ?? 0) + 1);
    }
    $('s-liik').innerHTML = barList(
      [...liik].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: liikLabel(data.dict.liik[k]), value: v })),
      total,
    );
    const osaList = (g: ParticipantGroup) =>
      barList(PARTICIPANTS.filter((p) => p.group === g).map((p) => ({ label: p.label, value: osa.get(p.key) ?? 0 })).sort((a, b) => b.value - a.value), total);
    $('s-osalised').innerHTML = osaList('liikleja');
    $('s-tunnused').innerHTML = osaList('tunnus');
  }

  return {
    update(indices, label, incompleteYears) {
      current = indices;
      incomplete = incompleteYears ?? new Set();
      $('s-scope').textContent = label;
      renderKpis();
      renderYears();
      renderHeat();
      renderLists();
    },
  };
}
