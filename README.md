# CHGame Menu Organizer

Manage the games, covers, and categories on a CHGame SD card over USB.

CHGame Menu Organizer is an alternative interface for the SD card workflow in Kevin Bates’s [official CHGame web tools](https://play.chgame.website/). The official Cart Builder already scans and edits the collection on the device. This interface opens directly on the console’s menu and uses game and category covers to arrange it.

1. Open the [web organizer](https://juliendorra.com/chgame-menu-organizer/) in desktop Chrome or Edge, or download [index.html](https://raw.githubusercontent.com/juliendorra/chgame-menu-organizer/main/index.html).
2. Click **Connect CHGame**. Reorder, move, or remove carts, then click **Save to SD**.
3. Drop a `.chgame` file to preview its cover, games, and SD assets. Choose **Install to SD** to write it to the card.

Link to a cart with `#import=<encoded HTTPS URL>` or `?import=<encoded HTTPS URL>`. The file host must allow cross-origin downloads, or the hosted organizer must have a GitHub release relay configured.

The hosted organizer also accepts a GitHub repository's `/releases/latest` URL when that release has one `.chgame` asset. [Preview the latest Midnight Pinball release](https://juliendorra.com/chgame-menu-organizer/#import=https%3A%2F%2Fgithub.com%2Fjuliendorra%2Fchgame-pinball%2Freleases%2Flatest).

Runs locally in your browser with no server. To rebuild the page, run `python3 build_page.py`. See [firmware](firmware/README.md) for the USB helper source.

## Credits and upstream code

- **SD helper.** The Organizer ships a modified build of Kevin Bates’s [CHSDtoSerial](https://github.com/bateske/CHGame/tree/e1f8d05940ddb7bbef89c13326da75c003f02904/platform/board/arduino/CHGame/libraries/CHGame/examples/Apps/CHSDtoSerial), originally written for the official website and released in the CHGame board package. The [vendored source](firmware/CHSDtoSerial/) includes 13 unchanged source and configuration files, including the SD driver and FatFs. The Organizer modifies `transfer.c` and `ffconf.h` for timestamp support and replaces `Display.cpp` with a compact status display. See the [build notes](firmware/README.md), [helper GPL license](firmware/CHSDtoSerial/LICENSE), and [FatFs license](firmware/CHSDtoSerial/FatFs-LICENSE.txt).
- **Browser connection.** The browser uses CHGame’s documented bootloader and SD helper protocols. The Organizer’s reconnect flow was informed by [Pinball Studio’s reconnect work](https://github.com/juliendorra/chgame-pinball/commit/0c965be), which used the official CHGame Device page as a reference.
- **SDK and assets.** The [SDK overrides](firmware/sdk-overlay/) build on the CHGame SDK. The three [fallback images](src/assets/) and both [test fixtures](tests/fixtures/) come from the public [CHGame repository](https://github.com/bateske/CHGame). See the [upstream copyright notice](licenses/CHGame-NOTICE.txt) and the [Apache 2.0 license](licenses/CHGame-Apache-2.0.txt) for the SDK overrides and fallback artwork.

The [relay deployment workflow](.github/workflows/deploy-worker.yml) runs on changes to the two relay modules on `main`. It uses the `CLOUDFLARE_WORKER_DEPLOY_TOKEN` Actions secret with Editor access to `chgame-release-relay` and the `CLOUDFLARE_ACCOUNT_ID` and `RELEASE_RELAY_URL` repository variables.
