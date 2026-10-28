// Aadressiotsingu väli (Maa- ja Ruumiameti In-ADS), mida kasutavad "Minu ümbrus" ja "Minu teekond".

import { escapeHtml } from './labels';

const INADS = 'https://inaadress.maaamet.ee/inaadress/gazetteer';

export interface Place {
  label: string;
  lngLat: [number, number];
  ov?: string;
}

// Üldised sildid, mida lingis ei hoita, sest saajale ei ütle need midagi
const GENERIC_LABELS = new Set(['Kaardilt valitud koht', 'Minu asukoht']);
export const SHARED_LABEL = 'Lingiga jagatud koht';
// Eesti piirid koos varuga: lingist loetud punktid peavad jääma nende sisse
const BOUNDS = { w: 21, e: 28.5, s: 57.3, n: 59.9 };

/** Punkt lingi jaoks kujul "laius,pikkus" */
export const pointToUrl = ([lon, lat]: [number, number]) => `${lat.toFixed(5)},${lon.toFixed(5)}`;

/** Loeb lingist punkti "laius,pikkus"; null, kui see on vigane või väljaspool Eestit */
export function pointFromUrl(text: string): [number, number] | null {
  const [lat, lon] = text.split(',').map(Number);
  return lat >= BOUNDS.s && lat <= BOUNDS.n && lon >= BOUNDS.w && lon <= BOUNDS.e ? [lon, lat] : null;
}

/** Koha nimi lingi jaoks: üldist silti ei hoita ja maakond jäetakse ära, et link oleks lühem */
export const labelToUrl = (p: Place) =>
  GENERIC_LABELS.has(p.label) || p.label === SHARED_LABEL ? '' : p.label.replace(/, [^,]+ maakond$/, '');

/** Lingist loetud koha nimi (pikkus piiratud) või üldine silt */
export const labelFromUrl = (text: string | null) => text?.slice(0, 200) || SHARED_LABEL;

interface InadsAddress {
  ipikkaadress: string;
  viitepunkt_l: string;
  viitepunkt_b: string;
  omavalitsus: string;
}

/** Seob sisendvälja ja tulemuste loendi aadressiotsinguga. Valik antakse edasi funktsioonile onChoose. */
export function addressCombo(
  input: HTMLInputElement,
  list: HTMLUListElement,
  onChoose: (p: Place) => void,
  setStatus: (msg: string) => void,
) {
  let searchTimer = 0;
  let searchSeq = 0;
  let results: Place[] = [];
  let active = -1;
  const optId = (k: number) => `${list.id}-opt-${k}`;

  function closeList() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function renderList() {
    list.innerHTML = results
      .map((r, k) => `<li role="option" id="${optId(k)}" aria-selected="${k === active}">${escapeHtml(r.label)}</li>`)
      .join('');
    list.hidden = results.length === 0;
    input.setAttribute('aria-expanded', String(!list.hidden));
    if (active >= 0) input.setAttribute('aria-activedescendant', optId(active));
    else input.removeAttribute('aria-activedescendant');
  }

  async function search(q: string) {
    const seq = ++searchSeq;
    try {
      const url = `${INADS}?address=${encodeURIComponent(q)}&results=6`;
      const res = await fetch(url);
      const json = (await res.json()) as { addresses?: InadsAddress[] };
      if (seq !== searchSeq) return;
      results = (json.addresses ?? [])
        .filter((a) => a.viitepunkt_l && a.viitepunkt_b)
        .map((a) => ({ label: a.ipikkaadress, lngLat: [Number(a.viitepunkt_l), Number(a.viitepunkt_b)], ov: a.omavalitsus }));
      active = -1;
      renderList();
      if (!results.length) setStatus('Aadressi ei leitud. Proovi kirjutada tänav ja maja number.');
      else setStatus('');
    } catch {
      if (seq === searchSeq) setStatus('Aadressiotsing ei vasta. Vali koht kaardilt.');
    }
  }

  function choose(p: Place) {
    input.value = p.label;
    closeList();
    onChoose(p);
  }

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 3) {
      results = [];
      renderList();
      return;
    }
    searchTimer = window.setTimeout(() => search(q), 280);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && results.length) {
      active = (active + 1) % results.length;
      renderList();
      e.preventDefault();
    } else if (e.key === 'ArrowUp' && results.length) {
      active = (active - 1 + results.length) % results.length;
      renderList();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (results.length) choose(results[Math.max(active, 0)]);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      closeList();
    }
  });
  input.addEventListener('blur', () => setTimeout(closeList, 150));
  list.addEventListener('mousedown', (e) => {
    const li = (e.target as HTMLElement).closest('li');
    if (!li) return;
    e.preventDefault();
    choose(results[[...list.children].indexOf(li)]);
  });
}
