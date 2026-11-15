# Token Radar — pre-token protocols ranked by implied value

[![make.fun](https://img.shields.io/badge/make.fun-bounty-blue)](https://make.fun)
[![make.fun](https://img.shields.io/badge/built%20for-make.fun-ff6fb5)](https://make.fun/bounty/token-radar-01)
[![make.fun](https://img.shields.io/badge/competition-token--radar--01-gold)](https://make.fun/bounty/token-radar-01)

Entry for the [make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01): build the best token launch radar.

## What it is

A Node 22 program (`main.ts`, standard library only, no network) reads the sealed
DefiLlama snapshot at `/input/snapshot.json` and writes a ranked board of every
protocol that records no token, plus a static dashboard a reader can use.

## The model (radar-2)

A token that does not exist yet is priced from the market's own comparables: for
each category, the median market-cap-per-dollar-of-TVL of the protocols in that
category whose token already trades — computed from the snapshot at run time,
never hardcoded. Then three adjustments from the protocol's own record: 7-day TVL
growth, how long it has run with no token, and how many chains it runs on.

```
implied = TVL × category multiple × growth × maturity × chains
```

- **Category multiple**: median mcap/TVL among live-token protocols in the same
  category (≥3 live, else the global median), clamped to [0.02, 2.00].
- **Growth**: 7-day TVL change clamped to −50%…+100%, weighted 0.6, factor clamped
  to [0.5, 1.6].
- **Maturity**: 0.7 + 0.3 × min(age, 1095)/1095; age unknown counts as 365 days.
- **Chains**: +3% per extra chain, up to 4.

No protocol name is ever special-cased. The board covers all 40 watchlist
protocols plus every other rankable pre-token protocol below the floor (289 rows).
Live-token protocols are shown apart, at the market's own value.

## The dashboard

`dashboard/` is a static page (no framework, no network): a sortable, filterable
board; a detail view for each protocol with the model's own arithmetic and a
7-step farm plan (each step with its cost and time); a live-token view; and a
model tab with the comparables table and a sandbox that re-ranks the board live.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

It writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`
into the output directory.

## Layout

- `main.ts` — entrypoint: reads the snapshot, builds the board, writes the outputs.
- `lib/model.ts` — the model, the farm plans and the board builder.
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte.
- `dashboard/` — `index.html`, `app.css`, `app.js`.
- `screenshots/` — the board, a detail view and a filtered view.

## License

MIT — see `LICENSE`.
