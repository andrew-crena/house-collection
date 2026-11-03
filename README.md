# House Collection

<https://andrew-crena.github.io/house-collection/>

My records (from Discogs), the labels behind them, and the tracks I play, with BPM.

## What's where

| File | What | Who edits it |
| --- | --- | --- |
| `data/collection.json` | The Discogs collection: records, labels, tracklists, credits | The nightly sync (don't edit by hand) |
| `data/releases/` | Cached release details, so the sync only fetches new records | The sync |
| `data/notes.json` | **Liner notes** for records and **notes on labels** | You |
| `tracks.json` | Digital tracks with BPM | You |
| `scripts/sync_discogs.py` | Pulls the collection and matches tracks to records | |
| `.github/workflows/sync-discogs.yml` | Runs the sync every day | |

## Adding a record

Add it to your collection on Discogs. The sync runs every morning and commits the update; the site rebuilds itself. To sync right away: GitHub → **Actions** → **Sync Discogs collection** → **Run workflow**.

Optional: create a personal access token at discogs.com → Settings → Developers and save it as a repository secret named `DISCOGS_TOKEN` (Settings → Secrets and variables → Actions). The sync works without it; with it, it runs faster and is less likely to be rate-limited.

## Writing a liner note

Open a record on the site; its address ends in `#/r/<number>`. Add that number to `data/notes.json`:

```json
{
  "releases": {
    "11826312": "First paragraph.\n\nSecond paragraph."
  },
  "labels": {
    "Prescription": "One line on why this label matters to me."
  }
}
```

Label names must match the site exactly. The first line of a label note shows on the Labels page; the whole note shows on the label's timeline.

## Running locally

```bash
python3 scripts/sync_discogs.py andrewcrena
python3 -m http.server
```
