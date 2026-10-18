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

This follows the node enforcement idea in the PeerBelly blueprint: quorum agreement, canary jobs, strikes, and quarantine.

## What is simulated

The six nodes run inside the page, so no PeerBelly server is contacted. "Corrupt a node" makes one simulated node return tampered results so you can watch the quorum catch it.

The single place to replace with the real network is `dispatch()` in `index.html`. It needs to return `{ value, agree, total, degraded }` for a job `{ type: 'score' | 'hint', ... }`. The page does not yet define a wire format for the real network. The signatures are placeholders (FNV hash), not real cryptographic signatures.

## Word lists

The answer list (643 words) and the extra accepted guesses (about 1,700 words in total) are written into `index.html`. Some real words will be rejected, and plurals are mostly missing. The daily word comes from a fixed shuffle of the answer list indexed by the day number since 2026-01-01.

## Tests

```
npm install
npm test
```

- `tests/core.test.js` runs the scoring, quorum voting, tamper, and word list logic with no browser. It covers repeated-letter cases such as `speed` against `erase`.
- `tests/e2e.test.js` plays the game in headless Chromium with Playwright: typing and rejecting words, tile colors, the hint, winning, reload restore, stats, tamper detection and quarantine, the on-screen keyboard, and horizontal overflow at phone width.

## Files

- `index.html` the whole game (styles, script, and the logo embedded as a data URI)
- `assets/` the PeerWords logo with a transparent background
- `tests/` the two test files above
