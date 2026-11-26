"""Convert the Big Data Bowl CSVs into compact files for the play viewer website.

Run once after download_data.py:

    python build_web_data.py            # all 9 weeks
    python build_web_data.py --weeks 1  # just week 1 (quick test)

Writes, under web/data/ (git-ignored, since the data is Kaggle-licensed):
    index.json.gz                     every play with tracking: game, situation, description
    plays/<gameId>/<playId>.json.gz   frame-by-frame positions for one play

Coordinates are kept raw (as recorded); the website can flip plays so the offense
always moves right.
"""

import argparse
import gzip
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from load_data import get_data_dir, load_tables

OUT_DIR = Path(__file__).resolve().parent / "web" / "data"
SOURCE = "2022 NFL season · weeks 1–9"
TRACKING_COLS = [
    "gameId", "playId", "nflId", "displayName", "frameId", "frameType",
    "jerseyNumber", "club", "playDirection", "x", "y", "s", "o", "event",
]


def clean(v):
    """Make a pandas/numpy scalar JSON-safe (NaN -> None, numpy -> python)."""
    if v is None:
        return None
    if isinstance(v, (float, np.floating)):
        return None if math.isnan(v) else round(float(v), 3)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if v is pd.NA or v is pd.NaT:
        return None
    return v


def col(row, name):
    return clean(row[name]) if name in row.index else None


def write_gz(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(obj, separators=(",", ":")).encode()
    path.write_bytes(gzip.compress(data, compresslevel=6))


def to_grid(values, ent_idx, frame_idx, n_ent, n_frames, scale):
    """Scatter one column into an (entity, frame) grid of ints; missing -> None."""
    grid = np.full((n_ent, n_frames), np.nan)
    grid[ent_idx, frame_idx] = values
    if np.isnan(grid).any():
        return [[None if math.isnan(v) else int(round(v * scale)) for v in row] for row in grid]
    return np.rint(grid * scale).astype(np.int32).tolist()


def build_play(df: pd.DataFrame, positions: dict) -> dict:
    df = df.sort_values(["frameId"])
    f0 = int(df["frameId"].min())
    n_frames = int(df["frameId"].max()) - f0 + 1
    frame_idx = (df["frameId"].to_numpy() - f0).astype(int)

    is_ball = df["nflId"].isna().to_numpy()
    ent_key = np.where(is_ball, -1, df["nflId"].fillna(-1).to_numpy()).astype(np.int64)
    keys, ent_idx = np.unique(ent_key, return_inverse=True)

    first = df.groupby(ent_key, sort=True).first()
    entities = []
    for key in keys:
        r = first.loc[key]
        if key == -1:
            entities.append({"id": None, "name": "Football", "jersey": None, "club": "football", "pos": None})
        else:
            jersey = clean(r["jerseyNumber"])
            entities.append({
                "id": int(key),
                "name": clean(r["displayName"]),
                "jersey": int(jersey) if jersey is not None else None,
                "club": clean(r["club"]),
                "pos": positions.get(int(key)),
            })

    n_ent = len(keys)
    grids = {
        "x": to_grid(df["x"].to_numpy(float), ent_idx, frame_idx, n_ent, n_frames, 100),
        "y": to_grid(df["y"].to_numpy(float), ent_idx, frame_idx, n_ent, n_frames, 100),
        "s": to_grid(df["s"].to_numpy(float), ent_idx, frame_idx, n_ent, n_frames, 100),
        "o": to_grid(df["o"].fillna(0).to_numpy(float), ent_idx, frame_idx, n_ent, n_frames, 1),
    }

    ev = df.loc[df["event"].notna(), ["frameId", "event"]].drop_duplicates()
    events = [{"f": int(f) - f0, "e": str(e)} for f, e in ev.itertuples(index=False)]

    snap = None
    if "frameType" in df.columns:
        snaps = df.loc[df["frameType"] == "SNAP", "frameId"]
        if len(snaps):
            snap = int(snaps.min()) - f0
    if snap is None:
        for e in events:
            if e["e"] in ("ball_snap", "snap_direct"):
                snap = e["f"]
                break

    return {
        "gameId": int(df["gameId"].iat[0]),
        "playId": int(df["playId"].iat[0]),
        "direction": str(df["playDirection"].iat[0]),
        "nFrames": n_frames,
        "snap": snap,
        "events": events,
        "players": entities,
        **grids,  # x/y/s scaled by 100, o in whole degrees
    }


def play_type(row):
    if col(row, "qbKneel"):
        return "kneel"
    if col(row, "qbSpike"):
        return "spike"
    if col(row, "isDropback") or col(row, "passResult") is not None:
        return "pass"
    return "run"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weeks", type=int, nargs="*", help="weeks to build (default: all 1-9)")
    args = ap.parse_args()

    data_dir = get_data_dir()
    games, plays, players, _ = load_tables(data_dir)
    positions = dict(zip(players["nflId"].astype(int), players["position"]))
    games = games.set_index("gameId")
    plays = plays.set_index(["gameId", "playId"])

    weeks = args.weeks or [w for w in range(1, 10) if (data_dir / f"tracking_week_{w}.csv").exists()]
    index = []
    for w in weeks:
        path = data_dir / f"tracking_week_{w}.csv"
        print(f"Week {w}: reading {path.name}...", flush=True)
        header = pd.read_csv(path, nrows=0).columns
        tr = pd.read_csv(path, usecols=[c for c in TRACKING_COLS if c in header])
        groups = tr.groupby(["gameId", "playId"], sort=False)
        print(f"  {groups.ngroups:,} plays, writing files...", flush=True)
        for n, ((gid, pid), df) in enumerate(groups, 1):
            play = build_play(df, positions)
            write_gz(OUT_DIR / "plays" / str(gid) / f"{pid}.json.gz", play)

            meta = plays.loc[(gid, pid)] if (gid, pid) in plays.index else None
            g = games.loc[gid] if gid in games.index else None
            entry = {"g": int(gid), "p": int(pid), "w": w, "nf": play["nFrames"]}
            if g is not None:
                entry.update(home=col(g, "homeTeamAbbr"), away=col(g, "visitorTeamAbbr"),
                             date=col(g, "gameDate"))
            if meta is not None:
                entry.update(
                    q=col(meta, "quarter"), dn=col(meta, "down"), ytg=col(meta, "yardsToGo"),
                    clk=col(meta, "gameClock"), off=col(meta, "possessionTeam"),
                    deff=col(meta, "defensiveTeam"), yls=col(meta, "yardlineSide"),
                    yln=col(meta, "yardlineNumber"), hs=col(meta, "preSnapHomeScore"),
                    vs=col(meta, "preSnapVisitorScore"), desc=col(meta, "playDescription"),
                    type=play_type(meta), res=col(meta, "passResult"),
                    yds=col(meta, "yardsGained"), epa=col(meta, "expectedPointsAdded"),
                    form=col(meta, "offenseFormation"), cov=col(meta, "pff_passCoverage"),
                    mz=col(meta, "pff_manZone"),
                )
            index.append(entry)
            if n % 250 == 0:
                print(f"  {n:,}/{groups.ngroups:,}", flush=True)
        del tr, groups

    # Merge with an existing index of this same dataset so building weeks separately accumulates.
    idx_path = OUT_DIR / "index.json.gz"
    if args.weeks and idx_path.exists():
        old = json.loads(gzip.decompress(idx_path.read_bytes()))
        if isinstance(old, dict) and old.get("source") == SOURCE:
            index = [e for e in old["plays"] if e["w"] not in set(weeks)] + index
    index.sort(key=lambda e: (e["g"], e["p"]))
    write_gz(idx_path, {"source": SOURCE, "plays": index})
    print(f"Done: {len(index):,} plays indexed in {OUT_DIR}")


if __name__ == "__main__":
    main()
