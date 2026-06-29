"""
Study-Uni — SharePoint Link Checker
Run this periodically to catch broken exam paper links before students do.

Usage:
    python check_links.py

Output:
    Prints a summary and writes broken_links.txt with any dead URLs.

How it works:
    SharePoint returns 200/302 for files that exist (even if login is needed).
    A 404 means the file genuinely doesn't exist at that path.
    Connection errors mean the server couldn't be reached at all.
"""

import re, sys, time, urllib.request, urllib.error, ssl, os
from collections import defaultdict

DATA_FILE = os.path.join(os.path.dirname(__file__), "data.js")
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "broken_links.txt")

TIMEOUT = 10       # seconds per request
BATCH_PAUSE = 0.2  # seconds between requests (be polite to SharePoint)

def load_urls(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    urls = re.findall(r'https://uccireland\.sharepoint\.com[^\s"\']+', content)
    # Deduplicate while preserving order
    seen = set()
    unique = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            unique.append(u)
    return unique

def check_url(url):
    """Returns (status_code_or_0, error_message_or_None)."""
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, method='HEAD',
          headers={'User-Agent': 'Mozilla/5.0 (link-checker)'})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
            return r.status, None
    except urllib.error.HTTPError as e:
        return e.code, None
    except urllib.error.URLError as e:
        return 0, str(e.reason)
    except Exception as e:
        return 0, str(e)

def main():
    print(f"Loading URLs from {DATA_FILE}...")
    urls = load_urls(DATA_FILE)
    print(f"Found {len(urls):,} unique SharePoint URLs\n")

    broken = []
    ok_count = 0
    folder_errors = defaultdict(list)

    for i, url in enumerate(urls, 1):
        status, err = check_url(url)
        label = url.split('/Shared%20Documents/')[-1] if '/Shared%20Documents/' in url else url

        if status == 404:
            broken.append((url, '404 Not Found'))
            folder = label.split('/')[0] if '/' in label else 'root'
            folder_errors[folder].append(label)
            print(f"  [404] {label}")
        elif status == 0:
            broken.append((url, f'Connection error: {err}'))
            print(f"  [ERR] {label}  ({err})")
        else:
            ok_count += 1

        # Progress every 100 URLs
        if i % 100 == 0:
            pct = i / len(urls) * 100
            print(f"  ... {i}/{len(urls)} checked ({pct:.0f}%)  —  {len(broken)} broken so far")

        time.sleep(BATCH_PAUSE)

    # ── Report ────────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"RESULTS: {ok_count} OK  |  {len(broken)} broken  |  {len(urls)} total")
    print(f"{'='*60}")

    if broken:
        print(f"\nBroken links by folder:")
        for folder, items in sorted(folder_errors.items()):
            print(f"  {folder}: {len(items)} broken")

        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            f.write(f"Study-Uni broken links — {len(broken)} found\n")
            f.write("=" * 60 + "\n\n")
            for url, reason in broken:
                f.write(f"{reason}\n{url}\n\n")

        print(f"\nFull list saved to: {OUTPUT_FILE}")
        print("Fix these in data.js by searching for the module code in the URL.")
    else:
        print("\nAll links OK!")
        if os.path.exists(OUTPUT_FILE):
            os.remove(OUTPUT_FILE)

if __name__ == "__main__":
    main()
