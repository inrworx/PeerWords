# PeerWords

A daily five-letter word game. You get six tries; green means the right letter in the right spot, yellow means the right letter in the wrong spot, gray means the letter is not in the word.

Every guess is scored by the PeerBelly network instead of by the page itself. Three nodes score each guess, sign their answers, and a coordinator keeps the majority result. Nodes that disagree get strikes and are quarantined.

The game is one static file, `index.html`, with no build step.

## Run it

Open `index.html` in a browser, or serve the folder:

```
npm run serve     # http://localhost:8080
```

## How a guess is scored

1. The player submits a word that is in the word list.
2. `dispatch(job)` picks three healthy nodes (fewest jobs first) and sends each the same job.
3. Each node returns a tile pattern such as `BGBYB` plus a short signature over `jobId|nodeId|pattern`.
4. The coordinator keeps the pattern that at least two nodes agree on. If the first three all differ, it asks a fourth node as a tiebreaker. If there is still no majority, it scores locally and logs the result as unsigned.
5. Any node whose pattern lost the vote gets a strike. Two strikes quarantines the node.
6. Every third job also sends a canary (a job with a known answer) to a spare node. A wrong canary answer is a strike.
7. Everything is written to the audit ledger beside the board.

Hints ("Ask Belly for a hint") go through the same quorum.

## Belly's AI clue

After the letter hint, the page also asks the real PeerBelly network for a one-line clue about the word, written by an AI model on a PeerBelly node. It uses the PeerBelly Game API (`words.generate_clue`):

1. `POST /v1/games/sessions` with `{gameId: 'peerwords'}` gets an anonymous session. The coordinator only allows this from `https://games.peerbelly.com`, and limits sessions and jobs per IP.
2. `POST /v1/inference` submits the clue job with an `Idempotency-Key`.
3. `GET /v1/jobs/{jobId}` is polled until the job finishes, for up to 12 seconds.

The clue appears under the letter hint in italics and is saved with the daily game. The coordinator rejects any clue that contains the word. If the network is busy or slow it sends a simple fallback clue, and if the API cannot be reached at all the page just shows the letter hint, as before.

The base URL is `https://api.peerbelly.com`. Set `window.PEERBELLY_API` before the game script to use another server, or to `''` to turn the clue off. A page opened from `file://` skips the clue unless `window.PEERBELLY_API` is set.

This follows the node enforcement idea in the PeerBelly blueprint: quorum agreement, canary jobs, strikes, and quarantine.

## What is simulated

The six scoring nodes run inside the page; only Belly's AI clue contacts a PeerBelly server. "Corrupt a node" makes one simulated node return tampered results so you can watch the quorum catch it.

The single place to replace with the real network is `dispatch()` in `index.html`. It needs to return `{ value, agree, total, degraded }` for a job `{ type: 'score' | 'hint', ... }`. The page does not yet define a wire format for the real network. The signatures are placeholders (FNV hash), not real cryptographic signatures.

## Deploy (PB Gaming server)

Files live in `/var/www/games/words`, served by Caddy under `/words/`, the same way as Belly Cart (`/racing/`). First time, as the admin user on the server:

```bash
git clone https://github.com/inrworx/PeerWords.git ~/peerwords
~/peerwords/deploy/deploy-words.sh
```

If `/words` is not in `/etc/caddy/Caddyfile` yet, add the block from `deploy/Caddyfile.words` inside the `games.peerbelly.com { ... }` site, then:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

Later releases: `~/peerwords/deploy/deploy-words.sh`.

## Word lists

The answer list (643 words) and the extra accepted guesses (about 1,700 words in total) are written into `index.html`. Some real words will be rejected, and plurals are mostly missing. The daily word comes from a fixed shuffle of the answer list indexed by the day number since 2026-01-01.

## Tests

```
npm install
npm test
```

- `tests/core.test.js` runs the scoring, quorum voting, tamper, and word list logic with no browser. It covers repeated-letter cases such as `speed` against `erase`.
- `tests/e2e.test.js` plays the game in headless Chromium with Playwright: typing and rejecting words, tile colors, the hint, the AI clue against a mocked Game API (including rate-limited and unreachable), winning, reload restore, stats, tamper detection and quarantine, the on-screen keyboard, and horizontal overflow at phone width.

## Files

- `index.html` the whole game (styles, script, and the logo embedded as a data URI)
- `assets/` the PeerWords logo with a transparent background
- `tests/` the two test files above
- `deploy/` the publish script and Caddy block for the PB Gaming server
