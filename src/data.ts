// Andmete laadimine ja dekodeerimine kiireks filtreerimiseks brauseris.

export const CATEGORY_KEYS = [
  'liik', 'liikD', 'mk', 'ov', 'ay', 'teeTyyp', 'teeEl', 'valg', 'valgD', 'ilm', 'kate', 'kateS', 'tanav', 'ristuv',
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

interface RawData {
  n: number;
  uuendatud: string;
  valeAsukoht?: number;
  parandatudAsukoht?: number;
  teeKmAsukoht?: number;
  flags: string[];
  dict: Record<CategoryKey, string[]> & { skeem: [string, string][] };
  cols: Record<CategoryKey, number[]> & {
    ts: number[]; lat: number[]; lon: number[]; dead: number[]; inj: number[]; isikuid: number[]; sk: number[];
    flags: number[]; asula: number[]; kiirus: number[]; skeem: number[];
    maja: string[]; teeNr: string[]; teeKm: (number | null)[]; ligik?: number[];
  };
}

export interface Data {
  n: number;
  uuendatud: string;
  /** Õnnetused, mille koordinaadid olid ilmselgelt valed ja jäeti kaardilt välja */
  valeAsukoht: number;
  /** Õnnetused, mille vale asukoht paigutati aadressi järgi õigesse kohta */
  parandatudAsukoht: number;
  /** Õnnetused, mille vale asukoht paigutati tee kilomeetri järgi ligikaudu õigesse kohta */
  teeKmAsukoht: number;
  flagNames: string[];
  dict: Record<CategoryKey, string[]>;
  skeem: [string, string][];
  /** Kuupäev UTC-na kodeeritud kohaliku ajana (aja tsooni ei rakendata) */
  dateMs: Float64Array;
  year: Uint16Array;
  month: Uint8Array; // 0-11
  dow: Uint8Array; // 0 = esmaspäev
  hour: Int8Array; // -1 = kellaaeg teadmata
  lat: Float64Array; // NaN = koordinaadid puuduvad
  lon: Float64Array;
  dead: Uint16Array;
  inj: Uint16Array;
  isikuid: Uint16Array;
  sk: Uint16Array;
  flags: Uint32Array;
  asula: Uint8Array; // 0 teadmata, 1 asulas, 2 väljaspool
  kiirus: Uint16Array;
  skeemIdx: Uint16Array;
  maja: string[];
  teeNr: string[];
  teeKm: (number | null)[];
  /** 1 = asukoht on tee kilomeetri järgi ligikaudne */
  ligikaudne: Uint8Array;
  cat: Record<CategoryKey, Uint16Array>;
  years: number[];
}

const EPOCH = Date.UTC(2011, 0, 1);

export async function loadData(url: string): Promise<Data> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Andmete laadimine ebaõnnestus (${res.status})`);
  const raw = (await res.json()) as RawData;
  const n = raw.n;
  const c = raw.cols;

  const dateMs = new Float64Array(n);
  const year = new Uint16Array(n);
  const month = new Uint8Array(n);
  const dow = new Uint8Array(n);
  const hour = new Int8Array(n);
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const ts = c.ts[i];
    const known = ts >= 0;
    const minutes = known ? ts : -ts - 1;
    const ms = EPOCH + minutes * 60000;
    const d = new Date(ms);
    dateMs[i] = ms;
    year[i] = d.getUTCFullYear();
    month[i] = d.getUTCMonth();
    dow[i] = (d.getUTCDay() + 6) % 7;
    hour[i] = known ? d.getUTCHours() : -1;
    lat[i] = c.lat[i] ? c.lat[i] / 1e5 : NaN;
    lon[i] = c.lon[i] ? c.lon[i] / 1e5 : NaN;
  }

  const cat = {} as Record<CategoryKey, Uint16Array>;
  for (const k of CATEGORY_KEYS) cat[k] = Uint16Array.from(c[k]);

  const years: number[] = [];
  for (let y = year[0]; y <= year[n - 1]; y++) years.push(y);

  return {
    n,
    uuendatud: raw.uuendatud,
    valeAsukoht: raw.valeAsukoht ?? 0,
    parandatudAsukoht: raw.parandatudAsukoht ?? 0,
    teeKmAsukoht: raw.teeKmAsukoht ?? 0,
    flagNames: raw.flags,
    dict: raw.dict,
    skeem: raw.dict.skeem,
    dateMs, year, month, dow, hour, lat, lon,
    dead: Uint16Array.from(c.dead),
    inj: Uint16Array.from(c.inj),
    isikuid: Uint16Array.from(c.isikuid),
    sk: Uint16Array.from(c.sk),
    flags: Uint32Array.from(c.flags),
    asula: Uint8Array.from(c.asula),
    kiirus: Uint16Array.from(c.kiirus),
    skeemIdx: Uint16Array.from(c.skeem),
    maja: c.maja,
    teeNr: c.teeNr,
    teeKm: c.teeKm,
    ligikaudne: c.ligik ? Uint8Array.from(c.ligik) : new Uint8Array(n),
    cat,
    years,
  };
}

export function hasFlag(data: Data, i: number, name: string): boolean {
  const bit = data.flagNames.indexOf(name);
  return bit >= 0 && (data.flags[i] & (1 << bit)) !== 0;
}

export function hasCoords(data: Data, i: number): boolean {
  return !Number.isNaN(data.lat[i]);
}

/** Viimane täisaasta andmestikus (jooksev aasta on poolik, kui andmed ei ulatu detsembri lõppu) */
export function lastFullYear(data: Data): number {
  const last = data.uuendatud;
  const y = Number(last.slice(0, 4));
  return last.slice(5) >= '12-31' ? y : y - 1;
}
