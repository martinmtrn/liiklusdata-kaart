// Verceli veebianalüütika: küpsisteta külastuste loendus.

import { inject } from '@vercel/analytics';

// Need parameetrid võivad sisaldada kasutaja kodu või teekonna asukohta, seega analüütikasse neid ei saadeta.
// Ka kaardi vaade (#kaart=suum/laius/pikkus) jäetakse ära, sest koha valimise järel näitab see sama kohta.
// Statistikalehe lingid on referrerpolicy="origin", et kaardilehe aadress ei jõuaks sinna viitajana (index.html).
const PRIVATE_PARAMS = ['koht', 'aadress', 'teekond', 'algus', 'siht'];

export function startAnalytics() {
  inject({
    beforeSend(event) {
      const url = new URL(event.url);
      for (const p of PRIVATE_PARAMS) url.searchParams.delete(p);
      url.hash = '';
      return { ...event, url: url.toString() };
    },
  });
}
