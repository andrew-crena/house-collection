#!/usr/bin/env python3
"""Sync a public Discogs collection into data/collection.json.

Usage:  python3 scripts/sync_discogs.py [username]
Env:    DISCOGS_TOKEN (optional personal access token; raises the rate limit)

Release details (tracklists, credits) are cached in data/releases/, so a
nightly run only fetches records added since the last one. Standard library
only, so it runs anywhere, including a bare GitHub Actions runner.
"""
import json, os, re, sys, time, urllib.request, urllib.error

USER = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('DISCOGS_USER', 'andrewcrena')
TOKEN = os.environ.get('DISCOGS_TOKEN', '')
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'data')
CACHE = os.path.join(DATA, 'releases')
UA = 'AndrewCrenaHouseCollection/1.0 +https://andrew-crena.github.io/house-collection/'
PAUSE = 1.1 if TOKEN else 2.6          # stay under 60/min authenticated, 25/min anonymous

def get(url, tries=5):
    for i in range(tries):
        req = urllib.request.Request(url, headers={'User-Agent': UA, **({'Authorization': 'Discogs token=' + TOKEN} if TOKEN else {})})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                time.sleep(PAUSE)
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(10 * (i + 1)); continue
            raise
        except urllib.error.URLError:
            time.sleep(5 * (i + 1))
    raise RuntimeError('gave up on ' + url)

def clean_name(n):
    return re.sub(r'\s+\(\d+\)$', '', n or '').strip()   # Discogs disambiguation suffix "(2)"

def artists_str(arts):
    out = ''
    for a in arts or []:
        out += clean_name(a.get('anv') or a.get('name')) + ((' ' + a['join'] + ' ') if a.get('join') and a['join'] != ',' else (', ' if a.get('join') == ',' else ''))
    return re.sub(r'\s+', ' ', out).strip(' ,')

def norm(s):
    s = (s or '').lower()
    s = re.sub(r'\((?:\d{4} )?remaster(?:ed)?[^)]*\)|- (?:\d{4} )?remaster(?:ed)?.*$', '', s)
    s = re.sub(r'\b(feat|ft|featuring)\.?\b.*$', '', s)
    s = re.sub(r'^the ', '', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return s.strip()

def match_tracks(releases):
    """Attach BPM from tracks.json to the vinyl tracks they correspond to.
    A digital track matches a vinyl track when the titles agree (ignoring
    remaster tags, featured artists and punctuation) and the artist agrees
    with the track or release artist."""
    path = os.path.join(ROOT, 'tracks.json')
    if not os.path.exists(path): return 0
    digital = json.load(open(path))
    by_title = {}
    for i, d in enumerate(digital):
        by_title.setdefault(norm(d['title']), []).append(i)
    n = 0
    for r in releases:
        ra = norm(r['artist'])
        for t in r['tracks']:
            for i in by_title.get(norm(t['title']), []):
                da = norm(digital[i]['artist'])
                ta = norm(t['artist']) or ra
                if da and (da in ta or ta in da or da in ra or ra in da):
                    t['bpm'] = digital[i]['bpm']; t['digital'] = i; n += 1
                    break
    return n

def main():
    os.makedirs(CACHE, exist_ok=True)
    items, page = [], 1
    while True:
        d = get(f'https://api.discogs.com/users/{USER}/collection/folders/0/releases?per_page=100&page={page}&sort=added&sort_order=desc')
        items += d['releases']
        if page >= d['pagination']['pages']: break
        page += 1
    print(f'{len(items)} items in collection')

    out = []
    for it in items:
        b = it['basic_information']
        rid = b['id']
        path = os.path.join(CACHE, f'{rid}.json')
        if os.path.exists(path):
            rel = json.load(open(path))
        else:
            print('fetching release', rid, b['title'])
            rel = get(f'https://api.discogs.com/releases/{rid}')
            keep = {k: rel.get(k) for k in ('id', 'title', 'year', 'released', 'country', 'tracklist', 'extraartists', 'notes', 'uri', 'master_id', 'genres', 'styles')}
            json.dump(keep, open(path, 'w'), ensure_ascii=False)
            rel = keep
        tracks = []
        for t in rel.get('tracklist') or []:
            if t.get('type_', 'track') != 'track': continue
            tracks.append({
                'pos': t.get('position', ''), 'title': t.get('title', ''), 'dur': t.get('duration', ''),
                'artist': artists_str(t.get('artists')) if t.get('artists') else '',
            })
        credits = []
        for c in (rel.get('extraartists') or [])[:40]:
            if not c.get('tracks'):
                credits.append({'role': c.get('role', ''), 'name': clean_name(c.get('anv') or c.get('name'))})
        fmt = b['formats'][0] if b.get('formats') else {}
        out.append({
            'id': rid,
            'instance': it['instance_id'],
            'added': it['date_added'][:10],
            'title': b['title'],
            'artist': artists_str(b['artists']),
            'year': b.get('year') or 0,
            'released': rel.get('released') or '',
            'country': rel.get('country') or '',
            'labels': [{'name': clean_name(l['name']), 'catno': l.get('catno', ''), 'id': l['id']} for l in b.get('labels', [])],
            'format': ', '.join(x for x in [fmt.get('name', ''), fmt.get('qty', '') + '×' if fmt.get('qty', '1') not in ('', '1') else '', *fmt.get('descriptions', []), fmt.get('text', '')] if x),
            'genres': b.get('genres', []),
            'styles': b.get('styles', []),
            'cover': b.get('cover_image', ''),
            'thumb': b.get('thumb', ''),
            'master': b.get('master_id') or 0,
            'url': rel.get('uri') or f'https://www.discogs.com/release/{rid}',
            'tracks': tracks,
            'credits': credits,
        })
    out.sort(key=lambda r: r['added'], reverse=True)
    matched = match_tracks(out)
    print(f'{matched} digital tracks matched to records')
    json.dump({'user': USER, 'synced': time.strftime('%Y-%m-%d'), 'count': len(out), 'releases': out},
              open(os.path.join(DATA, 'collection.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print('wrote data/collection.json')

if __name__ == '__main__':
    main()
