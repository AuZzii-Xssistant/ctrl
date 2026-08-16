"""
Pulls latest WinScript, converts scripts.js -> CTRL's SQLite scripts table.
Icons are parsed from MainPage.astro and stored as base64 data URIs.
Re-runs always UPDATE existing winscript scripts (never skip).
"""
import sys, os, json, sqlite3, subprocess, re, base64, tempfile

WINSCRIPT   = r"M:\Projects\winscript-ref"
CTRL        = r"M:\Projects\CTRL"
SCRIPTS_JS  = os.path.join(WINSCRIPT, "app", "src", "assets", "js", "scripts.js")
EN_JSON     = os.path.join(WINSCRIPT, "app", "src", "i18n", "locales", "en.json")
MAINPAGE    = os.path.join(WINSCRIPT, "app", "src", "components", "MainPage.astro")
ICONS_ROOT  = os.path.join(WINSCRIPT, "app", "public")

DB_CANDIDATES = [
    os.path.join(CTRL, "src-tauri", "target", "release", "ctrl.db"),
    os.path.join(CTRL, "src-tauri", "target", "debug",   "ctrl.db"),
    os.path.join(CTRL, "src-tauri", "target",             "ctrl.db"),
]

def find_db():
    env = os.environ.get("CTRL_DB")
    if env and os.path.exists(env): return env
    for p in DB_CANDIDATES:
        if os.path.exists(p): return p
    return None

# ── Step 1: Pull latest WinScript ───────────────────────────────────────────
print("[1/4] Pulling latest WinScript from GitHub...")
# fetch + reset so local diverges/conflicts never block us (winscript-ref is read-only)
subprocess.run(["git", "fetch", "--quiet"], cwd=WINSCRIPT, check=True)
result = subprocess.run(["git", "reset", "--hard", "origin/main"], cwd=WINSCRIPT, capture_output=True, text=True)
print(result.stdout.strip() or result.stderr.strip())
if result.returncode != 0:
    print("ERROR: git reset failed.")
    sys.exit(1)
log = subprocess.run(["git", "log", "--oneline", "-5"], cwd=WINSCRIPT, capture_output=True, text=True)
print(log.stdout.strip())
print()

# ── Step 2: Build inputId → icon_data_uri map from MainPage.astro ───────────
print("[2/4] Parsing icons from MainPage.astro...")

def icon_to_data_uri(icon_path):
    """icon_path like /icons/debloat/store.png -> data URI"""
    full = os.path.join(ICONS_ROOT, icon_path.lstrip("/").replace("/", os.sep))
    if not os.path.exists(full):
        return ""
    ext = os.path.splitext(full)[1].lower()
    mime = "image/svg+xml" if ext == ".svg" else "image/png"
    with open(full, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    return f"data:{mime};base64,{data}"

astro_src = open(MAINPAGE, encoding="utf-8").read()

# Extract all inputId → icon mappings.
# Strategy: scan tokens in order. When we see icon="...", record it.
# When we see inputId="...", assign the last seen icon to it.
icon_map = {}
current_icon = ""

# Match icon="/icons/..." OR inputId="..." (JSX prop) OR inputId: "..." (JS object in tools array)
for m in re.finditer(r'icon="(/icons/[^"]+)"|inputId[=:]\s*"([^"]+)"', astro_src):
    if m.group(1):
        current_icon = m.group(1)
    elif m.group(2) and current_icon:
        icon_map[m.group(2)] = current_icon

# Preload data URIs (deduplicated)
uri_cache = {}
for script_id, icon_path in icon_map.items():
    if icon_path not in uri_cache:
        uri_cache[icon_path] = icon_to_data_uri(icon_path)

print(f"  Mapped {len(icon_map)} script IDs to icons ({len(uri_cache)} unique icons)")
print()

# ── Step 3: Extract scripts object from scripts.js ──────────────────────────
print("[3/4] Extracting scripts...")
src = open(SCRIPTS_JS, encoding="utf-8").read()

marker = "const scripts = {"
start = src.find(marker)
if start == -1:
    print("ERROR: 'const scripts = {' not found in scripts.js")
    sys.exit(1)

depth, i, end = 0, start + len(marker) - 1, -1
while i < len(src):
    if src[i] == "{": depth += 1
    elif src[i] == "}":
        depth -= 1
        if depth == 0: end = i; break
    i += 1

obj_src = src[start + len("const scripts = "):end + 1]

tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".js", delete=False, encoding="utf-8")
tmp.write(f"process.stdout.write(JSON.stringify({obj_src}))")
tmp.close()
try:
    node_result = subprocess.run(["node", tmp.name], capture_output=True, text=True)
finally:
    os.unlink(tmp.name)

if node_result.returncode != 0:
    print("ERROR: node eval failed:", node_result.stderr[:300])
    sys.exit(1)

scripts = json.loads(node_result.stdout)

# ── Load en.json for title/desc/category ────────────────────────────────────
en = json.loads(open(EN_JSON, encoding="utf-8").read())

by_id = {}
for k, v in en.items():
    seg = k.split(".")[-1]
    by_id.setdefault(seg, []).append((k, v))

CAT_MAP = {
    "tools": "Tools", "debloat": "Debloat", "privacy": "Privacy",
    "telemetry": "Telemetry", "gaming": "Gaming", "performance": "Performance",
    "miscellaneous": "Miscellaneous",
}

def lookup(script_id):
    for k, v in en.items():
        if k.endswith("." + script_id + ".title") or k == script_id + ".title":
            desc_key = k.replace(".title", ".desc")
            cat = CAT_MAP.get(k.split(".")[0], k.split(".")[0].capitalize())
            return v, en.get(desc_key, ""), cat
    for k, v in by_id.get(script_id, []):
        if not k.endswith(".title") and not k.endswith(".desc"):
            cat = CAT_MAP.get(k.split(".")[0], k.split(".")[0].capitalize())
            return v, en.get(k + ".desc", ""), cat
    return script_id, "", "WinScript"

# ── Step 4: Upsert into ctrl.db ─────────────────────────────────────────────
print("[4/4] Importing into CTRL database...")
db_path = find_db()
if not db_path:
    print("ERROR: ctrl.db not found. Build CTRL first, or set CTRL_DB env var.")
    sys.exit(1)

print(f"  DB: {db_path}")
conn = sqlite3.connect(db_path)
cur = conn.cursor()

added = updated = 0
for script_id, lines in scripts.items():
    content = "\n".join(lines)
    name, desc, category = lookup(script_id)
    icon_path = icon_map.get(script_id, "")
    icon_data = uri_cache.get(icon_path, "") if icon_path else ""

    existing = cur.execute(
        "SELECT id FROM scripts WHERE name=? AND tags='winscript'", (name,)
    ).fetchone()

    if existing:
        cur.execute(
            "UPDATE scripts SET description=?,category=?,script_type=?,run_as_admin=?,content=?,icon=? WHERE id=?",
            (desc, category, "ps1", 1, content, icon_data, existing[0])
        )
        updated += 1
    else:
        cur.execute(
            "INSERT INTO scripts (name,description,category,file_path,script_type,tags,status,run_as_admin,content,icon) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (name, desc, category, "", "ps1", "winscript", "active", 1, content, icon_data)
        )
        added += 1

conn.commit()
conn.close()

print(f"  Added: {added}  |  Updated: {updated}")
print()
print("Done! Open CTRL > Scripts and filter by tag 'winscript' to see them.")
