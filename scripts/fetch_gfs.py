"""Robô de dados: baixa a última rodada do GFS (NOAA, 0,25°) para a região
configurada e grava arquivos JSON por hora, prontos para o site.

Fonte: NOAA GFS no Registry of Open Data da AWS (gratuito, sem limite de uso,
domínio público). Só os campos e o recorte necessários são baixados, usando
o índice (.idx) de cada arquivo GRIB2 e requisições por faixa de bytes.

Uso:  python scripts/fetch_gfs.py --out _site/data/gfs [--max-hours N]
"""

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import math
import os
import re
import sys
import tempfile
import time

import numpy as np
import requests
import eccodes

BUCKET = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"

# Espírito Santo + Minas Gerais, com margem
REGION = {"south": -23.5, "north": -13.5, "west": -51.5, "east": -38.75}
STEP = 0.25

# Horas do dia (horário de Brasília, UTC−3) que interessam ao voo livre
LOCAL_HOURS = range(6, 21)
UTC_OFFSET = -3
MAX_FORECAST = 168  # 7 dias

LEVELS_TZ = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500]
LEVELS_WIND = [975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300]
LEVELS_Z_EXTRA = [400, 300]
LEVELS_RH = [925, 850, 700]

# (nome no site, padrão no .idx, tipo) — tipo: inst | ave (média desde o reinício
# da janela de 6 h) | acc (acumulado desde o reinício; o 1º APCP do índice é essa janela)
FIELDS = [
    ("temperature_2m", r"^TMP:2 m above ground:\d+ hour fcst", "inst"),
    ("dew_point_2m", r"^DPT:2 m above ground:\d+ hour fcst", "inst"),
    ("sensible_heat_flux", r"^SHTFL:surface:\d+-\d+ hour ave fcst", "ave"),
    ("precipitation", r"^APCP:surface:\d+-\d+ hour acc fcst", "acc"),
    ("cape", r"^CAPE:surface:\d+ hour fcst", "inst"),
    ("cloud_cover", r"^TCDC:entire atmosphere:\d+ hour fcst", "inst"),
    ("cloud_cover_low", r"^LCDC:low cloud layer:\d+ hour fcst", "inst"),
    ("cloud_cover_mid", r"^MCDC:middle cloud layer:\d+ hour fcst", "inst"),
    ("cloud_cover_high", r"^HCDC:high cloud layer:\d+ hour fcst", "inst"),
    ("pressure_msl", r"^PRMSL:mean sea level:\d+ hour fcst", "inst"),
    ("total_column_integrated_water_vapour", r"^PWAT:entire atmosphere \(considered as a single layer\):\d+ hour fcst", "inst"),
    ("u_10m", r"^UGRD:10 m above ground:\d+ hour fcst", "inst"),
    ("v_10m", r"^VGRD:10 m above ground:\d+ hour fcst", "inst"),
]
for p in LEVELS_TZ:
    FIELDS.append((f"temperature_{p}hPa", rf"^TMP:{p} mb:\d+ hour fcst", "inst"))
    FIELDS.append((f"geopotential_height_{p}hPa", rf"^HGT:{p} mb:\d+ hour fcst", "inst"))
for p in LEVELS_Z_EXTRA:
    FIELDS.append((f"geopotential_height_{p}hPa", rf"^HGT:{p} mb:\d+ hour fcst", "inst"))
for p in LEVELS_WIND:
    FIELDS.append((f"u_{p}hPa", rf"^UGRD:{p} mb:\d+ hour fcst", "inst"))
    FIELDS.append((f"v_{p}hPa", rf"^VGRD:{p} mb:\d+ hour fcst", "inst"))
for p in LEVELS_RH:
    FIELDS.append((f"relative_humidity_{p}hPa", rf"^RH:{p} mb:\d+ hour fcst", "inst"))

DIGITS = {"temperature": 1, "dew_point": 1, "precipitation": 2, "total_column": 1, "pressure_msl": 1, "wind_speed": 1}

session = requests.Session()


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def get(url, headers=None, tries=5):
    for i in range(tries):
        try:
            r = session.get(url, headers=headers, timeout=60)
            if r.status_code in (200, 206):
                return r
            if r.status_code == 404:
                return None
        except requests.RequestException as e:
            log("erro de rede", e)
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"falha ao baixar {url}")


def file_url(run, fh):
    d = run.strftime("%Y%m%d")
    c = run.strftime("%H")
    return f"{BUCKET}/gfs.{d}/{c}/atmos/gfs.t{c}z.pgrb2.0p25.f{fh:03d}"


def latest_run():
    """Rodada mais recente que já tem o último horário necessário publicado."""
    now = dt.datetime.now(dt.timezone.utc)
    base = now.replace(minute=0, second=0, microsecond=0, hour=now.hour - now.hour % 6)
    for k in range(0, 8):
        run = base - dt.timedelta(hours=6 * k)
        if get(file_url(run, MAX_FORECAST) + ".idx", tries=2) is not None:
            return run
    raise RuntimeError("nenhuma rodada completa encontrada")


def forecast_hours(run):
    """Horas de previsão cujo horário local cai no período de voo."""
    out = []
    for fh in range(1, MAX_FORECAST + 1):
        if fh > 120 and fh % 3:
            continue  # após 120 h o GFS é trihorário
        local = run + dt.timedelta(hours=fh + UTC_OFFSET)
        if local.hour in LOCAL_HOURS:
            out.append(fh)
    return out


def prev_hour(fh):
    return fh - 1 if fh <= 120 else fh - 3


def parse_idx(text):
    lines = [l for l in text.strip().split("\n") if l]
    recs = []
    for i, l in enumerate(lines):
        parts = l.split(":")
        start = int(parts[1])
        end = int(lines[i + 1].split(":")[1]) - 1 if i + 1 < len(lines) else None
        recs.append({"start": start, "end": end, "desc": ":".join(parts[3:])})
    return recs


def select(recs, fields):
    """Para cada campo, o primeiro registro do índice que casa com o padrão."""
    chosen = []
    for name, pat, kind in fields:
        rx = re.compile(pat)
        rec = next((r for r in recs if rx.match(r["desc"])), None)
        if rec is None:
            log("  aviso: campo ausente", name)
            continue
        chosen.append((name, kind, rec))
    return chosen


def window(desc):
    m = re.search(r":(\d+)-(\d+) hour (ave|acc)", desc)
    return (int(m.group(1)), int(m.group(2))) if m else None


# Recorte da grade global (0,25°, latitudes 90→−90, longitudes 0→359,75)
LATS = np.arange(REGION["south"], REGION["north"] + 1e-6, STEP)
LONS = np.arange(REGION["west"], REGION["east"] + 1e-6, STEP)
I_IDX = np.round((90 - LATS) / 0.25).astype(int)
J_IDX = np.round((LONS % 360) / 0.25).astype(int)


def download_fields(run, fh, fields):
    """Baixa e decodifica os campos pedidos de um horário. Retorna {nome: (array, desc)}."""
    idx = get(file_url(run, fh) + ".idx")
    if idx is None:
        raise RuntimeError(f"índice ausente f{fh:03d}")
    chosen = select(parse_idx(idx.text), fields)
    chosen.sort(key=lambda c: c[2]["start"])
    # Junta registros contíguos numa só requisição
    groups = []
    for c in chosen:
        if groups and groups[-1][-1][2]["end"] is not None and groups[-1][-1][2]["end"] + 1 == c[2]["start"]:
            groups[-1].append(c)
        else:
            groups.append([c])
    out = {}
    url = file_url(run, fh)
    for g in groups:
        a = g[0][2]["start"]
        b = g[-1][2]["end"]
        rng = f"bytes={a}-{b if b is not None else ''}"
        data = get(url, headers={"Range": rng}).content
        with tempfile.NamedTemporaryFile(suffix=".grib2") as tmp:
            tmp.write(data)
            tmp.flush()
            with open(tmp.name, "rb") as f:
                for name, kind, rec in g:
                    gid = eccodes.codes_grib_new_from_file(f)
                    if gid is None:
                        raise RuntimeError(f"GRIB truncado em {name} f{fh:03d}")
                    try:
                        nj = eccodes.codes_get(gid, "Nj")
                        ni = eccodes.codes_get(gid, "Ni")
                        vals = eccodes.codes_get_values(gid).reshape(nj, ni)
                    finally:
                        eccodes.codes_release(gid)
                    out[name] = (vals[np.ix_(I_IDX, J_IDX)].astype(np.float64), rec["desc"])
    return out


def deaverage(cur, prev, kind):
    """Converte média/acumulado desde o reinício da janela no valor do último intervalo
    (precipitação em mm/h)."""
    a, desc = cur
    w = window(desc)
    pw = window(prev[1]) if prev is not None else None
    same_window = pw is not None and pw[0] == w[0] and pw[1] < w[1]
    if kind == "acc":
        if same_window:
            return np.maximum(0, (a - prev[0]) / (w[1] - pw[1]))
        return np.maximum(0, a / max(1, w[1] - w[0]))
    if same_window:
        return (a * (w[1] - w[0]) - prev[0] * (pw[1] - pw[0])) / (w[1] - pw[1])
    return a  # primeiro intervalo da janela: a média já é do intervalo


def speed_dir(u, v):
    ws = np.hypot(u, v) * 3.6
    wd = (np.degrees(np.arctan2(-u, -v)) + 360) % 360
    return ws, wd


def to_list(name, arr):
    d = next((v for k, v in DIGITS.items() if name.startswith(k)), 0)
    a = np.round(arr, d)
    out = []
    for x in a.ravel():
        if not math.isfinite(x):
            out.append(None)
        elif d == 0:
            out.append(int(x))
        else:
            out.append(float(x))
    return out


def process_hour(run, fh, outdir):
    data = download_fields(run, fh, FIELDS)
    special = [f for f in FIELDS if f[2] != "inst"]
    pf = prev_hour(fh)
    prev = download_fields(run, pf, special) if pf >= 1 else {}
    res = {}
    for name, _, kind in FIELDS:
        if name not in data:
            continue
        if kind == "inst":
            arr = data[name][0]
        else:
            arr = deaverage(data[name], prev.get(name), kind)
        if name.startswith("temperature") or name.startswith("dew_point"):
            arr = arr - 273.15
        elif name == "pressure_msl":
            arr = arr / 100
        res[name] = arr
    # Vento: u/v → velocidade (km/h) e direção (de onde vem)
    for key in [k for k in list(res) if k.startswith("u_")]:
        suf = key[2:]
        if f"v_{suf}" not in res:
            continue
        ws, wd = speed_dir(res.pop(key), res.pop(f"v_{suf}"))
        res[f"wind_speed_{suf}"] = ws
        res[f"wind_direction_{suf}"] = wd
    local = run + dt.timedelta(hours=fh + UTC_OFFSET)
    stamp = local.strftime("%Y-%m-%dT%H:00")
    fname = local.strftime("%Y%m%d%H") + ".json"
    with open(os.path.join(outdir, "h", fname), "w") as f:
        json.dump({k: to_list(k, v) for k, v in res.items()}, f, separators=(",", ":"))
    return stamp, fname


def terrain(run):
    data = download_fields(run, 1, [("elev", r"^HGT:surface:\d+ hour fcst", "inst")])
    return data["elev"][0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="_site/data/gfs")
    ap.add_argument("--max-hours", type=int, default=0, help="limita a quantidade de horários (teste)")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    os.makedirs(os.path.join(args.out, "h"), exist_ok=True)
    run = latest_run()
    hours = forecast_hours(run)
    if args.max_hours:
        hours = hours[: args.max_hours]
    log(f"rodada {run:%Y-%m-%d %HZ}: {len(hours)} horários, grade {len(LATS)}x{len(LONS)}")

    elev = terrain(run)
    results = {}
    with cf.ThreadPoolExecutor(args.workers) as ex:
        futs = {ex.submit(process_hour, run, fh, args.out): fh for fh in hours}
        for fut in cf.as_completed(futs):
            fh = futs[fut]
            try:
                results[fh] = fut.result()
                log(f"  f{fh:03d} ok")
            except Exception as e:  # um horário ruim não derruba a rodada
                log(f"  f{fh:03d} FALHOU: {e}")

    if len(results) < max(1, len(hours) // 2):
        log("muitos horários falharam; abortando")
        sys.exit(1)

    ordered = [results[fh] for fh in sorted(results)]
    meta = {
        "model": "gfs",
        "source": "NOAA GFS 0.25° (AWS Open Data)",
        "run": run.strftime("%Y-%m-%dT%H:00Z"),
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "grid": {"lat0": float(LATS[0]), "lon0": float(LONS[0]), "step": STEP, "nx": len(LONS), "ny": len(LATS)},
        "levels": LEVELS_TZ,
        "times": [o[0] for o in ordered],
        "files": [o[1] for o in ordered],
        "elev": to_list("elev", elev),
    }
    with open(os.path.join(args.out, "meta.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    log(f"pronto: {len(ordered)} horários gravados em {args.out}")


if __name__ == "__main__":
    main()
