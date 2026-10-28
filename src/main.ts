import './style.css';
import { startAnalytics } from './analytics';
import { hasCoords, loadData, type Data } from './data';
import { activeFilterCount, applyFilters, buildFilterPanel, filtersFromParams, syncFiltersToUrl } from './filters';
import { fmt, MONTHS, plural } from './labels';
import { createMap, type Basemap } from './map';
import { buildNearbyPanel } from './nearby';
import { buildRoutePanel } from './route';
import { buildStatsPanel, missingLocationNote, placeNote } from './stats';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function infoHtml(data: Data) {
  const [y, m, d] = data.uuendatud.split('-').map(Number);
  let noCoords = 0;
  for (let i = 0; i < data.n; i++) if (!hasCoords(data, i)) noCoords++;
  return `
    <h2>Mis see on?</h2>
    <p>Kaart näitab kõiki Eestis ${data.years[0]}-${data.years[data.years.length - 1]} toimunud liiklusõnnetusi, kus keegi sai viga või hukkus. Kokku on andmestikus ${fmt(data.n)} õnnetust.</p>
    <h2>Kuidas kaarti lugeda?</h2>
    <ul class="plain">
      <li><span class="dot dot-fatal"></span> <strong>Tumepunane punkt</strong> on õnnetus, kus keegi hukkus.</li>
      <li><span class="dot dot-injury"></span> <strong>Oranž punkt</strong> on õnnetus, kus keegi sai vigastada.</li>
      <li><span class="dot dot-cluster"></span> <strong>Numbriga ring</strong> koondab mitu lähestikku olevat õnnetust. Klõpsa ringil, et sisse suumida. Tumepunane äär tähendab, et nende hulgas on hukkunuga õnnetusi.</li>
      <li><strong>Tiheduse</strong> vaade näitab kohti, kus õnnetusi on kõige rohkem.</li>
    </ul>
    <h2>Andmete allikas</h2>
    <p>Andmeid kogub Politsei- ja Piirivalveamet ning neid analüüsib ja avaldab Transpordiamet. Andmed on avaandmed: <a href="https://avaandmed.eesti.ee" target="_blank" rel="noopener">avaandmed.eesti.ee</a>. Vaata ka <a href="https://transpordiamet.ee/liiklusonnetuste-statistika" target="_blank" rel="noopener">Transpordiameti liiklusõnnetuste statistikat</a>.</p>
    <p><strong>Andmed on seisuga ${d}. ${MONTHS[m - 1]} ${y}.</strong></p>
    <h2>Mida tasub teada?</h2>
    <ul>
      <li>Andmestikus on <strong>ainult inimkannatanutega</strong> õnnetused. Plekimõlkidega õnnetusi siin ei ole.</li>
      <li>${fmt(noCoords)} õnnetust (${Math.round((noCoords / data.n) * 100)}%) ei ole kaardil, sest neil puudub täpne asukoht. Neist ${fmt(data.valeAsukoht)} puhul oli asukoht andmetes ilmselgelt vale (näiteks meres, järves või kümnete kilomeetrite kaugusel märgitud asulast), seega jätsime need kaardilt välja. Statistikas on kõik need õnnetused arvesse võetud.</li>
      ${data.parandatudAsukoht ? `<li>${plural(data.parandatudAsukoht, 'õnnetuse', 'õnnetuse')} vale asukoha paigutasime täpse aadressi järgi õigesse kohta (Maa- ja Ruumiameti aadressiotsingu abil).</li>` : ''}
      ${data.teeKmAsukoht ? `<li>${plural(data.teeKmAsukoht, 'õnnetuse', 'õnnetuse')} puhul oli koordinaadiks märgitud asula keskpunkt, kuigi õnnetus juhtus maanteel. Paigutasime need tee numbri ja kilomeetri järgi Transpordiameti teeregistri abil ligikaudu õigesse kohta. Kaardil on need õõnsa ringina ja täpsus on umbes 500 m.</li>` : ''}
      <li>${data.years[data.years.length - 1]}. aasta on poolik, seega ei ole see teiste aastatega võrreldav.</li>
      <li>Liiklejate mõisteid muudeti 2021. aastal. Näiteks tasakaaluliikurid (nt elektritõukerattad) loeti varem jalakäijateks, hiljem kergliikuriteks. Seepärast pole jalakäijate ja kergliikurite arvud enne ja pärast 2021. aastat päris võrreldavad.</li>
      <li>Joobes juhi osaluse kohta andmestikus infot ei ole.</li>
      <li>Kellaaeg 00:00 tähendab enamasti, et kellaaeg on teadmata. Selliseid õnnetusi kellaaja järgi ei filtreerita.</li>
      <li>Asukohad on hilisemalt korrastatud ja seotud tänase teede- ja haldusjaotusega.</li>
    </ul>
    <h2>Aadressiotsing ja teekond</h2>
    <p>Aadresse otsitakse Maa- ja Ruumiameti aadressiotsingust (In-ADS). Teekonna arvutamiseks saadetakse alguse ja sihtkoha koordinaadid OpenStreetMapi andmetel töötavale FOSSGIS-e marsruutijale (<a href="https://routing.openstreetmap.de" target="_blank" rel="noopener">routing.openstreetmap.de</a>). Muud asukohta ei salvestata ega saadeta kuhugi.</p>
    <p>Külastuste arvu loendatakse Verceli küpsisteta veebianalüütikaga. Valitud koht, aadress ega teekond sinna ei jõua.</p>
    <p>Teekonna õnnetused leitakse kauguse järgi teest. Kui teekond läheb üle silla või viadukti, võivad hulka sattuda ka all oleva tee õnnetused.</p>
    <h2>Autor</h2>
    <p>Idee autor on <a href="https://www.linkedin.com/in/martin-meitern/" target="_blank" rel="noopener"><strong>Martin Meitern</strong></a>. Rakenduse teostas Claude (Anthropicu tehisintellekt).</p>`;
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

  // Esimene refresh kirjutab aadressi ümber, seega loetakse algsed parameetrid enne seda
  const initialParams = new URLSearchParams(location.search);
  const amap = createMap($('map'), data);
  let indices: Uint32Array = new Uint32Array();
  let viewportOnly = false;

  const stats = buildStatsPanel($('view-stat'), data, (on) => {
    viewportOnly = on;
    refreshStats();
  });
  // Teekonna vaates näitab kaart ainult teekonna õnnetusi ja teekond on lingi aadressis
  let activeTab = 'tab-ylevaade';
  const syncUrl = () =>
    syncFiltersToUrl(
      data,
      filters.state,
      activeTab === 'tab-teekond' ? route.urlParams() : activeTab === 'tab-umbrus' ? nearby.urlParams() : null,
    );
  const onRouteChange = () => {
    amap.update(route.mapIndices() ?? indices);
    syncUrl();
  };
  const route = buildRoutePanel($('view-teekond'), data, amap, onRouteChange);
  const nearby = buildNearbyPanel($('view-umbrus'), data, amap, () => syncUrl());
  const filters = buildFilterPanel($('view-filtrid'), data, refresh, filtersFromParams(data, initialParams));
  $('view-info').innerHTML = infoHtml(data);

  /** Selgitus, kui palju filtritele vastavaid õnnetusi jääb asukoha puudumise tõttu kaardiala statistikast välja */
  function refreshStats() {
    const place = placeNote(data, filters.state);
    if (!viewportOnly) {
      stats.update(
        indices,
        place.note
          ? `Arvestatakse valitud haldusüksuse õnnetusi, mis vastavad filtritele.${place.note}`
          : 'Arvestatakse kõiki filtritele vastavaid õnnetusi üle Eesti, ka neid, millel asukoht puudub.',
        place.years,
      );
      return;
    }
    const b = amap.map.getBounds();
    const sub = indices.filter((i) => hasCoords(data, i) && b.contains([data.lon[i], data.lat[i]]));
    const coords = missingLocationNote(data, indices, (i) => !hasCoords(data, i));
    stats.update(
      sub,
      `Arvestatakse ainult kaardil praegu nähtavaid õnnetusi. Liiguta või suumi kaarti, et ala muuta.${coords.note}${place.note}`,
      new Set([...coords.years, ...place.years]),
    );
  }

  function refresh() {
    const st = filters.state;
    indices = applyFilters(data, st);
    let dead = 0;
    for (const i of indices) dead += data.dead[i];
    const active = activeFilterCount(data, st);
    $('filter-state').innerHTML = active
      ? `<span class="badge">${plural(active, 'filter', 'filtrit')}</span>`
      : 'Kõik õnnetused';
    $('filter-reset').hidden = !active;
    summary.innerHTML = `<strong>${plural(indices.length, 'õnnetus', 'õnnetust')}</strong>, ${plural(dead, 'hukkunu', 'hukkunut')} · ${
      st.yearFrom === st.yearTo ? st.yearFrom : `${st.yearFrom}-${st.yearTo}`
    }${active ? ` · <span class="badge">${plural(active, 'filter', 'filtrit')}</span>` : ''}`;
    const statsHref = `statistika.html${syncUrl()}`;
    $<HTMLAnchorElement>('stats-page-link').href = statsHref;
    $<HTMLAnchorElement>('map-stats-link').href = statsHref;
    route.update(indices, st.yearFrom, st.yearTo);
    amap.update(route.mapIndices() ?? indices);
    refreshStats();
    nearby.update(indices, st.yearFrom, st.yearTo);
  }

  let moveTimer = 0;
  amap.map.on('moveend', () => {
    if (!viewportOnly) return;
    clearTimeout(moveTimer);
    moveTimer = window.setTimeout(refreshStats, 150);
  });

  // Kaardikihid
  const btnPts = $<HTMLButtonElement>('layer-punktid');
  const btnHeat = $<HTMLButtonElement>('layer-soojus');
  const setLayer = (mode: 'punktid' | 'soojus') => {
    btnPts.setAttribute('aria-pressed', String(mode === 'punktid'));
    btnHeat.setAttribute('aria-pressed', String(mode === 'soojus'));
    $('legend').classList.toggle('legend-heat', mode === 'soojus');
    amap.ready.then(() => amap.setLayer(mode));
  };
  btnPts.addEventListener('click', () => setLayer('punktid'));
  btnHeat.addEventListener('click', () => setLayer('soojus'));
  $<HTMLSelectElement>('basemap').addEventListener('change', (e) => {
    amap.setBasemap((e.target as HTMLSelectElement).value as Basemap);
  });

  // Filtrite kokkuklapitav plokk
  const filterToggle = $<HTMLButtonElement>('filter-toggle');
  // Kogu päiserida avab ja sulgeb ploki, välja arvatud lähtestamise nupp
  $('filter-head').addEventListener('click', (e) => {
    if (!(e.target as Element).closest('button')) filterToggle.click();
  });
  $('filter-reset').addEventListener('click', () => filters.reset());
  filterToggle.addEventListener('click', () => {
    const open = filterToggle.getAttribute('aria-expanded') !== 'true';
    filterToggle.setAttribute('aria-expanded', String(open));
    $('view-filtrid').hidden = !open;
  });

  // Vahelehed (klaviatuuriga nooleklahvid)
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const selectTab = (tab: HTMLButtonElement, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')!).hidden = !on;
    }
    if (focus) tab.focus();
    // Filtrid on ühised kaardi vaadetele, Info vahelehel neid vaja ei ole
    $('filter-box').hidden = tab.id === 'tab-info';
    activeTab = tab.id;
    if (tab.id === 'tab-umbrus') nearby.onShow();
    else nearby.onHide();
    if (tab.id === 'tab-teekond') route.onShow();
    else route.onHide();
    syncUrl();
    setSheet(true);
    $('panel-body').scrollTop = 0;
  };
  tabs.forEach((t, k) => {
    t.addEventListener('click', () => selectTab(t));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') selectTab(tabs[(k + 1) % tabs.length], true);
      if (e.key === 'ArrowLeft') selectTab(tabs[(k - 1 + tabs.length) % tabs.length], true);
    });
  });

  // Mobiilis alt tõusev paneel
  const sheetBtn = $<HTMLButtonElement>('sheet-toggle');
  const setSheet = (open: boolean) => {
    sheetBtn.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('sheet-open', open);
  };
  sheetBtn.addEventListener('click', () => setSheet(sheetBtn.getAttribute('aria-expanded') !== 'true'));
  setSheet(false);

  // Paneeli saab päisest sõrmega üles ja alla tõmmata; lahti lastes jääb see lähimasse asendisse
  const panel = document.querySelector<HTMLElement>('.panel')!;
  const head = document.querySelector<HTMLElement>('.panel-head')!;
  const mobile = window.matchMedia('(max-width: 860px)');
  const PEEK = 152; // sama mis CSS-is suletud paneeli nähtav kõrgus
  let drag: { y0: number; base: number; max: number; y: number; t: number; v: number; moved: boolean } | null = null;
  let suppressClick = false;
  head.addEventListener('pointerdown', (e) => {
    if (!mobile.matches || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const max = panel.offsetHeight - PEEK;
    const open = document.body.classList.contains('sheet-open');
    drag = { y0: e.clientY, base: open ? 0 : max, max, y: e.clientY, t: e.timeStamp, v: 0, moved: false };
  });
  // Liikumist kuulatakse kogu aknas, sest sõrm või kursor liigub tõmmates päisest välja
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved) {
      // Väike liigutus on veel puudutus, mitte tõmme
      if (Math.abs(dy) < 8) return;
      drag.moved = true;
      panel.style.transition = 'none';
    }
    const dt = Math.max(1, e.timeStamp - drag.t);
    drag.v = (e.clientY - drag.y) / dt;
    drag.y = e.clientY;
    drag.t = e.timeStamp;
    panel.style.transform = `translateY(${Math.min(drag.max, Math.max(0, drag.base + dy))}px)`;
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    const pos = Math.min(d.max, Math.max(0, d.base + e.clientY - d.y0));
    // Kiire tõmme otsustab suuna, aeglase puhul loeb asend
    const open = Math.abs(d.v) > 0.4 ? d.v < 0 : pos < d.max / 2;
    panel.style.transition = '';
    panel.style.transform = '';
    setSheet(open);
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  // Tõmbe lõpus tulev klõps ei tohi paneeli tagasi lülitada ega vahelehte vahetada
  head.addEventListener('click', (e) => {
    if (suppressClick) e.stopPropagation(), e.preventDefault();
  }, true);
  document.addEventListener('sheet:collapse', () => setSheet(false));
  document.addEventListener('sheet:open', () => setSheet(true));

  refresh();
  // Lingiga jagatud teekond või koht avab kohe vastava vahelehe
  if (route.loadFromUrl(initialParams)) selectTab($<HTMLButtonElement>('tab-teekond'));
  else if (nearby.loadFromUrl(initialParams)) selectTab($<HTMLButtonElement>('tab-umbrus'));
}

main();
