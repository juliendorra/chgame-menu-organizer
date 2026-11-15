"""Build one offline HTML file from the organizer's browser modules and helper."""

import argparse
import base64
import hashlib
from html import escape
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
BUILD = HERE / "build"
SOURCE = HERE / "src" if (HERE / "src" / "app.mjs").is_file() else HERE
FIRMWARE = HERE / "firmware" if SOURCE != HERE else BUILD
IMPORT = re.compile(r"""(\bfrom\s+)(['"])\./([\w-]+\.mjs)\2""")


def data_url(media, data):
    return f"data:{media};base64," + base64.b64encode(data).decode("ascii")


def script_json(value):
    return json.dumps(value, separators=(",", ":")).replace("<", "\\u003c")


def with_release_endpoint(page, endpoint):
    meta = f'<meta name="github-release-endpoint" content="{escape(endpoint, quote=True)}">'
    return page.replace("</head>", f"  {meta}\n</head>", 1)


def script_hash(source):
    return "'sha256-" + base64.b64encode(hashlib.sha256(source.encode()).digest()).decode("ascii") + "'"


def ovh_page(page, original_scripts, endpoint):
    source = subprocess.run(
        ["npx", "--yes", "esbuild@0.25.12", "app.mjs", "--bundle", "--format=esm",
         "--charset=utf8", "--log-level=warning"],
        cwd=SOURCE, check=True, capture_output=True, text=True,
    ).stdout
    if not source or "</script" in source.lower():
        raise SystemExit("The bundled JavaScript cannot be embedded as an inline script")
    page = page.replace(original_scripts, f'<script type="module">{source}</script>', 1)
    policy = (
        f"default-src 'none'; script-src {script_hash(source)}; "
        "style-src 'unsafe-inline'; img-src data: blob:; connect-src 'self' https:; "
        "base-uri 'none'; form-action 'none'"
    )
    page = page.replace("<head>", f'<head>\n  <meta http-equiv="Content-Security-Policy" content="{policy}">', 1)
    return with_release_endpoint(page, endpoint) if endpoint else page


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hosted", action="store_true", help="also build the hosted organizer and GitHub relay")
    parser.add_argument("--ovh", action="store_true", help="also build the static OVH page")
    parser.add_argument("--release-endpoint", metavar="HTTPS_URL", help="also build the OVH page with an external relay")
    args = parser.parse_args()
    if args.release_endpoint:
        url = urlsplit(args.release_endpoint)
        if url.scheme != "https" or not url.hostname or url.username or url.password or url.fragment:
            parser.error("--release-endpoint requires an HTTPS URL without credentials or a fragment")
    try:
        helper = json.loads((FIRMWARE / "helper.json").read_text(encoding="utf-8"))
        image = (FIRMWARE / "helper.bin").read_bytes()
    except FileNotFoundError:
        raise SystemExit("Build the SD helper first with python3 MenuOrganizer/build_helper.py")
    if (helper.get("target") != "rev0" or not 16 <= len(image) <= 50432
            or helper.get("bytes") != len(image) or helper.get("sha256") != hashlib.sha256(image).hexdigest()):
        raise SystemExit("The SD helper does not match its Rev0 build manifest")
    helper["data"] = base64.b64encode(image).decode("ascii")

    modules = {}
    for path in sorted(SOURCE.glob("*.mjs")):
        source = path.read_text(encoding="utf-8")
        source = IMPORT.sub(r'\1"chgame/\3"', source)
        modules["chgame/" + path.name] = data_url("text/javascript;charset=utf-8", source.encode())
    art = {path.stem: data_url("image/png", path.read_bytes()) for path in sorted((SOURCE / "assets").glob("*.png"))}
    page = (SOURCE / "index.html").read_text(encoding="utf-8")
    css = (SOURCE / "style.css").read_text(encoding="utf-8")
    import_map = script_json({"imports": modules})
    bootstrap = 'import "chgame/app.mjs";'
    page = page.replace('<link rel="stylesheet" href="style.css">', f"<style>\n{css}</style>")
    module_scripts = "\n  ".join([
        '<script type="importmap">' + import_map + "</script>",
        '<script type="module">' + bootstrap + "</script>",
    ])
    assets_script = '<script id="embedded-assets" type="application/json">' + script_json({"helper": helper, "art": art}) + "</script>"
    page = page.replace('<script type="module" src="app.mjs"></script>', assets_script + "\n  " + module_scripts)
    for name, url in art.items():
        page = page.replace(f"assets/{name}.png", url)
    output = HERE / "index.html" if SOURCE != HERE else BUILD / "CHGame-Menu-Organizer.html"
    output.write_text(page, encoding="utf-8")
    print(f"{output} ({output.stat().st_size:,} bytes)")
    if args.ovh or args.release_endpoint:
        ovh = BUILD / "ovh" / "index.html"
        ovh.parent.mkdir(parents=True, exist_ok=True)
        ovh.write_text(ovh_page(page, module_scripts, args.release_endpoint), encoding="utf-8")
        print(f"{ovh} ({ovh.stat().st_size:,} bytes)")
    if args.hosted:
        hosted = with_release_endpoint(page, "./api/github-release")
        worker = (HERE / "hosting" / "worker.mjs").read_text(encoding="utf-8")
        entry = HERE / "dist" / "server" / "index.js"
        entry.parent.mkdir(parents=True, exist_ok=True)
        entry.write_text("const page = " + script_json(hosted) + ";\n" + worker, encoding="utf-8")
        print(f"{entry} ({entry.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
