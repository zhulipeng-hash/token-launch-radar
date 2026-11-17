// Token Launch Radar — model.
//
// One sealed DefiLlama snapshot in, one ranked board out. Nothing here is a
// hand-kept list of names: the screen, the valuation multiples and the farm
// plans are all derived from the snapshot's own ten fields at run time, so the
// same program re-run on a future snapshot finds launches that do not exist
// yet today.
//
// Pipeline:
//   1. Screen  — a protocol is a candidate when it records no token (gecko_id,
//      symbol and mcap_usd all null) and is not a wrapped, staked, bridged or
//      exchange product of something that already trades (rules R1–R7 in
//      screenReason). The house watchlist is a floor: every watchlist slug is
//      asserted into the board, never filtered out by our own screen.
//   2. Value   — implied_value = TVL x peer multiple x growth x maturity x
//      breadth. The peer multiple is the median market-cap/TVL ratio of the
//      snapshot's own token-bearing protocols in the same category, shrunk
//      toward the family median and then the global median by comp count, so
//      thin categories borrow strength instead of inventing a number.
//   3. Plan    — six farm steps per protocol, generated from its category,
//      first chain, TVL tier and age, each carrying a cost and a time.
//
// Language discipline (per the brief): a protocol "records no token" in this
// snapshot. That is a statement about DefiLlama's record, not proof that no
// token exists anywhere.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/* ------------------------------- screen ------------------------------- */

/** Categories that are a product of an underlying asset, not a protocol awaiting its own launch. */
const DERIVATIVE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPER_WORD = /\b(wrapped|staked|staking)\b/i;
/** A bare settlement-asset ticker with a one-letter wrapper suffix or prefix, e.g. USDCx. */
const TICKER_WRAPPER = /^(USDC|USDT|DAI|ETH|BTC|SOL)[a-z]$|^[a-z](USDC|USDT|DAI|ETH|BTC|SOL)$/;

/** Whether the snapshot records a token for this protocol. */
export function recordsToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
}

/**
 * Why a no-token protocol is excluded as a derivative of a traded token, or
 * null when it passes the screen. Rules, in order:
 *  R1 category is a bridge / liquid (re)staking / exchange category;
 *  R2 name carries the whole word wrapped, staked or staking;
 *  R3 name begins with an exchange's name (its house product);
 *  R4 name ends in a version marker (a deployment of another protocol);
 *  R5 name is a settlement ticker plus one letter (a wrapped asset unit).
 */
export function screenReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return `R1 derivative category (${p.category})`;
  if (WRAPPER_WORD.test(p.name)) return 'R2 wrapper word in name';
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return 'R3 exchange house product';
  if (VERSION_SUFFIX.test(p.name)) return 'R4 versioned deployment';
  if (TICKER_WRAPPER.test(p.name.replace(/\s+/g, ''))) return 'R5 ticker wrapper unit';
  return null;
}

/** Names that look like a yield-bearing asset unit rather than an issuer; kept, but flagged on the row. */
const ASSET_UNIT_NAME = /(^|\s)(av[A-Z]{2,}|[A-Z]{1,3}?(Y[A-Z]{3,4}|FIUSD|ftUSD|thUSD))(\s|$)/;

export function assetUnitRisk(p: SnapshotProtocol): boolean {
  return ASSET_UNIT_NAME.test(p.name) || /^(Y[A-Z]{3,4}|av[A-Z]{2,})$/.test(p.name.replace(/\s+/g, ''));
}

/* ------------------------------ families ------------------------------ */

const FAMILY_OF: Record<string, string> = {
  'Lending': 'Lending & credit',
  'CDP': 'Lending & credit',
  'CDP Manager': 'Lending & credit',
  'Collateral Markets': 'Lending & credit',
  'Dexs': 'Trading & markets',
  'Derivatives': 'Trading & markets',
  'Prediction Market': 'Trading & markets',
  'Liquidity Manager': 'Trading & markets',
  'Basis Trading': 'Trading & markets',
  'Yield': 'Yield & allocation',
  'Yield Aggregator': 'Yield & allocation',
  'Risk Curators': 'Yield & allocation',
  'Onchain Capital Allocator': 'Yield & allocation',
  'Leveraged Farming': 'Yield & allocation',
  'Farm': 'Yield & allocation',
  'RWA': 'Real-world assets',
  'Staking Pool': 'Staking',
  'Restaking': 'Staking',
  'Staking': 'Staking',
};

export function familyOf(category: string | null): string {
  if (category === null) return 'Other';
  return FAMILY_OF[category] ?? 'Other';
}

/* ------------------------------ valuation ----------------------------- */

export interface MultipleBook {
  globalMedian: number;
  globalCount: number;
  byCategory: Map<string, { median: number; n: number }>;
  byFamily: Map<string, { median: number; n: number }>;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Median mcap/TVL of every token-bearing protocol in the snapshot, by category and by family. */
export function buildMultipleBook(protocols: SnapshotProtocol[]): MultipleBook {
  const ratios: { p: SnapshotProtocol; r: number }[] = [];
  for (const p of protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) ratios.push({ p, r: p.mcap_usd / p.tvl_usd });
  }
  const byCategory = new Map<string, { median: number; n: number }>();
  const byFamily = new Map<string, { median: number; n: number }>();
  const group = (key: (p: SnapshotProtocol) => string | null, into: Map<string, { median: number; n: number }>) => {
    const buckets = new Map<string, number[]>();
    for (const { p, r } of ratios) {
      const k = key(p);
      if (k === null) continue;
      const arr = buckets.get(k) ?? [];
      arr.push(r);
      buckets.set(k, arr);
    }
    for (const [k, arr] of buckets) into.set(k, { median: median(arr), n: arr.length });
  };
  group((p) => p.category, byCategory);
  group((p) => familyOf(p.category), byFamily);
  return {
    globalMedian: ratios.length > 0 ? median(ratios.map((x) => x.r)) : 0.2,
    globalCount: ratios.length,
    byCategory,
    byFamily,
  };
}

/** Shrinkage: a median from n comps is blended with its fallback, weight n/(n+K). */
const SHRINK_K = 6;

export interface MultiplePick {
  multiple: number;
  scope: 'category' | 'family' | 'global';
  compCount: number;
  rawMedian: number;
}

/** The peer multiple for one protocol: category median if it has comps, else family, else global. */
export function pickMultiple(book: MultipleBook, p: SnapshotProtocol): MultiplePick {
  const fam = book.byFamily.get(familyOf(p.category));
  const familyLevel = fam !== undefined ? (fam.n * fam.median + SHRINK_K * book.globalMedian) / (fam.n + SHRINK_K) : book.globalMedian;
  const cat = p.category === null ? undefined : book.byCategory.get(p.category);
  if (cat !== undefined && cat.n >= 3) {
    return {
      multiple: (cat.n * cat.median + SHRINK_K * familyLevel) / (cat.n + SHRINK_K),
      scope: 'category',
      compCount: cat.n,
      rawMedian: cat.median,
    };
  }
  if (fam !== undefined && fam.n >= 3) {
    return { multiple: familyLevel, scope: 'family', compCount: fam.n, rawMedian: fam.median };
  }
  return { multiple: book.globalMedian, scope: 'global', compCount: book.globalCount, rawMedian: book.globalMedian };
}

/* ------------------------------ adjustments ---------------------------- */

const DAY_MS = 86_400_000;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** 7-day TVL momentum: clamped to [-40%, +80%], weighted 0.30, so one hot week moves value by at most +24%. */
export function growthMultiplier(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 1;
  const g = Math.min(80, Math.max(-40, change7d));
  return 1 + 0.3 * (g / 100);
}

/** Track record with no token: saturating bonus from 0.80 (brand new) toward ~1.20 (3+ years). Unknown age is neutral. */
export function maturityMultiplier(age: number | null): number {
  if (age === null) return 1;
  return 0.8 + 0.4 * (1 - Math.exp(-age / 720));
}

/** Multi-chain presence: +1.5% per extra chain, capped at six extra chains. */
export function breadthMultiplier(chainCount: number): number {
  return 1 + 0.015 * Math.min(Math.max(chainCount - 1, 0), 6);
}

/* ------------------------------ farm plans ----------------------------- */

function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

function gasFor(chain: string): string {
  return chain === 'Ethereum' ? 'about $12 of gas on Ethereum' : 'about $3 of gas';
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 540) return 45;
  return 30;
}

/** The one core action per category family, in words a farmer can execute. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const fam = familyOf(p.category);
  const n = p.name;
  switch (fam) {
    case 'Lending & credit':
      return `Supply $${capital} of USDC to ${n} on ${chain}; if it supports borrowing, draw one small loan against it and repay it a week later so both sides of the market see the wallet.`;
    case 'Trading & markets':
      return `Fund $${capital} on ${n} via ${chain} and place real flow through it: swaps or one small hedged position, sized like a user rather than a wash loop.`;
    case 'Yield & allocation':
      return `Deposit $${capital} of USDC into a flagship ${n} vault on ${chain} and keep the vault shares in the same wallet for the whole holding period.`;
    case 'Real-world assets':
      return `Mint or buy $${capital} of the ${n} yield asset on ${chain} through its own app and hold it; keep the mint receipt and the position visible in one wallet.`;
    case 'Staking':
      return `Stake $${capital} of the base asset through ${n} on ${chain} and keep the staking position (and any receipt token) untouched in the farming wallet.`;
    default:
      return `Deposit $${capital} of USDC into ${n} on ${chain} through its main app flow and keep the position open; use the product the way its own docs describe for a first user.`;
  }
}

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One step as a single board string, guaranteed inside the gate's 20–600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep records of the position.`;
  return s;
}

/** Six concrete steps per protocol, derived only from its snapshot record. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Create a dedicated farming wallet for ${p.name}; fund it only with the $${capital} position plus gas, and store its seed phrase offline.`,
      cost: 'no fee beyond the first funding transfer',
      time: '10 minutes',
    },
    {
      text: coreAction(p, capital, chain),
      cost: `$${capital} of capital plus ${gasFor(chain)}`,
      time: '20 minutes to set up',
    },
    {
      text: `Repeat one small qualifying action every week (a top-up, a swap, a borrow-repay cycle or a vault re-deposit) so the wallet shows sustained use, not a one-day spike.`,
      cost: 'about $2 of gas per weekly action',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, spanning more than one weekly snapshot, and do not split it across wallets mid-period.`,
      cost: `the $${capital} stays deployed and bears the protocol's smart-contract risk`,
      time: `${hold} days`,
    },
    {
      text: `Each week, check the protocol's own points, rewards or governance page from the link its official site publishes; never pay a third party to "activate" a claim.`,
      cost: 'nothing to check; a claim fee demand is a scam signal',
      time: '5 minutes a week',
    },
    {
      text: `Log the wallet address, dates, amounts and transaction hashes in a farm log; unwind only after a token announcement or after ${hold} days with no points programme in sight.`,
      cost: 'nothing but the log itself',
      time: '10 minutes',
    },
  ];
}

/* -------------------------------- thesis ------------------------------- */

function fmtUsdShort(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n)}`;
}

/** A one-line, figure-backed reason this protocol sits where it sits. */
export function thesisFor(p: SnapshotProtocol, pick: MultiplePick, age: number | null): string {
  const bits: string[] = [
    `Records no token on ${fmtUsdShort(p.tvl_usd)} TVL across ${p.chains.length} chain${p.chains.length === 1 ? '' : 's'}`,
    `${p.category ?? 'uncategorised'} peers trade at a median ${pick.rawMedian.toFixed(2)}x TVL (${pick.compCount} comps, ${pick.scope} level)`,
  ];
  if (p.change_7d !== null) bits.push(`7d TVL ${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}%`);
  if (age !== null) bits.push(`${age}d tracked with no token`);
  return `${bits.join('; ')}.`;
}

/* -------------------------------- board -------------------------------- */

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  family: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  asset_unit_risk: boolean;
  multiple: number;
  multiple_scope: 'category' | 'family' | 'global';
  comp_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  implied_value_usd: number;
  conviction: number;
  thesis: string;
  farm_steps: string[];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Display-only conviction (0–100): size, momentum, track record, watchlist membership. Not used for ranking. */
function convictionFor(p: SnapshotProtocol, age: number | null, onWatchlist: boolean): number {
  const size = Math.min(40, Math.max(0, (Math.log10(Math.max(p.tvl_usd, 1)) - 6.7) * 16));
  const growth = p.change_7d === null ? 8 : Math.min(20, Math.max(0, 10 + p.change_7d));
  const track = age === null ? 8 : Math.min(25, (age / 1095) * 25);
  return Math.round(Math.min(100, size + growth + track + (onWatchlist ? 15 : 0)));
}

/** Build the ranked board: every watchlist slug plus every screened candidate, best implied value first. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const book = buildMultipleBook(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) {
    if (recordsToken(p)) continue;
    if (watch.has(p.slug) || screenReason(p) === null) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const pick = pickMultiple(book, p);
    const age = ageDays(snapshot.as_of, p.listed_at);
    const g = growthMultiplier(p.change_7d);
    const m = maturityMultiplier(age);
    const b = breadthMultiplier(p.chains.length);
    const implied = Math.max(1, Math.round(p.tvl_usd * pick.multiple * g * m * b));
    return { p, pick, age, g, m, b, implied };
  });
  scored.sort((x, y) => y.implied - x.implied || y.p.tvl_usd - x.p.tvl_usd || (x.p.slug < y.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    family: familyOf(s.p.category),
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    watchlist: watch.has(s.p.slug),
    asset_unit_risk: assetUnitRisk(s.p),
    multiple: round4(s.pick.multiple),
    multiple_scope: s.pick.scope,
    comp_count: s.pick.compCount,
    growth_multiplier: round4(s.g),
    maturity_multiplier: round4(s.m),
    breadth_multiplier: round4(s.b),
    implied_value_usd: s.implied,
    conviction: convictionFor(s.p, s.age, watch.has(s.p.slug)),
    thesis: thesisFor(s.p, s.pick, s.age),
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** Live-token reference rows: the comps the multiples come from, shown apart from the ranked board. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  family: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  change_7d: number | null;
  symbol: string | null;
}

export function liveRows(snapshot: Snapshot, cap = 48): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, cap)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      family: familyOf(p.category),
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: round4(p.mcap_usd! / p.tvl_usd),
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  params: {
    shrink_k: number;
    growth_weight: number;
    growth_clamp: [number, number];
    maturity_formula: string;
    breadth_per_chain: number;
    global_median_multiple: number;
    global_comp_count: number;
  };
  counts: {
    protocols: number;
    records_no_token: number;
    screened_out: number;
    board: number;
    watchlist: number;
    live_comps: number;
  };
  rows: BoardRow[];
  live: LiveRow[];
}

export const MODEL_VERSION = 'radar-2 (peer-multiple)';

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const book = buildMultipleBook(snapshot.protocols);
  const noToken = snapshot.protocols.filter((p) => !recordsToken(p)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    params: {
      shrink_k: SHRINK_K,
      growth_weight: 0.3,
      growth_clamp: [-40, 80],
      maturity_formula: '0.80 + 0.40 x (1 - exp(-age_days / 720)); unknown age = 1.00',
      breadth_per_chain: 0.015,
      global_median_multiple: round4(book.globalMedian),
      global_comp_count: book.globalCount,
    },
    counts: {
      protocols: snapshot.protocols.length,
      records_no_token: noToken,
      screened_out: noToken - board.length,
      board: board.length,
      watchlist: snapshot.watchlist.length,
      live_comps: book.globalCount,
    },
    rows: board,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** Parse and lightly validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !(o.floor_usd > 0)) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new SnapshotError(`protocol ${i} lacks slug, name or tvl_usd`);
    }
    const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Gate-shape self-check, run before anything is written. Returns a refusal reason or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} chars`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script (no fetch, no network). */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
