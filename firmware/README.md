# SD helper firmware

`helper.bin` is the embedded Rev0 helper. The sketch in `CHSDtoSerial/` derives from [CHGame CHSDtoSerial](https://github.com/bateske/CHGame/tree/e1f8d05940ddb7bbef89c13326da75c003f02904/platform/board/arduino/CHGame/libraries/CHGame/examples/Apps/CHSDtoSerial). It uses the same journaled FAT16/FAT32 transfer protocol, with a smaller display and optional timestamp commands.

Install Arduino CLI and the [CHGame 0.3.0 board package](https://github.com/bateske/CHGame/releases/tag/v0.3.0), then run:

```sh
git clone https://github.com/bateske/CHGame.git ../CHGame
git -C ../CHGame checkout e1f8d05940ddb7bbef89c13326da75c003f02904
python3 firmware/build.py --chgame ../CHGame
python3 build_page.py
```

The build applies the linked CHGame library overrides in `sdk-overlay/` to a temporary copy. The distributed image was compiled with the macOS workspace's native RISC-V GCC toolchain. Arduino compiler builds can differ in bytes. The build rejects images that would overlap either flash save page.

The helper is GPL-3.0-or-later. FatFs carries its own notice. CHGame SDK overrides and the fallback cover artwork retain the upstream Apache-2.0 license and notice in [licenses](../licenses/).
