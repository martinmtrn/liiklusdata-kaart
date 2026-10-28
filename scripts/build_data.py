#!/usr/bin/env python3
"""Teisendab Transpordiameti liiklusõnnetuste CSV kaardirakenduse JSON-iks.

Kasutus:
    python3 scripts/build_data.py [sisend.csv] [väljundkaust]

Vaikimisi loetakse ../lo_2011_2026.csv ja kirjutatakse public/data/.
Koordinaadid teisendatakse L-EST97 (EPSG:3301) süsteemist WGS84-ks ilma lisateekideta.
Kui olemas on scripts/asukohavead.json (vt kontrolli_asukohti.mjs), kasutatakse seal loetletud
õnnetuste puhul aadressi või tee kilomeetri järgi leitud parandatud asukohta. Tee km järgi
paigutatud asukoht märgitakse ligikaudseks. Kui parandust pole, jäetakse vale
koordinaat välja: õnnetus jääb statistikasse, aga kaardile mitte.
"""
import csv
import json
import math
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "lo_2011_2026.csv"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "public" / "data"
ERRORS = ROOT / "scripts" / "asukohavead.json"

# --- L-EST97 (Lamberti koonusprojektsioon, GRS80) pöördteisendus ---
A = 6378137.0
F = 1 / 298.257222101
E = math.sqrt(2 * F - F * F)
LAT1, LAT2 = math.radians(59 + 20 / 60), math.radians(58.0)
LAT0 = math.radians(57.51755393055556)
LON0 = math.radians(24.0)
E0, N0 = 500000.0, 6375000.0


def _m(phi):
    return math.cos(phi) / math.sqrt(1 - (E * math.sin(phi)) ** 2)


def _t(phi):
    es = E * math.sin(phi)
    return math.tan(math.pi / 4 - phi / 2) / ((1 - es) / (1 + es)) ** (E / 2)


_N = (math.log(_m(LAT1)) - math.log(_m(LAT2))) / (math.log(_t(LAT1)) - math.log(_t(LAT2)))
_AF = A * _m(LAT1) / (_N * _t(LAT1) ** _N)
_RHO0 = _AF * _t(LAT0) ** _N


def lest_to_wgs(easting, northing):
    dx, dy = easting - E0, _RHO0 - (northing - N0)
    rho = math.copysign(math.hypot(dx, dy), _N)
    t = (rho / _AF) ** (1 / _N)
    lon = math.atan2(dx, dy) / _N + LON0
    phi = math.pi / 2 - 2 * math.atan(t)
    for _ in range(10):
        es = E * math.sin(phi)
        nxt = math.pi / 2 - 2 * math.atan(t * ((1 - es) / (1 + es)) ** (E / 2))
        if abs(nxt - phi) < 1e-12:
            break
        phi = nxt
    return math.degrees(phi), math.degrees(lon)


# --- Osaluse lipud: bitt -> CSV veerg ---
FLAGS = [
    ("jalakaija", "Jalakäija osalusel"),
    ("jalgrattur", "Jalgratturi osalusel"),
    ("kergliikur", "Kergliikurijuhi osalusel"),
    ("mootorrattur", "Mootorratturi osalusel"),
    ("mopeed", "Mopeedijuhi osalusel"),
    ("alaealine", "Alaealise osalusel"),
    ("eakas", "Eaka (65+) mootorsõidukijuhi osalusel"),
    ("algaja", "Esmase juhiloa omaniku osalusel"),
    ("turvavarustuseta", "Turvavarustust mitte kasutanud isiku osalusel"),
    ("buss", "Bussijuhi osalusel"),
    ("veoauto", "Veoautojuhi osalusel"),
    ("uhissoiduk", "Ühissõidukijuhi osalusel"),
    ("soiduauto", "Sõiduautojuhi osalusel"),
    ("maastikusoiduk", "Maastikusõiduki juhi osalusel"),
    ("kaassoitja", "Kaassõitja osalusel"),
    ("mootorsoidukijuht", "Mootorsõidukijuhi osalusel"),
]

# Kategooriaveerud, mis kodeeritakse sõnastiku indeksiks (0 = tühi / teadmata)
CATEGORIES = {
    "liik": "Liiklusõnnetuse liik",
    "liikD": "Liiklusõnnetuse liik (detailne)",
    "mk": "Maakond",
    "ov": "Omavalitsus",
    "ay": "Asustusüksus",
    "teeTyyp": "Tee tüüp",
    "teeEl": "Tee element",
    "valg": "Valgustus",
    "valgD": "Valgustus (detailne)",
    "ilm": "Ilmastik",
    "kate": "Teekate",
    "kateS": "Teekatte seisund",
    "tanav": "Tänav",
    "ristuv": "Ristuv tänav",
}

EMPTY = {"", ".", "Pole teada", "Teadmata", "Teadmine puudub", "LÕ liik teadmata"}
EPOCH = datetime(2011, 1, 1)


def to_int(value, default=0):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def main():
    rows = list(csv.DictReader(SRC.open(encoding="utf-8"), delimiter=";"))
    bad_locations = json.loads(ERRORS.read_text(encoding="utf-8")) if ERRORS.exists() else {}
    removed = 0
    relocated = 0
    relocated_road = 0
    dicts = {k: [""] for k in CATEGORIES}
    index = {k: {"": 0} for k in CATEGORIES}

    def enc(key, value):
        value = (value or "").strip()
        if value in EMPTY:
            value = ""
        idx = index[key].get(value)
        if idx is None:
            idx = index[key][value] = len(dicts[key])
            dicts[key].append(value)
        return idx

    skeemid = {"": 0}
    skeem_list = [["", ""]]

    cols = {k: [] for k in [
        "ts", "lat", "lon", "dead", "inj", "isikuid", "sk", "flags", "asula",
        "kiirus", "skeem", "maja", "teeNr", "teeKm", "ligik", *CATEGORIES.keys(),
    ]}

    rows.sort(key=lambda r: r["Toimumisaeg"])
    for r in rows:
        dt = datetime.strptime(r["Toimumisaeg"][:16], "%Y-%m-%d %H:%M")
        minutes = int((dt - EPOCH).total_seconds() // 60)
        # Kellaaeg 00:00 tähendab enamasti, et kellaaeg on teadmata: märgime negatiivse märgiga
        cols["ts"].append(-minutes - 1 if r["Toimumisaeg"].endswith("00:00:00") else minutes)

        x, y = r["X koordinaat"], r["Y koordinaat"]
        fix = bad_locations.get(r["Juhtumi nr"], {}).get("parandus") if x and y else None
        if x and y and r["Juhtumi nr"] in bad_locations and not fix:
            removed += 1
            x = y = ""
        approx = bool(fix and fix.get("ligikaudne"))
        cols["ligik"].append(1 if approx else 0)
        if approx:
            relocated_road += 1
        elif fix:
            relocated += 1
        if fix:
            cols["lat"].append(round(fix["lat"] * 1e5))
            cols["lon"].append(round(fix["lon"] * 1e5))
        elif x and y:
            # Andmestikus on X põhjakoordinaat ja Y idakoordinaat
            lat, lon = lest_to_wgs(float(y), float(x))
            cols["lat"].append(round(lat * 1e5))
            cols["lon"].append(round(lon * 1e5))
        else:
            cols["lat"].append(0)
            cols["lon"].append(0)

        cols["dead"].append(to_int(r["Hukkunuid"]))
        cols["inj"].append(to_int(r["Vigastatuid"]))
        cols["isikuid"].append(to_int(r["Isikuid"]))
        cols["sk"].append(to_int(r["Sõidukeid"]))
        bits = 0
        for i, (_, col) in enumerate(FLAGS):
            if r[col] == "1":
                bits |= 1 << i
        cols["flags"].append(bits)
        cols["asula"].append({"JAH": 1, "EI": 2}.get(r["Asula"], 0))
        speed = to_int(r["Lubatud sõidukiirus"])
        cols["kiirus"].append(speed if 0 < speed <= 130 else 0)

        key = r["Tüüpskeemi nr"].strip()
        if key not in skeemid:
            skeemid[key] = len(skeem_list)
            skeem_list.append([key, r["Tüüpskeem"].strip()])
        cols["skeem"].append(skeemid[key])

        cols["maja"].append(r["Maja nr"].strip())
        cols["teeNr"].append(r["Tee nr"].strip())
        km = r["Tee km"].strip()
        cols["teeKm"].append(round(float(km), 2) if km else None)

        for key, col in CATEGORIES.items():
            cols[key].append(enc(key, r[col]))

    dicts["skeem"] = skeem_list
    data = {
        "n": len(rows),
        "uuendatud": rows[-1]["Toimumisaeg"][:10],
        "valeAsukoht": removed,
        "parandatudAsukoht": relocated,
        "teeKmAsukoht": relocated_road,
        "flags": [k for k, _ in FLAGS],
        "dict": dicts,
        "cols": cols,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / "onnetused.json"
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    with_coords = sum(1 for v in cols["lat"] if v)
    lats = [v / 1e5 for v in cols["lat"] if v]
    lons = [v / 1e5 for v in cols["lon"] if v]
    print(f"Õnnetusi: {len(rows)}, koordinaatidega: {with_coords}, vale asukoha tõttu kaardilt eemaldatud: {removed}, aadressi järgi parandatud: {relocated}, tee km järgi ligikaudu paigutatud: {relocated_road}")
    print(f"Laius {min(lats):.3f}..{max(lats):.3f}, pikkus {min(lons):.3f}..{max(lons):.3f}")
    print(f"Hukkunuid: {sum(cols['dead'])}, vigastatuid: {sum(cols['inj'])}")
    print(f"Andmed kuni: {data['uuendatud']}")
    print(f"Kirjutatud: {out} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
