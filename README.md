# Liiklusõnnetuste kaart

Staatiline veebirakendus, mis näitab Eesti inimkannatanutega liiklusõnnetusi (2011-2026) kaardil. Sihtrühm on laiem avalikkus.

Idee: [Martin Meitern](https://www.linkedin.com/in/martin-meitern/). Teostus: Claude.

## Vaated

- **Kaart:** punktid raskusastme järgi, klastrid ja tiheduskaart. Aluskaardiks on Maa- ja Ruumiameti hall kaart, värviline kaart või aerofoto. Punktil klõpsates avaneb õnnetuse kirjeldus.
- **Ülevaade:** filtrid ja statistika samal lehel.
  - Filtrid (aeg, haldusüksus, raskusaste, õnnetuse liik, liikleja, osaleja tunnused ja valgustus) on ülaosas lahtiklapitavas plokis. Kinnisena näitab plokk aktiivsete filtrite arvu. Sama filtriplokk on näha ka vahelehtedel "Minu ümbrus" ja "Minu teekond", Info vahelehel on see peidus.
  - Statistika:
    - põhinäitajad;
    - aastate graafik;
    - nädalapäeva ja kellaaja soojustabel;
    - jaotused õnnetuse liigi, liiklejate ja osaleja tunnuste järgi;
    - statistikat saab piirata kaardil nähtava alaga;
    - haldusüksuse valimisel jäävad välja asukohata õnnetused (eriti 2011. aastal). Statistika juures on selle kohta märkus ja puudulike aastate tulbad on heledamad.
- **Minu ümbrus:**
  - koha saab valida aadressiotsinguga (In-ADS), kaardilt või oma asukoha järgi;
  - raadius on 250 m, 500 m või 1 km;
  - kuvatakse kokkuvõte tavakeeles, viimaste aastate trend, võrdlus omavalitsusega ja viimased õnnetused.
- **Minu teekond:**
  - algus ja sihtkoht aadressiotsingu, kaardi või oma asukoha järgi; suunda saab vahetada;
  - teekonda saab täpsustada kuni 10 vahepunktiga: klõps teekonna joonel või nupp "Lisa vahepunkt kaardilt" lisab punkti, mis läheb järjekorda selle järgi, kuhu ta teekonnal jääb. A, B ja vahepunktid on kaardil lohistatavad ning vahepunkti saab paneelist eemaldada. Vahepunkti tähis liigub kohta, kuhu marsruutija selle teele paigutas;
  - liikumisviis auto, jalgratas või jalgsi. Teekonna arvutab FOSSGIS-e avalik OpenStreetMapi marsruutija (`routing.openstreetmap.de`), API-võtit pole vaja;
  - arvesse lähevad filtritele vastavad õnnetused, mis on teekonna joonest kuni 35 m kaugusel (konstant `WIDTH` failis `src/route.ts`);
  - kuvatakse kokkuvõte, õnnetuste jaotus teekonna pikkuses (tulbal klõpsates suumib kaart sellele lõigule), kolm kõige õnnetusterohkemat lõiku, õnnetuse liigid ja viimased õnnetused;
  - selle vahelehe ajal näitab kaart ainult teekonna õnnetusi;
  - sild või viadukt võib tuua hulka ka all oleva tee õnnetused, sest sobivus leitakse ainult kauguse järgi.
- **Eraldi statistikaleht (`statistika.html`):** filtrid ja statistika kõrvuti, ilma kaardita. Filtrid on vasakul kogu aeg näha ja statistika uueneb iga valiku peale. Lisaks kaardipaneeli statistikale on siin kuu soojustabel, mille veergudeks saab valida kellaaja või nädalapäeva, ning jaotus maakonna järgi. Kitsal ekraanil on filtrid statistika kohal lahtiklapitavas plokis.
- **Info:** andmete allikas, kuidas kaarti lugeda ja andmete piirangud.

## Filtrid lingi aadressis

Valitud filtrid kirjutatakse lehe aadressi, nii et lingi saab jagada ja see avab samad filtrid. Kaardi ja statistikalehe vahelised lingid võtavad filtrid kaasa. Vaikeväärtusi aadressi ei kirjutata.

| Parameeter | Näide | Tähendus |
| --- | --- | --- |
| `aastad` | `2018-2022` või `2020` | aastavahemik |
| `kuu` | `11,12` | kuud (1 = jaanuar) |
| `paev` | `6,7` | nädalapäevad (1 = esmaspäev) |
| `kell` | `7-9` | kellaaeg alates-kuni |
| `raskus` | `hukkunuga`, `vigastatuga` | raskusaste |
| `liik` | `Jalakäijaõnnetus` | õnnetuse liik (võib korduda) |
| `liikleja` | `jalakaija,mootorratas` | liikleja: `jalakaija`, `jalgrattur`, `kergliikur`, `mootorratas` (koos mopeediga), `soiduauto`, `veoauto`, `uhissoiduk`, `maastikusoiduk` |
| `liikleja-koos` | `1` | liiklejatest ainult õnnetused, kus osalesid kõik valitud (JA) |
| `tunnus` | `alaealine,turvavarustuseta` | osaleja tunnus: `alaealine`, `eakas`, `algaja`, `turvavarustuseta` |
| `tunnus-koos` | `1` | tunnustest ainult õnnetused, kus esinesid kõik valitud (JA) |
| `valgus` | `Pimeda aeg` | valgustus (võib korduda) |
| `maakond` | `Tartu maakond` | maakond |
| `omavalitsus` | `Tartu linn` | omavalitsus |
| `koht` | `59.43858,24.72779` | "Minu ümbruse" koht (laius,pikkus); avab vahelehe "Minu ümbrus" |
| `raadius` | `250` või `1000` | "Minu ümbruse" raadius meetrites (vaikimisi 500) |
| `aadress` | `Telliskivi tn 60a, Põhja-Tallinna linnaosa, Tallinn` | "Minu ümbruse" koha nimi |
| `teekond` | `59.43858,24.72779;59.43872,24.77161` | teekonna punktid (laius,pikkus): algus, vahepunktid ja sihtkoht; avab vahelehe "Minu teekond" |
| `liikumine` | `ratas` või `jalgsi` | teekonna liikumisviis (vaikimisi auto) |
| `algus`, `siht` | `Telliskivi tn 60a, Põhja-Tallinna linnaosa, Tallinn` | alguse ja sihtkoha nimi teekonna väljadel |

Koha ja teekonna parameetrid on aadressis ainult siis, kui vastav vaheleht ("Minu ümbrus" või "Minu teekond") on avatud ja koht või teekond on valitud. Kui lingis on mõlemad, avatakse teekond. Kaardilt valitud või oma asukoha punktil nime lingis ei ole, saaja näeb seal "Lingiga jagatud koht". Lingist loetakse ainult Eesti piiresse jäävad punktid.

Liik, valgustus, maakond ja omavalitsus on aadressis nimega, mitte järjekorranumbriga, et lingid jääksid kehtima ka pärast andmete uuendamist. Tundmatud väärtused jäetakse vahele. Vana parameeter `osalised` loetakse veel sisse ja kirjutatakse ümber uuele kujule.

## Liiklejad ja osaleja tunnused

Lähteandmetes on osalus õnnetuse, mitte isiku tasemel: iga veerg ütleb ainult, kas õnnetuses osales vähemalt üks selline isik. Seepärast on filtris kaks rühma:

- **Liikleja** (vaikimisi rühma sees VÕI): mis liiki liiklejad õnnetuses osalesid. Mootorrattur ja mopeedijuht (sh pisimopeed) on koos. Kergliikureid eristatakse alates 2021. aastast, varem on tasakaaluliikurid jalakäijate all.
- **Osaleja tunnused** (vaikimisi rühma sees VÕI): alla 18-aastane, 65+ mootorsõidukijuht, esmase juhiloaga juht või keegi, kes ei kasutanud turvavööd, kiivrit või helkurit. Andmetest ei selgu, kelle tunnus see oli.

Mõlemas rühmas on lüliti "Vähemalt üks" või "Kõik koos". Kahe või enama valiku korral näitab see mõlema variandi õnnetuste arvu, nii et summa ja ühised õnnetused on näha korraga. Rühmade vahel kehtib alati JA. Õnnetuse hüpikaknas on osalised detailsemalt, näiteks mopeedijuht ja mootorrattur eraldi.

## Käivitamine

```bash
npm install
npm run dev
```

## Andmete uuendamine

Laadi avaandmete portaalist uus CSV-fail ja käivita kaks käsku:

```bash
node scripts/kontrolli_asukohti.mjs /tee/uue/lo_2011_XXXX.csv
```

```bash
python3 -I scripts/build_data.py /tee/uue/lo_2011_XXXX.csv
```

Esimene käsk otsib ilmselgelt valed asukohad ja kirjutab need faili `scripts/asukohavead.json`. Teine käsk jätab need õnnetused kaardilt välja, aga statistikasse jäävad need alles. Valeks loetakse asukoht, kui:

- sama koordinaat on kasutusel vähemalt kolme eri omavalitsuse õnnetuse juures, ehk see on asendusväärtus;
- punkt on Maa- ja Ruumiameti aluskaardi järgi vähemalt 100 m veekogu sees;
- punkt on oma asula ülejäänud õnnetustest üle 15 km kaugusel;
- õnnetusel on tee number ja ümardatud kilomeeter, aga punkt on sellest kohast üle 1,5 km eemal. Nii on eriti 2026. aasta andmetes, kus maanteeõnnetuse koordinaadiks on sageli märgitud asula keskpunkt. Oodatud koht arvutatakse Transpordiameti teeregistri tee joonelt (avalik WFS-teenus `teeregister.mnt.ee`, kiht `teeosa`). Kui teed registris pole, leitakse koht sama tee teiste õnnetuste täpsete kilomeetrite vahelt interpoleerides (naaberpunktid kuni 4 km vahega). Punkti ei liigutata, kui see on teeregistri järgi sama tee peal, sest siis on tõenäoliselt vale km (tee on ümber mõõdetud). Samuti ei liigutata murdosaga koordinaate, sest asula keskpunktid on andmetes alati täismeetrites.

Kui vale asukohaga õnnetusel on andmetes tänav ja maja number, otsib skript õige asukoha Maa- ja Ruumiameti aadressiotsingust (In-ADS). Parandus võetakse kasutusele ainult siis, kui aadress leitakse täpselt, maja number klapib ja omavalitsus on sama.

Kui tee kilomeeter ei klapi, paigutatakse õnnetus tee kilomeetri järgi arvutatud kohta. Kaardil on see õõnsa ringina ja popupis on märge, et asukoht on ligikaudne (umbes 500 m täpsusega). Asustusüksust popupis ei näidata, sest see on andmetes tuletatud valest koordinaadist. Kui interpoleerimiseks viidet pole, aga sama koordinaat on kasutusel sama tee eri kilomeetritel, jäetakse punkt kaardilt välja.

Kontroll laadib umbes 2700 kaarditailli ja umbes 300 tee joont teeregistrist ning salvestab need kausta `.cache/`, nii et kordusel see enam kaua ei võta.

- Vaikimisi loetakse fail `../lo_2011_2026.csv` ja tulemus kirjutatakse faili `public/data/onnetused.json`.
- Skript teisendab koordinaadid L-EST97 süsteemist WGS84-ks. Lisateeke selleks vaja ei ole.
- Rakendus loeb andmete seisu kuupäeva ja poolikut aastat andmetest ise.

## Avaldamine

```bash
npm run build
```

Kaust `dist/` on täielikult staatiline: `base: './'` lubab selle panna mis tahes alamkausta.

Rakendus on avalikult üleval Vercelis aadressil https://liiklusonnetuste-kaart.vercel.app (projekt `liiklusonnetuste-kaart`). Uue versiooni avaldamiseks:

```bash
npx vercel deploy --prod
```

Vercel ehitab rakenduse ise (`npm run build`). Kaust `.cache` ja `.env*` failid jäetakse `.vercelignore` abil üles laadimata.

Turvapäised (Content-Security-Policy, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) on failis `vercel.json`. `npm run preview` saadab samu päiseid, nii et nende mõju saab enne avaldamist kohalikult kontrollida. Uue välisteenuse lisamisel tuleb selle aadress lisada CSP `connect-src` (või piltide puhul `img-src`) loendisse, muidu brauser blokeerib päringu. Ilma `--prod`-ita tehtud üleslaadimine annab eraldi eelvaate lingi ja avalik versioon jääb samaks.

## Tehniline

- Vite + TypeScript, ilma raamistikuta.
- Kaardiks MapLibre GL 6, graafikuteks Chart.js.
- MapLibre worker kopeeritakse muutmata kujul `dist/` kausta (vt `vite.config.ts`), sest Vite muidu rikub selle ära.
- Filtreerimine toimub brauseris: umbes 24 000 rida, andmefail on gzip-pakituna umbes 0,6 MB.
- Välised teenused:
  - Maa- ja Ruumiameti kaarditaillid ja In-ADS aadressiotsing;
  - FOSSGIS-e OpenStreetMapi marsruutija (teekonna vaade);
  - Verceli veebianalüütika (`@vercel/analytics`, küpsisteta). Enne saatmist eemaldatakse aadressist asukohaga parameetrid (`koht`, `aadress`, `teekond`, `algus`, `siht`), vt `src/analytics.ts`. Analüütika peab olema Verceli projekti seadetes sisse lülitatud;
  - Transpordiameti teeregistri WFS (ainult andmete ettevalmistamisel);
  - OpenFreeMapi fondid klastrite numbrite jaoks.
