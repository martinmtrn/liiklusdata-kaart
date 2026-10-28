// Kaart, kihid ja hüpikaknad.

import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapGeoJSONFeature, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { hasCoords, hasFlag, type Data } from './data';
import {
  escapeHtml, formatDate, ilmLabel, liikDetailLabel, liikLabel, plural, POPUP_PARTICIPANTS, valgLabel,
} from './labels';

// Vite ei leia MapLibre 6 workerit automaatselt üles, seega anname URL-i ette
maplibregl.setWorkerUrl(new URL(`${import.meta.env.BASE_URL}maplibre-gl-worker.mjs`, document.baseURI).href);

const COLOR_FATAL = '#7a0019';
const COLOR_INJURY = '#e8590c';
const COLOR_RING = '#1d4ed8';

export type Basemap = 'hallkaart' | 'kaart' | 'foto';

function tileUrl(name: Basemap) {
  const ext = name === 'foto' ? 'jpg' : 'png';
  return `https://tiles.maaamet.ee/tm/tms/1.0.0/${name}@GMC/{z}/{x}/{y}.${ext}`;
}

function style(basemap: Basemap): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      aluskaart: {
        type: 'raster',
        tiles: [tileUrl(basemap)],
        scheme: 'tms',
        tileSize: 256,
        minzoom: 6,
        maxzoom: 18,
        attribution: 'Aluskaart © <a href="https://maaruum.ee" target="_blank" rel="noopener">Maa- ja Ruumiamet</a> · Andmed: Transpordiamet, PPA',
      },
    },
    layers: [{ id: 'aluskaart', type: 'raster', source: 'aluskaart' }],
  };
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export interface Waypoint {
  lngLat: [number, number];
  label: string;
  kind: 'end' | 'via';
}

export interface AccidentMap {
  map: maplibregl.Map;
  update: (indices: Uint32Array) => void;
  setLayer: (mode: 'punktid' | 'soojus') => void;
  setBasemap: (b: Basemap) => void;
  showCircle: (center: [number, number] | null, radius: number) => void;
  /** Teekonna joon; null peidab */
  showRoute: (line: [number, number][] | null) => void;
  /** Teekonna lohistatavad tähised (A, vahepunktid, B). onMove kutsutakse lohistamise lõpus tähise järjekorranumbriga. */
  setWaypoints: (points: Waypoint[], onMove?: (k: number, lngLat: [number, number]) => void) => void;
  /** Klõps teekonna joonel (mitte õnnetuse punktil); null lülitab välja */
  onRouteClick: (cb: ((lngLat: [number, number]) => void) | null) => void;
  openPopup: (indices: number[]) => void;
  onPick: (cb: ((lngLat: [number, number]) => void) | null) => void;
  ready: Promise<void>;
}

export function popupHtml(data: Data, i: number): string {
  const dead = data.dead[i];
  const inj = data.inj[i];
  const sev = dead > 0 ? 'fatal' : 'injury';
  const harm = [dead ? plural(dead, 'hukkunu', 'hukkunut') : '', inj ? plural(inj, 'vigastatu', 'vigastatut') : ''].filter(Boolean).join(', ');

  const who: string[] = [];
  for (const [key, label] of POPUP_PARTICIPANTS) {
    // Bussijuht on alati ka ühissõidukijuht, seda ei korrata
    if (key === 'buss' && who.includes('ühissõidukijuht')) continue;
    if (hasFlag(data, i, key)) who.push(label);
  }

  const street = data.dict.tanav[data.cat.tanav[i]];
  const nr = data.maja[i];
  const cross = data.dict.ristuv[data.cat.ristuv[i]];
  const approx = data.ligikaudne[i] === 1;
  // Ligikaudse asukoha puhul on asustusüksus andmetes tuletatud valest koordinaadist
  const place = approx ? '' : data.dict.ay[data.cat.ay[i]];
  const ov = data.dict.ov[data.cat.ov[i]];
  let addr = [street && nr ? `${street} ${nr}` : street, cross ? `ristumine: ${cross}` : ''].filter(Boolean).join(', ');
  if (data.teeNr[i] && data.teeKm[i] != null && !nr) addr += `${addr ? ', ' : ''}tee nr ${data.teeNr[i]}, ${String(data.teeKm[i]).replace('.', ',')} km`;
  const where = [addr, place && place !== ov ? place : '', ov].filter(Boolean).join(', ');

  const cond: string[] = [];
  const valg = data.dict.valgD[data.cat.valgD[i]] || valgLabel(data.dict.valg[data.cat.valg[i]]);
  if (valg && valg !== 'Teadmata') cond.push(valg);
  const ilm = data.dict.ilm[data.cat.ilm[i]];
  if (ilm) cond.push(ilmLabel(ilm));
  const kate = data.dict.kateS[data.cat.kateS[i]];
  if (kate) cond.push(`tee ${kate.toLowerCase()}`);
  if (data.kiirus[i]) cond.push(`lubatud ${data.kiirus[i]} km/h`);

  const [, skeemText] = data.skeem[data.skeemIdx[i]];
  const liik = liikLabel(data.dict.liik[data.cat.liik[i]]);
  const detail = liikDetailLabel(data.dict.liikD[data.cat.liikD[i]]);

  return `<article class="pop pop-${sev}">
    <p class="pop-date">${escapeHtml(formatDate(data.dateMs[i], data.hour[i]))}</p>
    <h3>${escapeHtml(detail !== 'Teadmata' ? detail : liik)}</h3>
    <p class="pop-harm"><span class="dot dot-${sev}" aria-hidden="true"></span>${escapeHtml(harm || 'Kannatanute arv teadmata')}</p>
    ${skeemText ? `<p class="pop-desc">${escapeHtml(skeemText)}</p>` : ''}
    ${who.length ? `<p class="pop-tags">${who.map((w) => `<span class="tag">${escapeHtml(w)}</span>`).join('')}</p>` : ''}
    ${cond.length ? `<p class="pop-meta"><strong>Olud:</strong> ${escapeHtml(cond.map((c, k) => (k ? c.charAt(0).toLowerCase() + c.slice(1) : c)).join(', '))}</p>` : ''}
    ${where ? `<p class="pop-meta"><strong>Koht:</strong> ${escapeHtml(where)}</p>` : ''}
    ${approx ? '<p class="pop-approx">Asukoht on kaardil tee kilomeetri järgi ligikaudne, sest andmetes olnud koordinaat oli vale.</p>' : ''}
  </article>`;
}

export function createMap(container: HTMLElement, data: Data): AccidentMap {
  let basemap: Basemap = 'hallkaart';
  let layerMode: 'punktid' | 'soojus' = 'punktid';
  let lastFC: GeoJSON.FeatureCollection = EMPTY;
  let circleFC: GeoJSON.FeatureCollection = EMPTY;
  let routeFC: GeoJSON.FeatureCollection = EMPTY;
  let pickCb: ((lngLat: [number, number]) => void) | null = null;
  let routeClickCb: ((lngLat: [number, number]) => void) | null = null;
  let markers: maplibregl.Marker[] = [];

  const map = new maplibregl.Map({
    container,
    style: style(basemap),
    center: [25.0, 58.6],
    zoom: 6.4,
    minZoom: 5.5,
    maxZoom: 18,
    maxBounds: [[19.5, 56.8], [30.5, 60.4]],
    hash: 'kaart',
    attributionControl: {
      compact: true,
      customAttribution: 'Idee: <a href="https://www.linkedin.com/in/martin-meitern/" target="_blank" rel="noopener"><strong>Martin Meitern</strong></a>, teostus: Claude',
    },
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

  const popup = new maplibregl.Popup({ maxWidth: '340px', closeButton: true, focusAfterOpen: true });

  const addLayers = () => {
    // Kui aluskaarti vahetatakse enne esimest laadimist, kutsuvad nii 'load' kui ka 'style.load' selle välja
    if (map.getSource('onnetused')) return;
    map.addSource('onnetused', {
      type: 'geojson',
      data: lastFC,
      cluster: true,
      clusterRadius: 38,
      clusterMaxZoom: 13,
      clusterProperties: { f: ['+', ['get', 'f']] },
    });
    map.addSource('tihedus', { type: 'geojson', data: lastFC });
    map.addSource('ring', { type: 'geojson', data: circleFC });
    map.addSource('teekond', {
      type: 'geojson',
      data: routeFC,
      attribution: 'Teekond: <a href="https://routing.openstreetmap.de" target="_blank" rel="noopener">FOSSGIS</a>, © OpenStreetMap',
    });

    // Teekond on õnnetuste all, et punktid jääksid klõpsatavaks
    map.addLayer({
      id: 'teekond-aar', type: 'line', source: 'teekond', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5, 14, 10] },
    });
    map.addLayer({
      id: 'teekond-joon', type: 'line', source: 'teekond', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': COLOR_RING, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 14, 6], 'line-opacity': 0.75 },
    });

    map.addLayer({
      id: 'tihedus',
      type: 'heatmap',
      source: 'tihedus',
      layout: { visibility: layerMode === 'soojus' ? 'visible' : 'none' },
      paint: {
        'heatmap-weight': ['case', ['==', ['get', 'f'], 1], 3, 1],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 6, 0.12, 10, 0.3, 13, 0.6, 16, 1.2],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 6, 4, 10, 7, 13, 12, 16, 24, 18, 40],
        'heatmap-opacity': 0.8,
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(255,237,160,0)', 0.15, '#fed976', 0.35, '#feb24c', 0.55, '#fd8d3c', 0.75, '#e31a1c', 1, '#800026',
        ],
      },
    });

    const pointsVisible = layerMode === 'punktid' ? 'visible' : 'none';
    map.addLayer({
      id: 'klastrid',
      type: 'circle',
      source: 'onnetused',
      filter: ['has', 'point_count'],
      layout: { visibility: pointsVisible },
      paint: {
        'circle-color': ['step', ['get', 'point_count'], '#fdba74', 20, '#fb923c', 100, '#ea580c', 500, '#c2410c'],
        'circle-radius': ['step', ['get', 'point_count'], 13, 20, 17, 100, 22, 500, 28],
        'circle-stroke-width': ['case', ['>', ['get', 'f'], 0], 2.5, 1.5],
        'circle-stroke-color': ['case', ['>', ['get', 'f'], 0], COLOR_FATAL, '#ffffff'],
        'circle-opacity': 0.92,
      },
    });
    map.addLayer({
      id: 'klastrite-arv',
      type: 'symbol',
      source: 'onnetused',
      filter: ['has', 'point_count'],
      layout: {
        visibility: pointsVisible,
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 12,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': ['step', ['get', 'point_count'], '#431407', 100, '#ffffff'] },
    });
    map.addLayer({
      id: 'punktid',
      type: 'circle',
      source: 'onnetused',
      filter: ['!', ['has', 'point_count']],
      layout: { visibility: pointsVisible, 'circle-sort-key': ['get', 'f'] },
      paint: {
        // Ligikaudse asukohaga punkt on õõnes ring
        'circle-color': ['case', ['==', ['get', 'a'], 1], '#ffffff', ['==', ['get', 'f'], 1], COLOR_FATAL, COLOR_INJURY],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['==', ['get', 'f'], 1], 6, 4], 16, ['case', ['==', ['get', 'f'], 1], 10, 7]],
        'circle-stroke-width': ['case', ['==', ['get', 'a'], 1], 2.5, 1.5],
        'circle-stroke-color': ['case', ['==', ['get', 'a'], 1], ['case', ['==', ['get', 'f'], 1], COLOR_FATAL, COLOR_INJURY], '#ffffff'],
      },
    });

    map.addLayer({ id: 'ring-tais', type: 'fill', source: 'ring', paint: { 'fill-color': COLOR_RING, 'fill-opacity': 0.08 } });
    map.addLayer({ id: 'ring-joon', type: 'line', source: 'ring', paint: { 'line-color': COLOR_RING, 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
  };

  const ready = new Promise<void>((resolve) => {
    map.once('load', () => {
      addLayers();
      resolve();
    });
  });

  map.on('click', 'klastrid', async (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const src = map.getSource('onnetused') as GeoJSONSource;
    const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number);
    map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: Math.min(zoom, 17) });
  });

  map.on('click', 'punktid', (e) => {
    if (pickCb) return;
    const feats = map.queryRenderedFeatures(e.point, { layers: ['punktid'] }) as MapGeoJSONFeature[];
    const idx = [...new Set(feats.map((f) => f.properties.i as number))].sort((a, b) => data.dateMs[b] - data.dateMs[a]);
    if (idx.length) openPopup(idx);
  });

  map.on('click', (e) => {
    if (pickCb) return pickCb([e.lngLat.lng, e.lngLat.lat]);
    if (!routeClickCb || !map.getLayer('teekond-joon')) return;
    // Õnnetuse punkt on tähtsam kui teekond; joonel klõpsamiseks on paar pikslit varu
    if (map.queryRenderedFeatures(e.point, { layers: ['punktid', 'klastrid'] }).length) return;
    const { x, y } = e.point;
    const near = map.queryRenderedFeatures([[x - 8, y - 8], [x + 8, y + 8]], { layers: ['teekond-joon'] });
    if (near.length) routeClickCb([e.lngLat.lng, e.lngLat.lat]);
  });
  map.on('mouseenter', 'teekond-joon', () => {
    if (routeClickCb && !pickCb) map.getCanvas().style.cursor = 'copy';
  });
  map.on('mouseleave', 'teekond-joon', () => (map.getCanvas().style.cursor = pickCb ? 'crosshair' : ''));

  for (const layer of ['klastrid', 'punktid']) {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = pickCb ? 'crosshair' : ''));
  }

  function openPopup(indices: number[]) {
    const shown = indices.slice(0, 5);
    const first = shown[0];
    const more = indices.length - shown.length;
    const html = `<div class="pop-list">${shown.map((i) => popupHtml(data, i)).join('<hr>')}${
      more > 0 ? `<p class="pop-more">Samas kohas veel ${plural(more, 'õnnetus', 'õnnetust')}. Suurenda kaarti, et näha rohkem.</p>` : ''
    }</div>`;
    popup.setLngLat([data.lon[first], data.lat[first]]).setHTML(html).addTo(map);
  }

  function update(indices: Uint32Array) {
    const features: GeoJSON.Feature[] = [];
    for (const i of indices) {
      if (!hasCoords(data, i)) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [data.lon[i], data.lat[i]] },
        properties: { i, f: data.dead[i] > 0 ? 1 : 0, a: data.ligikaudne[i] },
      });
    }
    lastFC = { type: 'FeatureCollection', features };
    popup.remove();
    ready.then(() => {
      (map.getSource('onnetused') as GeoJSONSource).setData(lastFC);
      (map.getSource('tihedus') as GeoJSONSource).setData(lastFC);
    });
  }

  function setLayer(mode: 'punktid' | 'soojus') {
    layerMode = mode;
    const pts = mode === 'punktid' ? 'visible' : 'none';
    for (const id of ['klastrid', 'klastrite-arv', 'punktid']) map.setLayoutProperty(id, 'visibility', pts);
    map.setLayoutProperty('tihedus', 'visibility', mode === 'soojus' ? 'visible' : 'none');
  }

  function setBasemap(b: Basemap) {
    basemap = b;
    map.setStyle(style(basemap), { diff: false });
    map.once('style.load', addLayers);
  }

  function showCircle(center: [number, number] | null, radius: number) {
    circleFC = center ? { type: 'FeatureCollection', features: [circlePolygon(center, radius)] } : EMPTY;
    ready.then(() => (map.getSource('ring') as GeoJSONSource | undefined)?.setData(circleFC));
  }

  function showRoute(line: [number, number][] | null) {
    routeFC = line
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: {} }] }
      : EMPTY;
    ready.then(() => (map.getSource('teekond') as GeoJSONSource | undefined)?.setData(routeFC));
  }

  function setWaypoints(points: Waypoint[], onMove?: (k: number, lngLat: [number, number]) => void) {
    for (const m of markers) m.remove();
    markers = points.map((p, k) => {
      const el = document.createElement('div');
      el.className = `wp-marker wp-${p.kind}`;
      el.textContent = p.label;
      el.title = 'Lohista, et teekonda muuta';
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(p.lngLat).addTo(map);
      m.on('dragend', () => {
        const ll = m.getLngLat();
        onMove?.(k, [ll.lng, ll.lat]);
      });
      return m;
    });
  }

  function onRouteClick(cb: ((lngLat: [number, number]) => void) | null) {
    routeClickCb = cb;
  }

  function onPick(cb: ((lngLat: [number, number]) => void) | null) {
    pickCb = cb;
    map.getCanvas().style.cursor = cb ? 'crosshair' : '';
  }

  return { map, update, setLayer, setBasemap, showCircle, showRoute, setWaypoints, onRouteClick, openPopup, onPick, ready };
}

export function circlePolygon([lon, lat]: [number, number], radiusM: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let k = 0; k <= 64; k++) {
    const a = (k / 64) * 2 * Math.PI;
    coords.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}
