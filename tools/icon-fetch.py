"""
Fetches real app icons for the Builder App Install list (data/builder/08-apps.json)
and caches them as local PNGs under src/assets/app-icons/<app id>.png.

This is a build-time maintainer tool, not something the shipped app ever runs --
CTRL stays fully offline at runtime. Icons are looked up once here (winget CLI
locally for each package's homepage, then a favicon fetch for that homepage's
domain) and cached as static PNGs. Builder just references
assets/app-icons/<id>.png and falls back to a ">_" placeholder if the file
doesn't exist -- no JSON schema change needed.

src/assets/app-icons/ is gitignored on purpose -- these are real third-party
app logos (Chrome/Discord/Steam/etc), fine to bundle into your own local
build, but never committed/pushed to the public repo. Run this script
yourself before building if you want icons in Builder's App Install list.

Requires: winget CLI available locally (winget show --id <pkg>), network access.
Re-run after adding new apps to 08-apps.json, or with --force to refresh all.
"""
import sys, os, json, re, subprocess, urllib.request
from urllib.parse import urlparse

CTRL       = r"M:\Projects\CTRL"
APPS_JSON  = os.path.join(CTRL, "data", "builder", "08-apps.json")
ICONS_DIR  = os.path.join(CTRL, "src", "assets", "app-icons")
FORCE      = "--force" in sys.argv

HOMEPAGE_RE = re.compile(r"^Homepage:\s*(\S+)", re.MULTILINE)


def get_homepage(winget_id):
    r = subprocess.run(
        ["winget", "show", "--id", winget_id, "--exact", "--accept-source-agreements"],
        capture_output=True, text=True, timeout=30,
    )
    if r.returncode != 0:
        return None
    m = HOMEPAGE_RE.search(r.stdout)
    return m.group(1).strip() if m else None


def fetch_favicon(domain):
    url = f"https://www.google.com/s2/favicons?domain={domain}&sz=128"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = resp.read()
    if not data.startswith(b"\x89PNG"):
        return None  # error/redirect page, not a real image
    return data


def main():
    apps = json.load(open(APPS_JSON, encoding="utf-8"))
    entries = [a for cat in apps["categories"] for a in cat["apps"]]
    os.makedirs(ICONS_DIR, exist_ok=True)

    fetched = skipped_cached = skipped_no_winget = skipped_no_homepage = failed = 0

    for i, a in enumerate(entries, 1):
        dest = os.path.join(ICONS_DIR, f"{a['id']}.png")
        print(f"[{i}/{len(entries)}] {a['label']}...", end=" ")

        if os.path.exists(dest) and not FORCE:
            print("cached, skip")
            skipped_cached += 1
            continue
        if not a.get("winget"):
            print("no winget id, skip")
            skipped_no_winget += 1
            continue

        homepage = get_homepage(a["winget"])
        if not homepage:
            print("no homepage found, skip")
            skipped_no_homepage += 1
            continue

        domain = urlparse(homepage).netloc
        try:
            icon = fetch_favicon(domain)
        except Exception as e:
            print(f"fetch failed ({e})")
            failed += 1
            continue
        if not icon:
            print(f"no real icon for {domain}")
            failed += 1
            continue

        with open(dest, "wb") as f:
            f.write(icon)
        print(f"saved ({domain})")
        fetched += 1

    print()
    print(f"Fetched: {fetched}  Cached (skipped): {skipped_cached}  "
          f"No winget id: {skipped_no_winget}  No homepage: {skipped_no_homepage}  Failed: {failed}")


if __name__ == "__main__":
    main()
