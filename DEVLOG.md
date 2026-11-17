# Token Launch Radar — DEVLOG

Competition: make.fun `token-radar-01` ("Build the best token launch radar"),
deadline 2026-12-14 10:00 UTC. Phase 1 (this log): data pipeline + board.json +
dashboard first version. Not submitted; submission is coordinated separately.

## Layout

- `main.ts` — entry point (Node 22, stdlib only). Reads the sealed snapshot,
  writes `board.json` + `data.js`, copies `dashboard/` and `screenshots/`,
  writes `dossier.json` via `vendor/makefun-board.ts` when ≥3 screenshots exist.
- `lib/model.ts` — the whole model: screen, peer multiples, adjustments, farm
  plans, theses, board assembly, gate-shape self-check (`boardIssue`).
- `vendor/makefun-board.ts` — the kit's library, byte for byte (required).
- `dashboard/` — `index.html` + `app.css` + `app.js`, static, offline, dark.
  Total source 23,404 bytes (dossier text cap is 65,536).
- Run: `MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json`

## Data口径 (snapshot facts, nothing fetched live)

- Source: kit `input/snapshot.json` only — DefiLlama `/protocols` frozen at
  2026-11-14T01:18:33Z, `as_of` 2026-11-14, floor $50,000,000.
- 758 protocols ≥ $5M TVL; 342 record no token (gecko_id, symbol, mcap all
  null); house watchlist = 40 slugs.
- Language discipline: rows "record no token" in this record. The snapshot is
  DefiLlama's record, not proof that no token exists anywhere.

## 筛选规则 (screen) — `screenReason` in lib/model.ts

Candidate = records no token AND passes R1–R5. Watchlist slugs are asserted
into the board unconditionally (coverage is a gate row; the house list already
applied its own screen). Result on this snapshot: 196 kept, 146 excluded.

- R1 (129 hits): category ∈ {Bridge, Canonical Bridge, Cross Chain Bridge,
  Liquid Staking, Liquid Restaking, Restaked BTC, CEX} — a product of an
  underlying asset or an exchange balance sheet, not a launch candidate.
  Examples: WBTC ($7.91B, Bridge), Binance staked ETH ($7.45B, Liquid
  Staking), USDT0 ($3.57B, Bridge), Bybit ($13.82B, CEX), Circle Gateway
  (Cross Chain Bridge — one category beyond the house rule's list).
- R2 (5 hits): whole word `wrapped|staked|staking` in the name.
- R4 (11 hits): name ends in a version marker (`V2`, `2.0`, …) — a deployment
  of another protocol.
- R5 (1 hit): name is a settlement ticker + one letter — USDCx, a wrapped
  USDC unit.
- R3 (0 hits on this snapshot): name begins with an exchange name. Kept as a
  guard; on this snapshot every such name is already caught by R1/R2 first
  (e.g. "Binance staked ETH" → R1). Rule order matters and is documented in
  the code.
- Kept-but-flagged: names that look like yield-bearing asset units
  (`assetUnitRisk`: Avant avUSD, Avant avETH on this snapshot) stay on the
  board with a visible "asset unit?" badge and a caution in the detail view —
  the implied value prices the issuer; if the unit itself is the product, the
  row should be discounted. Deliberately not silently dropped: the snapshot
  alone cannot prove they are wrappers.

## 估值模型 (implied value) — all parameters stated, all computed at run time

`implied = TVL × peer_multiple × growth × maturity × breadth`, rounded, ≥ $1.

- Peer multiple: median mcap/TVL of the snapshot's own token-bearing
  protocols (129 comps; global median 0.2049×). Category median when the
  category has ≥3 comps, shrunk toward the family median with weight
  n/(n+6); otherwise the family median (families: Lending & credit /
  Trading & markets / Yield & allocation / Real-world assets / Staking /
  Other), itself shrunk toward the global median the same way. No multiple
  is hardcoded: change the snapshot and every multiple moves.
  Category medians on this snapshot (raw): Dexs 0.342 (n=11), Lending 0.132
  (n=15), Yield 0.180 (n=10), RWA 0.275 (n=9), Basis Trading 0.654 (n=7),
  CDP 0.169 (n=3). Risk Curators / Onchain Capital Allocator — 52 board rows
  between them — have no direct comps and price off the Yield & allocation
  family (shrunk multiple 0.183×).
- Growth: clamp(change_7d, −40%, +80%) × 0.30 → multiplier in [0.88, 1.24];
  null change_7d → 1.00 (2 of 196 rows).
- Maturity: 0.80 + 0.40×(1 − e^(−age/720)), age = days from `listed_at` to
  `as_of`; unknown age (7 rows) → 1.00 neutral.
- Breadth: 1 + 0.015 × min(chains − 1, 6) → [1.00, 1.09].
- Rank is strictly by implied value (ties: TVL desc, slug asc). Conviction
  (0–100: size/momentum/track record/watchlist) is display-only and never
  changes a rank — stated on the Method tab so the judge can see the choice.
- Sanity: board implied values run $0.7M … $553M; #1 Steakhouse Financial
  ($2.75B TVL × 0.183 family × growth/maturity/breadth ≈ $553M). No row is
  name-special-cased anywhere in the code.

## Farm plans

Six steps per row (`farmSteps`), generated from the row's own record:
dedicated wallet → category core action (lending supply/borrow-repay, DEX
flow, vault deposit, RWA mint, staking) with capital by TVL tier
($50/$100/$150/$250/$500) and gas by first chain (Ethereum ≈ $12, else ≈ $3)
→ weekly qualifying action → hold 30/45/60 days by age → points-page check
with an explicit "a claim fee demand is a scam signal" step → farm log and
unwind rule. Every step carries cost + time and is asserted to sit inside
the gate's 20–600 characters by `boardIssue` before anything is written.

## Phase-1 verification (all run locally, 2026-11-17)

- `node main.ts` on the sealed snapshot: 196 rows, watchlist 40/40 covered.
- Independent re-check of board.json in Python: ranks exactly 1..N, implied
  non-increasing with rank, all farm steps 3–12 × 20–600 chars, implied
  values not all equal, every slug in the snapshot.
- Determinism: two runs → identical md5 for board.json and data.js.
- Dashboard: `node --check` passes; no `http://`/`https://` anywhere in
  dashboard files; served `out/` via `python3 -m http.server` — index/css/js
  and `../data.js` all 200; data.js parses, `window.RADAR` = 196 rows +
  48 live comps.
- Known gap: no headless browser exists on this machine, so the page has not
  yet been rendered to pixels here. Visual QA happens in phase 2 with the
  screenshots (the rules require a browser for them anyway).

## 已知弱点 (known weaknesses)

1. Category medians are noisy where comps are few or dispersed (Lending
   p25–p75 spans 0.03–1.03). Shrinkage bounds the damage but the multiple is
   still the model's softest input; the detail view shows comp count and
   scope so a reader can discount thin categories.
2. mcap is the only value figure the snapshot carries — no FDV, no supply,
   no revenue/fees. Implied value is therefore "what the market cap would be
   if peers' mcap/TVL held", nothing more; the Method tab says so.
3. The screen cannot see `parentProtocol` (not one of the ten fields), so a
   wrapped product with a clean name and a non-derivative category can pass
   (the avUSD/avETH flag is a heuristic patch, not a proof).
4. Risk Curators / capital allocators are the board's top by TVL; whether a
   curator "launches a token" the way a protocol does is arguable. They are
   real DefiLlama protocols recording no token, so they stay — flagged only
   by their category, which the dashboard shows.
5. `listed_at` in the snapshot occasionally post-dates reality or is null;
   age is clamped at 0 and unknown age is neutral, so bad dates can only
   mute the maturity factor, never inflate it.
6. Farm plans are category templates parameterised by the row's figures —
   concrete on cost/time/capital, but they cannot know a protocol's actual
   points programme (the snapshot carries none). Step 5 is written to route
   the reader to the protocol's own page for exactly that reason.

## 下一阶段清单 (phase 2)

- [ ] Screenshots: render `out/dashboard/` in a real browser at ≤1440px long
      side, ≥800px short side, 300–350 KB each: `1-board.png` (board),
      `2-detail.png` (a top protocol's detail drawer), `3-filtered.png`
      (a filtered view, e.g. watchlist-only or one category). Put them in
      `screenshots/` so main.ts writes `dossier.json`.
- [ ] Re-run main.ts with screenshots present; verify dossier.json is
      produced and ≤1.5 MiB, dashboard text ≤65,536 bytes (currently
      23,404 — headroom is fine, keep it that way).
- [ ] Run the kit's pre-submit check (`node cli/makefun.mjs check --kit .
      --repo <repo> --transcripts transcripts.tar.gz`) once transcripts are
      bundled; fix whatever it names.
- [ ] Decide GitHub repo vs source bundle with the coordinator; if GitHub,
      add `.makefun/owner.json` with the account wallet in the first commit.
- [ ] Polish candidates if time allows: comp table per category on the
      Method tab; a "why this rank" sparkline of the four factors in the
      table itself; revisit the asset-unit heuristic against any new names.
- [ ] Submit (≤5/day, ≤10 total; last submission before 2026-12-14 10:00
      UTC is the final entry).

## Phase-2 progress (2026-11-17)

- [x] Screenshots: no system browser existed on this machine, so a
      Playwright Chromium headless shell was fetched into the user cache
      (~287 MB, `npx playwright install --only-shell chromium`) and drove
      the locally served `out/` at a 1440×900 viewport:
      `screenshots/1-board.png` (169,937 B), `2-detail.png` (236,321 B —
      the #1 row's detail drawer), `3-filtered.png` (171,753 B —
      watchlist-only filter, "40 of 196"). All three are whole PNGs,
      1440×900 (long side at the 1440 cap, short side above the 800
      floor), each well under the 512 KiB cap and under the 300–350 KB
      the dossier budget wants. All three were eyeballed after capture:
      board, drawer and filtered view render as intended.
- [x] Re-ran main.ts: `out/dossier.json` written, 795,461 bytes (cap
      1.5 MiB). Verified three ways: (a) rebuilding with the gate's own
      call, `buildDossier(out, {text_max_bytes: 65536})`, reproduces it
      byte for byte; (b) a second full run of main.ts writes identical
      board.json, data.js and dossier.json (the grader runs it twice);
      (c) the dossier's text is 23,669 of 65,536 bytes with no file cut.
- [x] Board re-validated independently (Python, against the gate's seven
      rows): 196 rows, ranks exactly 1..N, implied non-increasing with
      rank and not all equal ($742,105 … $552,906,033), every slug in the
      snapshot, watchlist 40/40, every farm_steps 3–12 strings of
      20–600 trimmed chars, board.json 390,898 B (cap 8 MiB); dashboard
      files carry no http(s) address anywhere.
- [x] Kit check (`node cli/makefun.mjs check --kit . --repo .`): passes
      competition_open, snapshot, entrypoint. Two failures found and one
      fixed: `license_osi` — the root LICENSE now carries an
      `SPDX-License-Identifier: MIT` line above the MIT text;
      `transcripts_present` — still open by design: bundling happens at
      submission time under the coordinator's clean-session protocol
      (only the build sessions for this entry, no instruction files,
      content inspected before anything is sent). The remaining
      transcript checks skip until a bundle exists; repo_public /
      repo_owner / repo_created_after_open / commit_in_repo /
      duplicate_snapshot are checked by the site at submission.
- [x] `.makefun/owner.json` added (the account's entry wallet) and a
      README.md built on the competition's official template (three live
      badges, run command, method summary).
- Still open for the submission step: create the public GitHub repo
  (after the 2026-11-14 opening — any new repo qualifies), push, set its
  About (homepage https://make.fun/bounty/token-radar-01, topics
  makefun / ai-agents / bounties / trading), bundle the transcripts,
  re-run check with `--transcripts`, then submit before 2026-12-14
  10:00 UTC.
