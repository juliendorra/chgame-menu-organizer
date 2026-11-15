"""Build the Rev0 SD helper with Arduino CLI and a CHGame SDK source checkout."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chgame", type=Path, required=True)
    args = parser.parse_args()
    libraries = args.chgame.resolve() / "platform/board/arduino/CHGame/libraries"
    with tempfile.TemporaryDirectory(prefix="chgame-sd-helper-") as tmp:
        temp = Path(tmp)
        game = temp / "CHGame"
        sdk_game = libraries / "CHGame"
        shutil.copytree(sdk_game / "src", game / "src")
        shutil.copy2(sdk_game / "library.properties", game)
        for source in (HERE / "sdk-overlay").glob("*"):
            shutil.copy2(source, game / "src/chgame" / source.name)
        out = temp / "compiled"
        subprocess.run([
            "arduino-cli", "compile", "-b", "CHGame:ch32v:rev0:opt=oslto,rtlib=nano,periph=game,usb=serial",
            "--build-property", "build.extra_flags=-DGFX_CHUNK_ROWS=1 -DCHSAVE_MAX_SLOT_SECTORS=1",
            "--library", str(libraries / "CHGfx"), "--library", str(game),
            "--library", str(libraries / "CHSd"), "--build-path", str(out), str(HERE / "CHSDtoSerial"),
        ], check=True)
        image = (out / "CHSDtoSerial.ino.bin").read_bytes()
    if not 16 <= len(image) <= 50432:
        raise SystemExit("Invalid helper size or image overlaps flash save pages")
    (HERE / "helper.bin").write_bytes(image)
    (HERE / "helper.json").write_text(json.dumps({
        "target": "rev0", "bytes": len(image), "sha256": hashlib.sha256(image).hexdigest(), "timestamps": True,
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
