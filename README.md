# Fast csv-reader drop-in

[![make.fun bounty](https://img.shields.io/badge/make.fun-bounty-blue)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![csv-reader-speed-01-run-20261121](https://img.shields.io/badge/make.fun-csv--reader--speed--01--run--20261121-blue)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/steve1998pg/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/steve1998pg/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own **csv-reader 1.0.0**, built for the
[make.fun bounty "Read broken CSV files faster, 21 November 2026"](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
($100, 1st–10th place $10 each).

`run(input)` in `solve.js` returns exactly what csv-reader 1.0.0 returns for
every `{text, header}` — `{columns, rows, errors}` — including its full
broken-row policy: BOM drop, LF/CRLF record ends, blank lines are no records,
stray CRs dropped (`stray_cr`), quoted fields with doubled quotes and line
breaks inside, junk after a closing quote (`quote_junk`), quotes that never
close read again as unquoted (`unterminated_quote`), short rows padded
(`short_row`) and long rows cut (`long_row`).

## How it is faster

The reference walks the text one character at a time and builds every field
a character at a time. This reader instead:

- jumps between delimiters with `indexOf` and slices whole fields at once —
  a plain field is one slice, a quoted field with no doubled quotes and no
  line break inside is one slice;
- caches one line-end lookup per physical line (`le`): an unquoted field
  ends at the next comma before `le`, or at `le` itself, so the common field
  costs one `indexOf(',')` plus one slice;
- skips the per-field stray-CR scan on lines already known to hold no CR
  (`leClean`);
- only does segment-joining work for the rare fields that actually need it
  (doubled quotes, line breaks inside quotes, stray CRs, junk after a
  closing quote, an unterminated quote).

Pure dependency-free JavaScript, ES module, no WebAssembly, no native code,
no build step. `main.ts` is the harness driver: it turns V8's incremental
marking off (as the house baseline does), reads every case from
`/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`.

## Verification

Checked against csv-reader 1.0.0 itself (the kit's `vendor/csv-reader`):

- identical answers on all **6 practice-set cases** (10.2 MB of CSV) and on
  the kit's published `expected.json`;
- identical answers on **32 hand-built edge cases** covering every rule
  (BOM, blank lines, CRLF, stray CRs, doubled quotes, multiline quoted
  fields, quote junk, unterminated quotes, short/long rows, empty input,
  missing trailing newline);
- identical answers on **20,000 randomized fuzz inputs** (random character
  soup and structured records with broken fields).

## Speed (practice set, 6 cases, ~10.2 MB, local run)

| reader | time per set |
| --- | --- |
| csv-reader 1.0.0 (house baseline) | ~590 ms median |
| this reader | ~110 ms median |

About **5.4x faster** than the baseline on this machine (interleaved
round-robin benchmark, `--no-incremental-marking`, medians over 12 rounds).
For comparison, the house's own measurements put d3-dsv at ~1.9x and
papaparse at ~1.8x over the same baseline.

## Layout

- `solve.js` — the reader: `export function run(input)`.
- `main.ts` — the harness driver.
- `package.json` — `{"type": "module"}`.
- `LICENSE` — MIT.
