#!/usr/bin/env node
// Leiab liiklusõnnetused, mille koordinaadid on andmetes ilmselgelt valed.
//
// Kasutus:
//   node scripts/kontrolli_asukohti.mjs [sisend.csv]
//
// Kontrollid:
//   1. asendusväärtus - sama koordinaat on kasutusel vähemalt kolme eri omavalitsuse õnnetuse juures
//      (kahe omavalitsuse piiril olev tee võib õigustatult jagada sama punkti);
//   2. vees - punkt on Maa- ja Ruumiameti aluskaardi järgi vähemalt 100 m veekogu sees;
//   3. asulast kaugel - punkt on oma asustusüksuse õnnetuste mediaanist üle 15 km kaugusel;
//   4. tee km ei klapi - õnnetusel on tee number ja kilomeeter, aga punkt on sellest kohast üle 1,5 km
//      eemal. Kontrollitakse ainult kirjeid, kus km on ümardatud täisarvuks või sama punkt on kasutusel
//      sama tee eri kilomeetritel: täpse km-iga kirjete puhul on pigem vananenud km, mitte koordinaat. Oodatud koht leitakse sama tee teiste õnnetuste täpsete kilomeetrite ja koordinaatide
//      vahelt interpoleerides. Sellisel juhul on andmetes tavaliselt koordinaadiks asula keskpunkt.
//      Kui algne punkt on teeregistri järgi siiski sama tee peal, seda ei liigutata: siis on tõenäoliselt
//      vale km (tee on pärast ümberehitust ümber mõõdetud), mitte koordinaat. Samuti ei liigutata
//      murdosaga (mõõdetud) koordinaate: asula keskpunktid on andmetes alati täismeetrites.
//      Õnnetus paigutatakse arvutatud kohta ja märgitakse ligikaudseks. Kui interpoleerida ei
//      saa, aga sama koordinaat on kasutusel sama tee eri kilomeetritel, loetakse see asendusväärtuseks.
//
// Kui vigase asukohaga õnnetusel on andmetes tänav ja maja number, otsitakse õige asukoht
// Maa- ja Ruumiameti aadressiotsingust (In-ADS). Parandus võetakse kasutusele ainult siis,
// kui leitud aadress on täpne, maja number klapib ja omavalitsus on sama.
//
// Tulemus kirjutatakse faili scripts/asukohavead.json, mida build_data.py kasutab.
// Aluskaardi taillid salvestatakse kausta .cache/tiles, et korduval käivitamisel neid uuesti ei laaditaks.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] ?? join(ROOT, '..', 'lo_2011_2026.csv');
const OUT = join(ROOT, 'scripts', 'asukohavead.json');
const CACHE = join(ROOT, '.cache', 'tiles');

const ZOOM = 13; // umbes 10 m piksli kohta
const M_PER_PX = 10;
const WATER = [170, 210, 225]; // vee värv Maa- ja Ruumiameti kaardil
const WATER_MIN_M = 100;
const SETTLEMENT_MAX_KM = 15;
const SETTLEMENT_MIN_N = 5;
const PLACEHOLDER_MIN_OV = 3;
const ROAD_MAX_KM = 1.5; // nii kaugel tee km järgi oodatud kohast loetakse punkt valeks
const ROAD_GAP_KM = 4; // interpoleeritakse ainult kuni nii kaugete naaberpunktide vahel
const ROAD_SPREAD_KM = 1; // samas punktis sama tee kilomeetrite suurim lubatud vahe
const ON_ROAD_M = 150; // nii lähedal teeregistri tee joonele olev punkt on õigel teel (vale on pigem vana km)
const INADS = 'https://inaadress.maaamet.ee/inaadress/gazetteer';
const TEEREGISTER = 'https://teeregister.mnt.ee/290424/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=ms:teeosa';
const ROAD_CACHE = join(ROOT, '.cache', 'teed');

/** Otsib vigase asukohaga õnnetusele õige asukoha aadressi järgi. Tagastab null, kui kindlat vastet pole. */
async function geocode(street, nr, settlement, ov) {
  const query = [`${street} ${nr}`, settlement !== ov ? settlement : '', ov].filter(Boolean).join(', ');
  try {
    const res = await fetch(`${INADS}?address=${encodeURIComponent(query)}&results=3`);
    const best = ((await res.json()).addresses ?? [])[0];
    if (!best || !best.kvaliteet?.startsWith('tapne')) return null;
    if (best.aadress_nr?.toLowerCase() !== nr.toLowerCase()) return null;
    if (ov && best.omavalitsus !== ov) return null;
    return { lat: Number(best.viitepunkt_b), lon: Number(best.viitepunkt_l), aadress: best.ipikkaadress, allikas: 'In-ADS' };
  } catch {
    return null;
  }
}

// --- L-EST97 -> WGS84 (sama valem mis build_data.py-s) ---
const A = 6378137, F = 1 / 298.257222101, E = Math.sqrt(2 * F - F * F);
const rad = (d) => (d * Math.PI) / 180;
const LAT1 = rad(59 + 20 / 60), LAT2 = rad(58), LAT0 = rad(57.51755393055556), LON0 = rad(24);
const m = (p) => Math.cos(p) / Math.sqrt(1 - (E * Math.sin(p)) ** 2);
const t = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2);
const N = (Math.log(m(LAT1)) - Math.log(m(LAT2))) / (Math.log(t(LAT1)) - Math.log(t(LAT2)));
const AF = (A * m(LAT1)) / (N * t(LAT1) ** N);
const RHO0 = AF * t(LAT0) ** N;
function lestToWgs(easting, northing) {
  const dx = easting - 500000, dy = RHO0 - (northing - 6375000);
  const tt = (Math.hypot(dx, dy) / AF) ** (1 / N);
  const lon = Math.atan2(dx, dy) / N + LON0;
  let phi = Math.PI / 2 - 2 * Math.atan(tt);
  for (let k = 0; k < 10; k++) {
    const es = E * Math.sin(phi);
    phi = Math.PI / 2 - 2 * Math.atan(tt * ((1 - es) / (1 + es)) ** (E / 2));
  }
  return [(phi * 180) / Math.PI, (lon * 180) / Math.PI];
}

// --- Minimaalne PNG dekooder (palett, hall, RGB, RGBA; ilma põimimiseta) ---
function decodePng(buf) {
  let pos = 8, width, height, depth, ctype, palette;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('latin1', pos + 4, pos + 8);
    const chunk = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); depth = chunk[8]; ctype = chunk[9];
      if (chunk[12]) throw new Error('põimitud PNG ei ole toetatud');
    } else if (kind === 'PLTE') palette = chunk;
    else if (kind === 'IDAT') idat.push(chunk);
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = (width * channels * depth + 7) >> 3;
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = y ? out[up + i] : 0;
      const c = y && i >= bpp ? out[up + i - bpp] : 0;
      let v = raw[src + i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[dst + i] = v & 255;
    }
  }
  return (x, y) => {
    if (ctype === 3) {
      let idx;
      if (depth === 8) idx = out[y * stride + x];
      else {
        const per = 8 / depth, byte = out[y * stride + Math.floor(x / per)];
        idx = (byte >> (8 - depth * ((x % per) + 1))) & ((1 << depth) - 1);
      }
      return [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]];
    }
    const k = y * stride + x * channels;
    return channels >= 3 ? [out[k], out[k + 1], out[k + 2]] : [out[k], out[k], out[k]];
  };
}

const isWater = (rgb) => rgb.every((v, k) => Math.abs(v - WATER[k]) < 8);

/** Mitu meetrit ümberringi on kõik vesi (0 = punkt ei ole vees) */
function waterDepthM(pixel, px, py) {
  if (!isWater(pixel(px, py))) return 0;
  for (let r = 1; r <= 20; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = px + dx, y = py + dy;
        if (x >= 0 && y >= 0 && x < 256 && y < 256 && !isWater(pixel(x, y))) return (r - 1) * M_PER_PX;
      }
    }
  }
  return 20 * M_PER_PX;
}

function tilePos(lat, lon) {
  const n = 2 ** ZOOM, r = rad(lat);
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { key: `${Math.floor(x)}_${Math.floor(y)}`, px: Math.floor((x % 1) * 256), py: Math.floor((y % 1) * 256) };
}

async function loadTile(key) {
  const path = join(CACHE, `${ZOOM}_${key}.png`);
  if (!existsSync(path)) {
    const [x, y] = key.split('_').map(Number);
    const url = `https://tiles.maaamet.ee/tm/tms/1.0.0/kaart@GMC/${ZOOM}/${x}/${2 ** ZOOM - 1 - y}.png`;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        writeFileSync(path, Buffer.from(await res.arrayBuffer()));
        break;
      } catch (e) {
        if (attempt === 2) return null;
        await new Promise((ok) => setTimeout(ok, 1000 * (attempt + 1)));
      }
    }
  }
  return decodePng(readFileSync(path));
}

/**
 * Laadib teeregistrist tee lõigud: põhisõidutee lõigud alguse meetri järgi järjestatuna,
 * igaühel algus (a), registripikkus (len), joone pikkus (geomLen) ja joone punktid [X, Y].
 * Tagastab tühja loendi, kui teed registris pole, ja null, kui laadimine ebaõnnestus.
 */
async function loadRoad(nr) {
  const path = join(ROAD_CACHE, `${nr}.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const filter = `<ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>tee_number</ogc:PropertyName><ogc:Literal>${nr}</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${TEEREGISTER}&filter=${encodeURIComponent(filter)}`);
      if (!res.ok) throw new Error(String(res.status));
      const xml = await res.text();
      if (!xml.includes('FeatureCollection')) throw new Error('vigane vastus');
      const sections = [];
      for (const f of xml.match(/<ms:teeosa [\s\S]*?<\/ms:teeosa>/g) ?? []) {
        const get = (k) => f.match(new RegExp(`<ms:${k}>([^<]*)<`))?.[1];
        if (get('soidutee_nr') !== '1' || get('on_katkestus') === 'true') continue;
        const nums = f.match(/<gml:posList[^>]*>([^<]*)</)[1].trim().split(/\s+/).map(Number);
        const pts = [];
        for (let k = 0; k < nums.length; k += 2) pts.push([nums[k], nums[k + 1]]);
        sections.push({ a: +get('m_aadress'), len: +get('pikkus'), geomLen: +get('geom_pikkus'), pts });
      }
      sections.sort((p, q) => p.a - q.a);
      writeFileSync(path, JSON.stringify(sections));
      return sections;
    } catch {
      if (attempt === 2) return null;
      await new Promise((ok) => setTimeout(ok, 1000 * (attempt + 1)));
    }
  }
}

/** Tee kilomeetri järgi koht [X, Y] teeregistri tee joonel; null, kui km jääb lõikudest välja */
function registerPosition(sections, km) {
  const m = km * 1000;
  const s = sections?.find((p) => p.a <= m && m <= p.a + p.len);
  if (!s) return null;
  let d = s.len ? ((m - s.a) * s.geomLen) / s.len : 0;
  for (let k = 1; k < s.pts.length; k++) {
    const [x1, y1] = s.pts[k - 1], [x2, y2] = s.pts[k];
    const seg = Math.hypot(x2 - x1, y2 - y1);
    if (d <= seg) {
      const f = seg ? d / seg : 0;
      return [x1 + f * (x2 - x1), y1 + f * (y2 - y1)];
    }
    d -= seg;
  }
  return s.pts[s.pts.length - 1];
}

/** Punkti [X, Y] kaugus (m) tee joonest */
function distanceToRoad(sections, x, y) {
  let best = Infinity;
  for (const s of sections) {
    for (let k = 1; k < s.pts.length; k++) {
      const [x1, y1] = s.pts[k - 1], [x2, y2] = s.pts[k];
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      const f = l2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - x1 - f * dx, y - y1 - f * dy));
    }
  }
  return best;
}

/** Tee kilomeetri järgi oodatud koht [X, Y] sama tee viitepunktide vahelt; null, kui viidet pole */
function roadPosition(ref, km, skipId) {
  if (!ref) return null;
  let lo = null, hi = null;
  for (const p of ref) {
    if (p.id === skipId) continue;
    if (p.km <= km) lo = p;
    else { hi = p; break; }
  }
  if (!lo || !hi || hi.km - lo.km > ROAD_GAP_KM) return null;
  const f = (km - lo.km) / (hi.km - lo.km);
  return [lo.x + f * (hi.x - lo.x), lo.y + f * (hi.y - lo.y)];
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

async function main() {
  const lines = readFileSync(SRC, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(';');
  const col = (name) => head.indexOf(name);
  const [cId, cX, cY, cOv, cAy, cStreet, cNr, cRoad, cKm] = ['Juhtumi nr', 'X koordinaat', 'Y koordinaat', 'Omavalitsus', 'Asustusüksus', 'Tänav', 'Maja nr', 'Tee nr', 'Tee km'].map(col);
  const rows = lines.slice(1).map((l) => l.split(';')).filter((r) => r[cX] && r[cY]);
  const errors = {};
  const fixes = {};

  // 1. Asendusväärtused
  const byXY = new Map();
  for (const r of rows) {
    const k = `${r[cX]}|${r[cY]}`;
    if (!byXY.has(k)) byXY.set(k, new Set());
    if (r[cOv]) byXY.get(k).add(r[cOv]);
  }
  for (const r of rows) if (byXY.get(`${r[cX]}|${r[cY]}`).size >= PLACEHOLDER_MIN_OV) errors[r[cId]] = 'asendusväärtus';

  // 2. Tee km ei klapi
  const onRoad = rows.filter((r) => r[cRoad].trim() && r[cKm].trim());
  // Punktid, kus sama tee eri kilomeetrid jagavad üht koordinaati, on asula keskpunktid
  const kmsAt = new Map();
  for (const r of onRoad) {
    const k = `${r[cX]}|${r[cY]}|${r[cRoad].trim()}`;
    if (!kmsAt.has(k)) kmsAt.set(k, []);
    kmsAt.get(k).push(+r[cKm]);
  }
  const shared = (r) => {
    const kms = kmsAt.get(`${r[cX]}|${r[cY]}|${r[cRoad].trim()}`);
    return Math.max(...kms) - Math.min(...kms) > ROAD_SPREAD_KM;
  };
  // Viitepunktid: täpse kilomeetriga (mitte täisarv) õnnetused, mis ei ole keskpunktis
  const refs = new Map();
  for (const r of onRoad) {
    const km = +r[cKm];
    if (Number.isInteger(km) || shared(r) || errors[r[cId]]) continue;
    const road = r[cRoad].trim();
    if (!refs.has(road)) refs.set(road, []);
    refs.get(road).push({ id: r[cId], km, x: +r[cX], y: +r[cY] });
  }
  for (const ref of refs.values()) ref.sort((a, b) => a.km - b.km);
  // Viitepunkt, mis ei klapi oma naabritega, ei sobi viiteks
  for (const [road, ref] of refs) {
    refs.set(road, ref.filter((p) => {
      const exp = roadPosition(ref, p.km, p.id);
      return !exp || Math.hypot(p.x - exp[0], p.y - exp[1]) / 1000 <= ROAD_MAX_KM;
    }));
  }
  const measured = (r) => !Number.isInteger(+r[cX]) || !Number.isInteger(+r[cY]);
  const candidates = onRoad.filter((r) => (Number.isInteger(+r[cKm]) || shared(r)) && !measured(r));
  mkdirSync(ROAD_CACHE, { recursive: true });
  const roadNrs = [...new Set(candidates.map((r) => r[cRoad].trim()))];
  console.log(`Laadin teeregistrist ${roadNrs.length} tee joone...`);
  const roads = new Map();
  let nextRoad = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (nextRoad < roadNrs.length) {
        const nr = roadNrs[nextRoad++];
        roads.set(nr, await loadRoad(nr));
      }
    }),
  );
  const roadsMissing = [...roads.values()].filter((v) => v === null).length;
  let fromRegister = 0;
  for (const r of candidates) {
    const road = r[cRoad].trim(), km = +r[cKm];
    let exp = registerPosition(roads.get(road), km);
    const source = exp ? 'teeregister' : 'tee km';
    exp ??= roadPosition(refs.get(road), km, r[cId]);
    if (exp) {
      if (Math.hypot(+r[cX] - exp[0], +r[cY] - exp[1]) / 1000 <= ROAD_MAX_KM) continue;
      if (roads.get(road)?.length && distanceToRoad(roads.get(road), +r[cX], +r[cY]) <= ON_ROAD_M) continue;
      errors[r[cId]] ??= 'tee km ei klapi';
      const [lat, lon] = lestToWgs(exp[1], exp[0]);
      fixes[r[cId]] = { lat: +lat.toFixed(6), lon: +lon.toFixed(6), allikas: source, ligikaudne: true };
      if (source === 'teeregister') fromRegister++;
    } else if (shared(r)) errors[r[cId]] ??= 'asendusväärtus';
  }

  // 3. Asulast kaugel
  const groups = new Map();
  for (const r of rows) {
    if (!r[cAy]) continue;
    const k = `${r[cOv]}|${r[cAy]}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const members of groups.values()) {
    if (members.length < SETTLEMENT_MIN_N) continue;
    const mx = median(members.map((r) => +r[cX])), my = median(members.map((r) => +r[cY]));
    for (const r of members) {
      if (Math.hypot(+r[cX] - mx, +r[cY] - my) / 1000 > SETTLEMENT_MAX_KM) errors[r[cId]] ??= 'asulast kaugel';
    }
  }

  // 4. Vees
  mkdirSync(CACHE, { recursive: true });
  const pos = rows.map((r) => {
    const [lat, lon] = lestToWgs(+r[cY], +r[cX]); // andmestikus on X põhja- ja Y idakoordinaat
    return { id: r[cId], ...tilePos(lat, lon) };
  });
  const keys = [...new Set(pos.map((p) => p.key))];
  console.log(`Kontrollin ${rows.length} punkti ${keys.length} kaarditailli abil...`);
  const tiles = new Map();
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < keys.length) {
        const k = keys[next++];
        tiles.set(k, await loadTile(k));
      }
    }),
  );
  const missing = [...tiles.values()].filter((t) => !t).length;
  for (const p of pos) {
    const pixel = tiles.get(p.key);
    if (pixel && waterDepthM(pixel, p.px, p.py) >= WATER_MIN_M) errors[p.id] ??= 'vees';
  }

  // 5. Aadressiga õnnetustele õige asukoht In-ADS-ist
  const result = {};
  let fixed = 0;
  for (const r of rows) {
    if (!errors[r[cId]]) continue;
    const entry = { pohjus: errors[r[cId]] };
    if (fixes[r[cId]]) {
      entry.parandus = fixes[r[cId]];
      result[r[cId]] = entry;
      continue;
    }
    const street = r[cStreet].trim(), nr = r[cNr].trim();
    if (street && nr) {
      const fix = await geocode(street, nr, r[cAy].trim(), r[cOv].trim());
      if (fix) (entry.parandus = fix), fixed++;
    }
    result[r[cId]] = entry;
  }

  const sorted = Object.fromEntries(Object.entries(result).sort());
  writeFileSync(OUT, JSON.stringify(sorted, null, 1) + '\n');
  const counts = {};
  for (const v of Object.values(errors)) counts[v] = (counts[v] ?? 0) + 1;
  console.log(`Vigaseid asukohti: ${Object.keys(errors).length}`, counts);
  console.log(`Neist aadressi järgi õigesse kohta paigutatud: ${fixed}`);
  console.log(`Neist tee kilomeetri järgi ligikaudu paigutatud: ${Object.keys(fixes).length} (teeregistri järgi ${fromRegister})`);
  if (roadsMissing) console.log(`HOIATUS: ${roadsMissing} tee joon jäi teeregistrist laadimata, nende puhul kasutati õnnetuste vahelt interpoleerimist`);
  if (missing) console.log(`HOIATUS: ${missing} tailli jäi laadimata, nende punktide vee-kontroll jäi tegemata`);
  console.log(`Kirjutatud: ${OUT}`);
}

main();
