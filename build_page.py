"""Build one offline HTML file from the organizer's browser modules and helper."""

import base64
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "src"
BUILD = HERE / "firmware"
IMPORT = re.compile(r"""(\bfrom\s+)(['"])\./([\w-]+\.mjs)\2""")


def data_url(media, data):
    return f"data:{media};base64," + base64.b64encode(data).decode("ascii")


def script_json(value):
    return json.dumps(value, separators=(",", ":")).replace("<", "\\u003c")


def main():
    try:
        helper = json.loads((BUILD / "helper.json").read_text(encoding="utf-8"))
        image = (BUILD / "helper.bin").read_bytes()
    except FileNotFoundError:
        raise SystemExit("Build the SD helper first with python3 firmware/build.py")
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
    page = page.replace('<link rel="stylesheet" href="style.css">', f"<style>\n{css}</style>")
    page = page.replace('<script type="module" src="app.mjs"></script>', "\n  ".join([
        '<script id="embedded-assets" type="application/json">' + script_json({"helper": helper, "art": art}) + "</script>",
        '<script type="importmap">' + script_json({"imports": modules}) + "</script>",
        '<script type="module">import "chgame/app.mjs";</script>',
    ]))
    for name, url in art.items():
        page = page.replace(f"assets/{name}.png", url)
    output = HERE / "index.html"
    output.write_text(page, encoding="utf-8")
    print(f"{output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
