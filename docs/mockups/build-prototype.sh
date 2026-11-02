#!/usr/bin/env bash
# Builds a self-contained copy of the Project Tier prototype in docs/mockups/dist, ready for any static host
# (Vercel, Netlify, GitHub Pages). The source page reaches outside this folder for the app stylesheet and the
# logo; the build copies both in so nothing points at ../../frontend.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
out="$here/dist"

# Clear the previous build but keep .vercel, so a rebuild stays linked to the same Vercel project.
mkdir -p "$out"
find "$out" -mindepth 1 -maxdepth 1 ! -name .vercel -exec rm -rf {} +
mkdir -p "$out/prototype" "$out/assets"

# One stylesheet: fonts, then the app's tokens and components, then the mockup additions (minus their @imports).
{
  grep '^@import url("https://fonts' "$here/mockup.css"
  cat "$root/frontend/src/styles/tokens.css"
  grep -v '^@import' "$root/frontend/src/styles/app.css"
  grep -v '^@import' "$here/mockup.css"
} > "$out/styles.css"

cp "$root/frontend/public/finvasia-logo-light.svg" "$out/assets/"
cp "$root/frontend/public/finvasia-mark.svg" "$out/assets/"
cp "$here"/prototype/*.js "$out/prototype/"

sed -e 's#href="mockup.css"#href="styles.css"#' \
    -e 's#src="../../frontend/public/finvasia-logo-light.svg"#src="assets/finvasia-logo-light.svg"#' \
    -e 's#<head>#<head>\n<link rel="icon" href="assets/finvasia-mark.svg">#' \
    "$here/project-tier-prototype.html" > "$out/index.html"

# Version local assets by their contents so a refreshed page cannot use an old click handler.
# Refresh the downloadable copy too; it must contain the same files as the hosted bundle.
python3 - "$out" "$here/elevate-prototype.zip" <<'PY'
import hashlib
from pathlib import Path
import re
import sys
import zipfile

out = Path(sys.argv[1])
index = out / "index.html"
def version(match):
    attr, name = match.groups()
    digest = hashlib.sha256((out / name).read_bytes()).hexdigest()[:12]
    return f'{attr}="{name}?v={digest}"'
index.write_text(re.sub(r'(src|href)="((?:prototype|assets)/[^"?]+|styles\.css)"', version, index.read_text()))
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as bundle:
    for file in sorted(out.rglob('*')):
        relative = file.relative_to(out)
        if file.is_file() and not any(part.startswith('.') for part in relative.parts):
            bundle.write(file, relative)
PY

# Fail if anything still points outside the bundle.
if grep -n '\.\./' "$out/index.html" "$out/styles.css"; then echo "Build still references files outside dist" >&2; exit 1; fi
echo "Built $out"
