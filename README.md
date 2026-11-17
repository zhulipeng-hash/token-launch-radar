# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zhulipeng-hash/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zhulipeng-hash/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar built on the competition's sealed DefiLlama snapshot (758 protocols, frozen 2026-11-14). The program screens the 342 protocols that record no token down to genuine launch candidates — five rules exclude wrapped, staked, bridged and exchange products of tokens that already trade (WBTC, Binance staked ETH and USDT0 among them) — then ranks the surviving 196 by an implied launch value: TVL × a peer market-cap/TVL multiple taken from the snapshot's own token-bearing protocols (category median shrunk toward family and global medians by comp count) × growth × maturity × breadth factors. Every row carries a six-step farm plan with concrete capital, gas and time figures, and the whole watchlist of 40 is covered. The dashboard is a static, offline page: the ranked board with search and filters, a per-protocol detail view showing the model's factor breakdown and its live peer comps, and a method page that states every rule and parameter. No protocol name is special-cased anywhere; change the snapshot and every number moves. See `DEVLOG.md` for the full model, its parameters and its known weaknesses.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

In the grading container the snapshot is mounted at `/input`, so `node main.ts` alone suffices. The run writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory, deterministically — the same snapshot bytes give the same output bytes.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
