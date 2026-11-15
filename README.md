# CHGame Menu Organizer

Manage the games, covers, and categories on a CHGame SD card over USB.

1. Open the [web organizer](https://juliendorra.com/chgame-menu-organizer/) in desktop Chrome or Edge, or download [index.html](https://raw.githubusercontent.com/juliendorra/chgame-menu-organizer/main/index.html).
2. Click **Connect CHGame**. Reorder, move, or remove carts, then click **Save to SD**.
3. Drop a `.chgame` file to preview its cover, games, and SD assets. Choose **Install to SD** to write it to the card.

Link to a cart with `#import=<encoded HTTPS URL>` or `?import=<encoded HTTPS URL>`. The file host must allow cross-origin downloads, or the hosted organizer must have a GitHub release relay configured.

Runs locally in your browser with no server. To rebuild the page, run `python3 build_page.py`. See [firmware](firmware/README.md) for the USB helper source.
