"""Build the play viewer's data from the Big Data Bowl 2026 files (2023 season).

    python build_web_data_2026.py --data-dir "path/to/114239_nfl_competition_files_published_analytics_final"
    python build_web_data_2026.py --data-dir ... --weeks 1 2   # just some weeks

The 2026 data differs from the 2025 data used by build_web_data.py:
  * pass plays only, and only the players involved in the pass (~13 of 22), no ball
  * train/input_2023_wXX.csv:  all those players from the snap until the throw
  * train/output_2023_wXX.csv: after the throw, only the players being predicted (1-8)
  * supplementary_data.csv:    game and play details
So in the viewer, players not tracked after the throw are held (faded) at their last
position, and the ball's flight is estimated as a straight line from the passer at the
throw to the recorded landing spot.

Writes the same files as build_web_data.py, under web/data/ (git-ignored). Building
replaces whatever dataset was there before.
"""

import argparse
import shutil
from pathlib import Path

import numpy as np
import pandas as pd

from build_web_data import OUT_DIR, clean, write_gz

SOURCE = "2023 NFL season"


def build_play(inp: pd.DataFrame, out: pd.DataFrame, meta) -> dict:
    n_in = int(inp["frame_id"].max())
    n_out = int(out["frame_id"].max()) if len(out) else 0
    n = n_in + n_out
    direction = str(inp["play_direction"].iat[0])
    off_team = meta["possession_team"] if meta is not None else "OFF"
    def_team = meta["defensive_team"] if meta is not None else "DEF"

    first = inp.sort_values("frame_id").groupby("nfl_id", sort=False).first()
    # Offense first, then defense; passer first within offense
    order = first.assign(
        _side=(first["player_side"] != "Offense").astype(int),
        _passer=(first["player_role"] != "Passer").astype(int),
    ).sort_values(["_side", "_passer", "player_position"]).index

    players, xs, ys, ss, os_ = [], [], [], [], []
    for nid in order:
        r = first.loc[nid]
        side = r["player_side"]
        players.append({
            "id": int(nid),
            "name": clean(r["player_name"]),
            "jersey": None,
            "club": off_team if side == "Offense" else def_team,
            "pos": clean(r["player_position"]),
            "role": clean(r["player_role"]),
        })
        x = np.full(n, np.nan); y = np.full(n, np.nan); s = np.full(n, np.nan); o = np.full(n, np.nan)
        pi = inp[inp["nfl_id"] == nid]
        idx = pi["frame_id"].to_numpy() - 1
        x[idx], y[idx], s[idx], o[idx] = pi["x"], pi["y"], pi["s"], pi["o"]
        po = out[out["nfl_id"] == nid]
        if len(po):
            idx = n_in + po["frame_id"].to_numpy() - 1
            x[idx], y[idx] = po["x"], po["y"]
            # Output has no speed: derive it from movement (10 frames per second)
            for i in range(n_in, n):
                if not np.isnan(x[i]) and not np.isnan(x[i - 1]):
                    s[i] = np.hypot(x[i] - x[i - 1], y[i] - y[i - 1]) * 10
        xs.append(x); ys.append(y); ss.append(s); os_.append(o)

    # Estimated ball: with the passer until the throw, then a straight line to the landing spot
    land = (clean(inp["ball_land_x"].iat[0]), clean(inp["ball_land_y"].iat[0]))
    passer = next((i for i, p in enumerate(players) if p["role"] == "Passer"), None)
    if passer is not None:
        bx = xs[passer].copy(); by = ys[passer].copy()
        bx[n_in:] = np.nan; by[n_in:] = np.nan
        if land[0] is not None and n_out:
            x0, y0 = bx[n_in - 1], by[n_in - 1]
            for k in range(1, n_out + 1):
                a = k / n_out
                bx[n_in - 1 + k] = x0 + (land[0] - x0) * a
                by[n_in - 1 + k] = y0 + (land[1] - y0) * a
        players.append({"id": None, "name": "Football (estimated)", "jersey": None,
                        "club": "football", "pos": None, "estimated": True})
        xs.append(bx); ys.append(by); ss.append(np.full(n, np.nan)); os_.append(np.full(n, np.nan))

    def grid(rows, scale):
        return [[None if np.isnan(v) else int(round(v * scale)) for v in row] for row in rows]

    events = [{"f": n_in - 1, "e": "pass_forward"}]
    if n_out:
        events.append({"f": n - 1, "e": "pass_arrived"})
    return {
        "gameId": int(inp["game_id"].iat[0]),
        "playId": int(inp["play_id"].iat[0]),
        "direction": direction,
        "nFrames": n,
        "snap": None,
        "anchor": {"f": n_in - 1, "label": "throw"},
        "los": clean(inp["absolute_yardline_number"].iat[0]),
        "ballLand": list(land) if land[0] is not None else None,
        "events": events,
        "players": players,
        "x": grid(xs, 100), "y": grid(ys, 100), "s": grid(ss, 100), "o": grid(os_, 1),
    }


def index_entry(gid, pid, week, n, m):
    e = {"g": int(gid), "p": int(pid), "w": int(week), "nf": n, "type": "pass"}
    if m is None:
        return e
    g = lambda k: clean(m[k]) if k in m.index else None
    e.update(
        home=g("home_team_abbr"), away=g("visitor_team_abbr"), date=g("game_date"),
        q=g("quarter"), dn=g("down"), ytg=g("yards_to_go"), clk=g("game_clock"),
        off=g("possession_team"), deff=g("defensive_team"), yls=g("yardline_side"),
        yln=g("yardline_number"), hs=g("pre_snap_home_score"), vs=g("pre_snap_visitor_score"),
        desc=g("play_description"), res=g("pass_result"), yds=g("yards_gained"),
        epa=g("expected_points_added"), form=g("offense_formation"),
        cov=g("team_coverage_type"), mz=g("team_coverage_man_zone"),
    )
    return e


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True, help="folder holding supplementary_data.csv and train/")
    ap.add_argument("--weeks", type=int, nargs="*", help="weeks to build (default: all 1-18)")
    args = ap.parse_args()

    d = Path(args.data_dir)
    supp = pd.read_csv(d / "supplementary_data.csv", low_memory=False).set_index(["game_id", "play_id"])
    weeks = args.weeks or [w for w in range(1, 19) if (d / "train" / f"input_2023_w{w:02d}.csv").exists()]

    if (OUT_DIR / "plays").exists():
        shutil.rmtree(OUT_DIR / "plays")  # replace any previously built dataset
    index = []
    for w in weeks:
        print(f"Week {w}...", flush=True)
        inp = pd.read_csv(d / "train" / f"input_2023_w{w:02d}.csv")
        out = pd.read_csv(d / "train" / f"output_2023_w{w:02d}.csv")
        out_groups = dict(tuple(out.groupby(["game_id", "play_id"])))
        empty = out.iloc[0:0]
        for (gid, pid), df in inp.groupby(["game_id", "play_id"]):
            m = supp.loc[(gid, pid)] if (gid, pid) in supp.index else None
            if isinstance(m, pd.DataFrame):
                m = m.iloc[0]
            play = build_play(df, out_groups.get((gid, pid), empty), m)
            write_gz(OUT_DIR / "plays" / str(gid) / f"{pid}.json.gz", play)
            week = m["week"] if m is not None and "week" in m.index else w
            entry = index_entry(gid, pid, week, play["nFrames"], m)
            def role_name(role):
                names = df.loc[df["player_role"] == role, "player_name"]
                return clean(names.iat[0]) if len(names) else None
            entry["qb"], entry["rec"] = role_name("Passer"), role_name("Targeted Receiver")
            index.append(entry)

    index.sort(key=lambda e: (e["g"], e["p"]))
    write_gz(OUT_DIR / "index.json.gz", {"source": SOURCE, "plays": index})
    print(f"Done: {len(index):,} plays in {OUT_DIR}")


if __name__ == "__main__":
    main()
