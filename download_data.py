"""Download the NFL Big Data Bowl 2025 data into data/nfl-big-data-bowl-2025/.

Before running:
  1. Join the competition on Kaggle and accept its rules:
     https://www.kaggle.com/competitions/nfl-big-data-bowl-2025
  2. Create an API token (Kaggle > Settings > API > Create New Token) and save
     kaggle.json to ~/.kaggle/kaggle.json (on Windows: C:\\Users\\<you>\\.kaggle\\).

Then run:  python download_data.py
"""

import zipfile
from pathlib import Path

COMPETITION = "nfl-big-data-bowl-2025"
DATA_DIR = Path(__file__).resolve().parent / "data" / COMPETITION


def main():
    from kaggle.api.kaggle_api_extended import KaggleApi

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    api = KaggleApi()
    api.authenticate()

    print(f"Downloading {COMPETITION} to {DATA_DIR} (several GB, this takes a while)...")
    api.competition_download_files(COMPETITION, path=str(DATA_DIR), quiet=False)

    zip_path = DATA_DIR / f"{COMPETITION}.zip"
    print("Unzipping...")
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(DATA_DIR)
    zip_path.unlink()

    print("Done. Files:")
    for f in sorted(DATA_DIR.glob("*.csv")):
        print(f"  {f.name}  ({f.stat().st_size / 1e6:,.0f} MB)")


if __name__ == "__main__":
    main()
