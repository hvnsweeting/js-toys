# Jigsaw 🧩

A browser puzzle with 20 paintings and your own photos.

## How to play

Choose 32, 64, or 128 pieces at the top, then tap a picture to start. Drag pieces onto the board or
join neighbours on the table. Pinch or use the zoom controls to get closer. Edges gathers border
pieces; Guide shows a faint picture; Peek briefly shows the puzzle crop. Progress is saved after
drops so you can continue later.

The replace prompt appears after piece moves or a helper action; bringing a piece forward without
moving it does not count as progress.

If browser storage rejects an update, the game warns that progress cannot be saved. The previous
save stays available after a reload. If clearing a finished puzzle's save fails, that puzzle may
also appear as Continue after a reload.

For your own photo, choose an image, move and zoom the crop, then start. The photo remains on your device.

## Music and sound

The upbeat chiptune background piece plays after your first tap or click. It moves at 116 beats per minute
through C major, G sixth, A minor seventh, F sixth, C major, D minor seventh, G sixth, and returns to C major.
Bouncy square-wave chiptune arpeggios, punchy triangle chip bass with phone-friendly harmonics, warm pad backing,
and a lively square-wave lead melody with playful pitch attack blips share a 32 bar phrase. Seeded voicings, melody
choices, and instrument entries vary across its four passes. Music mutes only the background piece; Sound mutes both
music and puzzle effects. Each choice is remembered. The music fades when the page is hidden and returns when it is
visible again.

## Development

Run `make serve` from this folder and open `http://127.0.0.1:8097/jigsaw/`.
For LAN play, run `HOST=0.0.0.0 PORT=8091 node tools/serve.mjs`, then open
`http://<computer-address>:8091/jigsaw/` on a phone or iPad.

Run `make test` for game rules, offline files, and server path tests. After changing a stored
file, run `node tools/stamp-sw.mjs` to update the offline hashes. Start the server on a spare
port, then run `make check BASE_URL=http://127.0.0.1:<port>/jigsaw/` for browser checks.
The check also renders a 30 second music sample and checks music and effect levels. It uses system
Chromium without npm, writes screenshots to `shots/`, and writes audio and level measurements to
`.scratch/`. The git-ignored `shots/` folder is replaced on each run by design.

## Architecture

`js/core.js` has pure grid, shape, scatter, interaction, view, and save rules. `js/render.js` draws
cached piece images and the canvas table. `js/app.js` handles the screens, pointer input, audio, and
local storage. `js/musicScore.js` defines the score, `js/music.js` plays it, and `js/effects.js`
plays puzzle sounds. `tools/music-render.mjs` writes an audio sample and level measurements under
`.scratch/`. `tools/serve.mjs` serves static files for local play. Production needs only the static
game files and pictures.

Painting sources and artist details are in [Picture credits](pictures/CREDITS.md).

## Install it as an app

On iPad, visit Jigsaw over HTTPS in Safari, tap Share, then Add to Home Screen. Open the new icon
once with internet and wait for the "Ready to play offline" note on the picture chooser. The
installed app has separate storage from Safari.
On desktop Chrome or Edge, use the browser's install button in the address bar. Installation and
offline play require HTTPS or localhost; ordinary LAN HTTP play still works while connected.

After an online visit, the app stores the page, every painting, and all game code. Your own photo
stays in IndexedDB on your device. When an update is available, the next online launch downloads
and checks its files; the following launch uses it. A failed file check keeps the older copy.
iPadOS may remove stored files when storage is low or after long disuse; open the icon online again
if that happens.

The puzzle icon is Google's Noto Emoji puzzle piece (U+1F9E9) from release
`v2026-09-24-unicode18_0`: [source SVG](https://github.com/googlefonts/noto-emoji/blob/v2026-09-24-unicode18_0/2D/svg/emoji_u1f9e9.svg)
and [license](https://github.com/googlefonts/noto-emoji/blob/v2026-09-24-unicode18_0/2D/svg/LICENSE),
Apache License 2.0. Their SHA-256 hashes are in `vendor/CHECKSUMS.txt`.
