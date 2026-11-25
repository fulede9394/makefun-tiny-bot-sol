// "Dip rider" for the bars-replay contest: buy a symbol stretched below its own
// short mean while the market as a whole is rising, sell the reversion to the
// mean, and cut it fast when it keeps falling. Written from scratch for this
// entry: no baseline code is used. (An earlier draft of this file rode breakouts;
// the dev window showed breakouts bleed in a grinding market, so the entry was
// reworked to buy dips instead — the tape, mean and ATR helpers stayed.)
//
// How it reads the market, per symbol, on hourly closes:
//   - The mean is the last MEAN_BARS closes; the stretch is ATR(ATR_BARS).
//   - An entry is a close below mean - DIP_ATR x ATR: the symbol is oversold
//     against its own recent range.
//   - A market gate reads the whole universe first: entries only while the
//     equal-weight REGIME_BARS return across all symbols is positive. Dips in a
//     falling market keep falling, so the bot holds cash there — which is how it
//     beats buy-and-hold in a downtrend.
//   - Once in, it sells when the close gets back to the mean (the reversion),
//     when the close falls under the peak less STOP_ATR x ATR (the cut), or when
//     the position is MAX_HOLD_BARS old, so stale trades do not sit through the
//     window.
//   - Sizing risks RISK_BPS of equity per trade: notional = risk / (stop distance
//     as a fraction of price), capped by the weight cap and the cash on hand.
//   - Orders fill at the next bar's open, so every decision is made on closes
//     only and nothing here reads the clock, the environment, or Math.random:
//     two runs agree.

import { BPS, type BarsState, type BuyInput, type OrderInput, type SellInput } from './vendor/makefun-bars.ts';

/** Tunable knobs, all in bars / basis points / whole numbers. */
export const KNOBS = {
  /** Span of the short mean the dip is measured against. */
  MEAN_BARS: 12,
  /** Span of the average true range behind the stretch and the cut. */
  ATR_BARS: 7,
  /** Entry: a close this many ATRs under the mean counts as a dip. */
  DIP_ATR: 1.5,
  /** Cut: a close this many ATRs under the peak since entry sells. */
  STOP_ATR: 2.5,
  /** Equity put at risk on one trade, in basis points. */
  RISK_BPS: 50,
  /** A position is closed once it is this many bars old. */
  MAX_HOLD_BARS: 12,
  /** Slippage cap on every order, in basis points. */
  SLIP_BPS: 100,
  /** Span of the universe return the regime gate reads. */
  REGIME_BARS: 12,
};

/** One symbol's price memory: closes, highs and lows as plain numbers (raw units). */
export interface Tape {
  closes: number[];
  highs: number[];
  lows: number[];
  /** Highest close since the current position opened (raw units), 0 when flat. */
  peak: number;
  /** Bar seq the current position opened on, -1 when flat. */
  openedSeq: number;
}

export function freshTape(): Tape {
  return { closes: [], highs: [], lows: [], peak: 0, openedSeq: -1 };
}

/** Mean of the last `span` closes, or null when fewer exist. */
export function rollingMean(closes: number[], span: number): number | null {
  if (closes.length < span) return null;
  let sum = 0;
  for (let i = closes.length - span; i < closes.length; i++) sum += closes[i];
  return sum / span;
}

/** Average true range over the last ATR_BARS bars (needs ATR_BARS + 1 closes). */
export function averageTrueRange(t: Tape): number | null {
  const n = KNOBS.ATR_BARS;
  if (t.closes.length < n + 1 || t.highs.length < n) return null;
  let sum = 0;
  for (let i = t.closes.length - n; i < t.closes.length; i++) {
    const prevClose = t.closes[i - 1];
    const tr = Math.max(t.highs[i] - t.lows[i], Math.abs(t.highs[i] - prevClose), Math.abs(t.lows[i] - prevClose));
    sum += tr;
  }
  return sum / n;
}

/** True when the latest close is DIP_ATR x ATR under its short mean: the dip. */
export function dippingBelow(t: Tape, mean: number, stretch: number): boolean {
  return t.closes[t.closes.length - 1] < mean - KNOBS.DIP_ATR * stretch;
}

/** True when the close has come back up to its short mean: the reversion. */
export function backToMean(t: Tape, mean: number): boolean {
  return t.closes[t.closes.length - 1] >= mean;
}

/**
 * Regime gate: the equal-weight mean REGIME_BARS return across every tape that has
 * the history, as a fraction. Positive means the market as a whole is rising.
 */
export function universeReturn(tapes: Map<string, Tape>): number | null {
  let sum = 0;
  let count = 0;
  for (const t of tapes.values()) {
    const n = KNOBS.REGIME_BARS;
    if (t.closes.length < n + 1) continue;
    const now = t.closes[t.closes.length - 1];
    const then = t.closes[t.closes.length - 1 - n];
    if (then > 0) {
      sum += (now - then) / then;
      count++;
    }
  }
  return count === 0 ? null : sum / count;
}

/** The cut line for a held position, or null before ATR exists. */
export function stopLine(t: Tape): number | null {
  const atr = averageTrueRange(t);
  if (atr === null || t.peak <= 0) return null;
  return t.peak - KNOBS.STOP_ATR * atr;
}

/**
 * Decide this batch's orders. Mutates the tapes (peak/openedSeq) as positions open and
 * close; the caller feeds each bar's close/high/low into the tape before calling.
 * Sells come first in the reply, then buys, both in universe order.
 */
export function decide(state: BarsState, tapes: Map<string, Tape>): OrderInput[] {
  const { caps, fees } = state.hello;
  const sells: SellInput[] = [];
  const entries: string[] = [];
  const fresh = new Set<string>();
  // Regime gate, read once per batch: entries only while the market as a whole rises.
  const reg = universeReturn(tapes);
  const marketUp = reg !== null && reg > 0;

  for (const { symbol } of state.hello.symbols) {
    const tape = tapes.get(symbol);
    if (tape === undefined) continue;
    fresh.add(symbol);
    const held = state.positions.get(symbol);
    const close = state.close(symbol);
    if (close === null) continue;
    const price = Number(close);
    const mean = rollingMean(tape.closes, KNOBS.MEAN_BARS);
    const stretch = averageTrueRange(tape);
    if (held !== undefined) {
      // Track the peak and check the exits: reversion to the mean, the cut, max hold.
      if (price > tape.peak) tape.peak = price;
      const line = stopLine(tape);
      const reverted = mean !== null && backToMean(tape, mean);
      const cut = line !== null && price < line;
      const stale = tape.openedSeq >= 0 && state.seq - tape.openedSeq >= KNOBS.MAX_HOLD_BARS;
      if (reverted || cut || stale) {
        sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: KNOBS.SLIP_BPS });
        tape.peak = 0;
        tape.openedSeq = -1;
      }
    } else if (!state.warmingUp && marketUp && mean !== null && stretch !== null && dippingBelow(tape, mean, stretch)) {
      entries.push(symbol);
    }
  }

  const orders: OrderInput[] = sells.slice(0, caps.max_orders_per_bar);
  // Risk-sized buys: risk RISK_BPS of equity per trade, sized by the stop distance.
  const slots = Math.min(state.hello.symbols.length, caps.max_open_positions);
  const room = slots - state.positions.size;
  let cash = state.cash;
  for (const symbol of entries) {
    if (room <= 0 || orders.length >= caps.max_orders_per_bar) break;
    const tape = tapes.get(symbol)!;
    const atr = averageTrueRange(tape);
    const price = Number(state.close(symbol));
    if (atr === null || price <= 0) continue;
    const stopDistance = (KNOBS.STOP_ATR * atr) / price; // fraction of price
    if (stopDistance <= 0) continue;
    const risk = (BigInt(KNOBS.RISK_BPS) * state.equity) / BPS;
    let slice = (risk * 10n ** 6n) / BigInt(Math.round(stopDistance * 1e6));
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    if (slice > byWeight) slice = byWeight;
    if (slice > cash) slice = cash;
    if (slice <= 0n || slice < BigInt(fees.min_notional_quote_units)) continue;
    orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: KNOBS.SLIP_BPS });
    cash -= slice;
    tape.peak = price;
    tape.openedSeq = state.seq;
  }
  return orders;
}
