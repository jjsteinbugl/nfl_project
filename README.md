# NFL Project

Analysis of NFL player-tracking data from the [NFL Big Data Bowl 2025](https://www.kaggle.com/competitions/nfl-big-data-bowl-2025):
frame-by-frame (10 Hz) positions, speed and direction for all 22 players and the ball,
2022 season, weeks 1–9.

The data is not included in this repo. It's licensed through Kaggle, so each user downloads it with their own account.

## Setup

```bash
pip install -r requirements.txt
```

1. Join the competition on Kaggle and accept its rules.
2. Get an API token: Kaggle → Settings → API → **Create New Token**, then save `kaggle.json` to `~/.kaggle/`.
3. Download the data (several GB):

```bash
python download_data.py
```

The files land in `data/nfl-big-data-bowl-2025/`, which git ignores.

## Loading the data

```python
from load_data import load_tables, load_tracking

games, plays, players, player_play = load_tables()
tracking = load_tracking(weeks=[1])   # omit weeks= to load all 9
```

`load_tracking` flips plays that move left by default, so the offense always moves toward increasing `x`.
Pass `standardize=False` to keep the raw coordinates.

The same code runs in a Kaggle notebook, where it finds `/kaggle/input/...` automatically.
To use a different folder, set the `NFL_DATA_DIR` environment variable.

## Play viewer website

A local website for picking a play and watching all 22 players and the ball move, frame by frame.

```bash
python build_web_data.py   # one-time: converts the tracking CSVs (~10-30 min for all 9 weeks)
python serve.py            # opens http://localhost:8000
```

`build_web_data.py --weeks 1` builds a single week for a quick start; later runs add more weeks to the same index.
The output goes to `web/data/` (git-ignored): one small compressed file per play, plus a searchable index.

In the viewer:
- Filter plays by week, team, game, quarter, down, pass/run, or search the play descriptions.
- Play/pause (Space), step frames (←/→), scrub, change speed, or jump to the snap. Yellow ticks on the scrubber mark events (snap in red).
- Hover a player for name, position, and speed; click to highlight their path.
- Options: flip plays so the offense always moves right, trails, facing direction, color by offense/defense.
- The URL tracks the play (`#play=<gameId>-<playId>`), so links are shareable; add `&f=<frame>` to open at a given frame.

## Files

| File | Purpose |
|---|---|
| `download_data.py` | Downloads and unzips the competition data via the Kaggle API |
| `load_data.py` | Finds the data folder and loads the tables and tracking data |
| `build_web_data.py` | Converts tracking data into per-play files for the website |
| `serve.py` | Serves the play viewer locally |
| `web/` | The play viewer website (HTML/CSS/JS, no build step) |
| `requirements.txt` | Python dependencies |
