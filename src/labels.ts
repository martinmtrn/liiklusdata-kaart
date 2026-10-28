// Tavakeelsed sildid ja vormindus.

export const MONTHS = ['jaanuar', 'veebruar', 'märts', 'aprill', 'mai', 'juuni', 'juuli', 'august', 'september', 'oktoober', 'november', 'detsember'];
export const MONTHS_SHORT = ['jaan', 'veebr', 'märts', 'apr', 'mai', 'juuni', 'juuli', 'aug', 'sept', 'okt', 'nov', 'dets'];
export const DAYS = ['esmaspäev', 'teisipäev', 'kolmapäev', 'neljapäev', 'reede', 'laupäev', 'pühapäev'];
export const DAYS_SHORT = ['E', 'T', 'K', 'N', 'R', 'L', 'P'];

/**
 * Osalised filtris ja statistikas, kahes rühmas:
 * liikleja = mis liiki liikleja õnnetuses osales; tunnus = mõne osaleja tunnus (andmetes pole näha, kelle oma).
 * flags: andmefaili osalusbitid, millest valik koosneb (mitu bitti = VÕI).
 */
export type ParticipantGroup = 'liikleja' | 'tunnus';
export interface Participant {
  key: string;
  label: string;
  /** lühike nimetus lauses "neist N ..." (kaasaütlev) */
  kaas: string;
  group: ParticipantGroup;
  flags: string[];
  title?: string;
}

export const PARTICIPANTS: Participant[] = [
  { key: 'jalakaija', label: 'Jalakäija', kaas: 'jalakäijaga', group: 'liikleja', flags: ['jalakaija'] },
  { key: 'jalgrattur', label: 'Jalgrattur', kaas: 'jalgratturiga', group: 'liikleja', flags: ['jalgrattur'] },
  {
    key: 'kergliikur', label: 'Kergliikur (alates 2021)', kaas: 'kergliikuriga', group: 'liikleja', flags: ['kergliikur'],
    title: 'Nt elektritõukeratas. Andmetes eristatakse alates 2021. aastast, varem on tasakaaluliikurid jalakäijate all.',
  },
  { key: 'mootorratas', label: 'Mootorratas või mopeed', kaas: 'mootorratta või mopeediga', group: 'liikleja', flags: ['mootorrattur', 'mopeed'] },
  { key: 'soiduauto', label: 'Sõiduauto', kaas: 'sõiduautoga', group: 'liikleja', flags: ['soiduauto'] },
  { key: 'veoauto', label: 'Veoauto', kaas: 'veoautoga', group: 'liikleja', flags: ['veoauto'] },
  { key: 'uhissoiduk', label: 'Buss, tramm või troll', kaas: 'bussi, trammi või trolliga', group: 'liikleja', flags: ['uhissoiduk', 'buss'] },
  { key: 'maastikusoiduk', label: 'ATV või maastikusõiduk', kaas: 'maastikusõidukiga', group: 'liikleja', flags: ['maastikusoiduk'] },
  { key: 'alaealine', label: 'Laps või noor (alla 18)', kaas: 'alaealisega', group: 'tunnus', flags: ['alaealine'] },
  { key: 'eakas', label: 'Eakas juht (65+)', kaas: 'eaka juhiga', group: 'tunnus', flags: ['eakas'] },
  { key: 'algaja', label: 'Algaja juht', kaas: 'algaja juhiga', group: 'tunnus', flags: ['algaja'], title: 'Mootorsõiduki juht, kellel on esmane juhiluba' },
  {
    key: 'turvavarustuseta', label: 'Turvavarustus kasutamata', kaas: 'turvavarustust kasutamata', group: 'tunnus', flags: ['turvavarustuseta'],
    title: 'Mõni osaleja ei kasutanud turvavööd, kiivrit või helkurit',
  },
];

/** Osaluse bitimask (valiku mitu andmebitti kokku) */
export function participantMask(flagNames: string[], p: Participant): number {
  let m = 0;
  for (const f of p.flags) {
    const bit = flagNames.indexOf(f);
    if (bit >= 0) m |= 1 << bit;
  }
  return m;
}

/** Õnnetuse hüpikaknas näidatavad osalised detailselt (andmebitt, silt) */
export const POPUP_PARTICIPANTS: [string, string][] = [
  ['jalakaija', 'jalakäija'],
  ['jalgrattur', 'jalgrattur'],
  ['kergliikur', 'kergliikur'],
  ['mootorrattur', 'mootorrattur'],
  ['mopeed', 'mopeedijuht'],
  ['soiduauto', 'sõiduautojuht'],
  ['veoauto', 'veoautojuht'],
  ['uhissoiduk', 'ühissõidukijuht'],
  ['buss', 'bussijuht'],
  ['maastikusoiduk', 'maastikusõiduki juht'],
  ['kaassoitja', 'kaassõitja'],
  ['alaealine', 'alaealine'],
  ['eakas', 'eakas juht'],
  ['algaja', 'algaja juht'],
  ['turvavarustuseta', 'keegi ei kasutanud turvavööd, kiivrit või helkurit'],
];

const LIIK: Record<string, string> = {
  Kokkupõrge: 'Sõidukite kokkupõrge',
  Ühesõidukiõnnetus: 'Üksiku sõiduki õnnetus',
  Jalakäijaõnnetus: 'Jalakäijaõnnetus',
  'Muu liiklusõnnetus': 'Muu õnnetus',
  '': 'Teadmata',
};

const LIIK_DETAIL: Record<string, string> = {
  'Kokkupõrge jalakäijaga': 'Sõiduk põrkas kokku jalakäijaga',
  'Kokkupõrge sõidukiga küljelt': 'Kokkupõrge küljelt (nt ristmikul)',
  'Sõiduki teelt väljasõit': 'Sõiduk sõitis teelt välja',
  'Sõiduki ümberpaiskumine teel': 'Sõiduk kukkus või paiskus teel ümber',
  'Kokkupõrge vastutuleva sõidukiga': 'Kokkupõrge vastutuleva sõidukiga',
  'Kokkupõrge ees liikuva sõidukiga': 'Tagant otsasõit liikuvale sõidukile',
  'Kokkupõrge ees seisva sõidukiga': 'Tagant otsasõit seisvale sõidukile',
  'Kokkupõrge teevälise takistusega': 'Sõitis vastu takistust tee ääres',
  'Kokkupõrge teel oleva takistusega': 'Sõitis vastu takistust teel',
  'Kukkumine ühissõidukis': 'Kukkumine bussis, trammis või trollis',
  'Kokkupõrge pargitud sõidukiga': 'Sõitis vastu pargitud sõidukit',
  'Sõidukite külgkokkupõrge': 'Sõidukite külgkokkupõrge',
  'Kokkupõrge vähemalt kahe sõiduki vahel': 'Mitme sõiduki kokkupõrge',
  '': 'Teadmata',
};

const ILM: Record<string, string> = {
  'Selged olud': 'Selge',
  'Pilvised olud': 'Pilves',
  Vihmasadu: 'Vihm',
  'Lumised olud': 'Lumi',
  'Madal vastu paistev päike': 'Madal päike',
  'Udused olud': 'Udu',
  'Tuisune või tormine': 'Tuisk või torm',
  'Lörts, rahe': 'Lörts või rahe',
  '': 'Teadmata',
};

const VALG: Record<string, string> = {
  'Valge aeg': 'Valge aeg',
  'Pimeda aeg': 'Pime aeg',
  '': 'Teadmata',
};

export const liikLabel = (v: string) => LIIK[v] ?? v;
export const liikDetailLabel = (v: string) => LIIK_DETAIL[v] ?? v;
export const ilmLabel = (v: string) => ILM[v] ?? v;
export const valgLabel = (v: string) => VALG[v] ?? v;

/** Teekatte seisundi rühmad filtri jaoks */
export type KateGroup = 'kuiv' | 'marg' | 'talv' | 'muu';
export const KATE_GROUPS: { key: KateGroup; label: string }[] = [
  { key: 'kuiv', label: 'Kuiv' },
  { key: 'marg', label: 'Märg' },
  { key: 'talv', label: 'Lumi, jää või lörts' },
  { key: 'muu', label: 'Muu või teadmata' },
];
export function kateGroup(v: string): KateGroup {
  if (v === 'Kuiv') return 'kuiv';
  if (v === 'Märg') return 'marg';
  if (/lumi|jää|jäide|lörts|libedus/i.test(v)) return 'talv';
  return 'muu';
}

const nf = new Intl.NumberFormat('et-EE');
export const fmt = (n: number) => nf.format(n);
export const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

export function plural(n: number, one: string, many: string) {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

export function formatDate(ms: number, hour: number) {
  const d = new Date(ms);
  const base = `${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${DAYS[(d.getUTCDay() + 6) % 7]}`;
  if (hour < 0) return `${base}, kellaaeg teadmata`;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${base}, kell ${hh}:${mm}`;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
