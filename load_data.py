"""Load NFL Big Data Bowl 2025 data, on Kaggle or on your own machine.

Usage:
    from load_data import load_tables, load_tracking

    games, plays, players, player_play = load_tables()
    tracking = load_tracking(weeks=[1, 2])        # frame-by-frame, all 22 players + ball
    tracking = load_tracking()                    # all 9 weeks (needs lots of RAM)

The data folder is found automatically, in this order:
    1. the NFL_DATA_DIR environment variable, if set
    2. /kaggle/input/nfl-big-data-bowl-2025  (Kaggle notebooks)
    3. ../input/nfl-big-data-bowl-2025       (older Kaggle path)
    4. data/nfl-big-data-bowl-2025 next to this file (after running download_data.py)
"""

import os
from pathlib import Path

import numpy as np
import pandas as pd

COMPETITION = "nfl-big-data-bowl-2025"
FIELD_LENGTH = 120.0  # yards, including end zones
FIELD_WIDTH = 160 / 3  # 53.33 yards


def get_data_dir() -> Path:
    candidates = []
    if os.environ.get("NFL_DATA_DIR"):
        candidates.append(Path(os.environ["NFL_DATA_DIR"]))
    candidates += [
        Path("/kaggle/input") / COMPETITION,
        Path("../input") / COMPETITION,
        Path(__file__).resolve().parent / "data" / COMPETITION,
    ]
    for path in candidates:
        if (path / "plays.csv").exists():
            return path
    raise FileNotFoundError(
        "Could not find the Big Data Bowl data. Run `python download_data.py`, "
        "or set NFL_DATA_DIR to the folder containing plays.csv. Looked in:\n  "
        + "\n  ".join(str(p) for p in candidates)
    )


def load_tables(data_dir=None):
    """Return (games, plays, players, player_play) DataFrames."""
    d = Path(data_dir) if data_dir else get_data_dir()
    games = pd.read_csv(d / "games.csv")
    plays = pd.read_csv(d / "plays.csv")
    players = pd.read_csv(d / "players.csv")
    player_play = pd.read_csv(d / "player_play.csv")
    return games, plays, players, player_play


def standardize_direction(tracking: pd.DataFrame) -> pd.DataFrame:
    """Flip plays moving left so every offense moves toward increasing x.

    Adjusts x, y, orientation (o) and direction (dir). Adds a 'flipped' column.
    """
    df = tracking.copy()
    left = df["playDirection"] == "left"
    df.loc[left, "x"] = FIELD_LENGTH - df.loc[left, "x"]
    df.loc[left, "y"] = FIELD_WIDTH - df.loc[left, "y"]
    for col in ("o", "dir"):
        if col in df.columns:
            df.loc[left, col] = (df.loc[left, col] + 180) % 360
    df["flipped"] = left
    return df


def load_tracking(weeks=None, standardize=True, data_dir=None) -> pd.DataFrame:
    """Load frame-by-frame tracking data (10 frames per second).

    weeks: list of week numbers 1-9, or None for all weeks.
    standardize: if True, flip left-moving plays so offense always goes right.
    """
    d = Path(data_dir) if data_dir else get_data_dir()
    weeks = weeks or range(1, 10)
    dtypes = {
        "gameId": np.int64,
        "playId": np.int32,
        "nflId": "Int64",  # missing for the ball
        "frameId": np.int16,
        "x": np.float32,
        "y": np.float32,
        "s": np.float32,
        "a": np.float32,
        "dis": np.float32,
        "o": np.float32,
        "dir": np.float32,
    }
    frames = []
    for w in weeks:
        path = d / f"tracking_week_{w}.csv"
        print(f"Loading {path.name}...")
        df = pd.read_csv(path, dtype=dtypes)
        df["week"] = w
        frames.append(df)
    tracking = pd.concat(frames, ignore_index=True)
    if standardize:
        tracking = standardize_direction(tracking)
    return tracking


if __name__ == "__main__":
    games, plays, players, player_play = load_tables()
    print(f"games: {len(games):,}  plays: {len(plays):,}  "
          f"players: {len(players):,}  player_play: {len(player_play):,}")
    tr = load_tracking(weeks=[1])
    print(f"week 1 tracking rows: {len(tr):,}")
    print(tr.head())
