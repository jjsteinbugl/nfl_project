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

## Files

| File | Purpose |
|---|---|
| `download_data.py` | Downloads and unzips the competition data via the Kaggle API |
| `load_data.py` | Finds the data folder and loads the tables and tracking data |
| `requirements.txt` | Python dependencies |
