#!/usr/bin/env python3
"""Fetch client-appropriate, properly-licensed photos from the Pexels API and
download them into a content-hub demo's images/ folder (keeping filenames).

Usage: PEXELS_API_KEY=... python fetch-pexels-images.py <out_dir> <map_json>
where map_json is {"filename.jpg": "search query", ...}. Picks the first
landscape result per query and saves its large2x render.

Reused by the seo-copywriter skill so each client gets fresh, on-brand imagery
instead of the reference demo's photos.
"""
import json, os, sys, urllib.request, urllib.parse

KEY = os.environ.get("PEXELS_API_KEY", "").strip()
if not KEY:
    sys.exit("PEXELS_API_KEY not set")

out_dir = sys.argv[1]
mapping = json.loads(sys.argv[2])
os.makedirs(out_dir, exist_ok=True)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")  # Pexels WAF blocks Python-urllib's default UA

def search(q):
    url = "https://api.pexels.com/v1/search?" + urllib.parse.urlencode(
        {"query": q, "per_page": 5, "orientation": "landscape"})
    req = urllib.request.Request(url, headers={"Authorization": KEY, "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r).get("photos", [])

for fn, q in mapping.items():
    try:
        photos = search(q)
        if not photos:
            print(f"  MISS  {fn}  (no results for '{q}')"); continue
        p = photos[0]
        src = p["src"].get("large2x") or p["src"].get("large")
        dest = os.path.join(out_dir, fn)
        dreq = urllib.request.Request(src, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"})
        with urllib.request.urlopen(dreq, timeout=30) as resp, open(dest, "wb") as f:
            f.write(resp.read())
        kb = os.path.getsize(dest) // 1024
        print(f"  OK    {fn:24s} {kb:>5}KB  by {p.get('photographer','?')}  id={p['id']}")
    except Exception as e:
        print(f"  ERR   {fn}  {e}")
