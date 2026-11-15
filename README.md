# CHGame Menu Organizer

Manage the games, covers, and categories on a CHGame SD card over USB.

1. Open the [web organizer](https://juliendorra.com/chgame-menu-organizer/) in desktop Chrome or Edge, or download [index.html](https://raw.githubusercontent.com/juliendorra/chgame-menu-organizer/main/index.html).
2. Click **Connect CHGame**. Reorder, move, or remove carts, then click **Save to SD**.
3. Drop a `.chgame` file to preview its cover, games, and SD assets. Choose **Install to SD** to write it to the card.

Link to a cart with `#import=<encoded HTTPS URL>` or `?import=<encoded HTTPS URL>`. The file host must allow cross-origin downloads, or the hosted organizer must have a GitHub release relay configured.

The hosted organizer also accepts a GitHub repository's `/releases/latest` URL when that release has one `.chgame` asset. [Preview the latest Midnight Pinball release](https://juliendorra.com/chgame-menu-organizer/#import=https%3A%2F%2Fgithub.com%2Fjuliendorra%2Fchgame-pinball%2Freleases%2Flatest).

Runs locally in your browser with no server. To rebuild the page, run `python3 build_page.py`. See [firmware](firmware/README.md) for the USB helper source.

The [relay deployment workflow](.github/workflows/deploy-worker.yml) runs on changes to the two relay modules on `main`. It uses the `CLOUDFLARE_WORKER_DEPLOY_TOKEN` Actions secret with Editor access to `chgame-release-relay` and the `CLOUDFLARE_ACCOUNT_ID` and `RELEASE_RELAY_URL` repository variables.
