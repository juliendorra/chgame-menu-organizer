# CHGame Menu Organizer

Manage the games, covers, and categories on a CHGame SD card over USB.

1. Download [index.html](https://raw.githubusercontent.com/juliendorra/chgame-menu-organizer/main/index.html) and open it in desktop Chrome or Edge.
2. Click **Connect CHGame**. Reorder, move, or remove carts, then click **Save to SD**.
3. Drop a `.chgame` file to import its games and SD assets.

Link to a cart with `#import=<encoded HTTPS URL>` or `?import=<encoded HTTPS URL>`. The file host must allow cross-origin downloads.

Runs locally in your browser with no server. To rebuild the page, run `python3 build_page.py`. See [firmware](firmware/README.md) for the USB helper source.
