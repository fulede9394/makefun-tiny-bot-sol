// Entrypoint: feeds every bar into the breakout-rider strategy and answers with its
// orders. The strategy lives in strategy.ts; this file only owns the wire.

import { runBars, type BarsState } from './vendor/makefun-bars.ts';
import { decide, freshTape, type Tape } from './strategy.ts';

/** One price tape per universe symbol. */
const tapes = new Map<string, Tape>();

await runBars({
  onHello(state: BarsState) {
    for (const { symbol } of state.hello.symbols) tapes.set(symbol, freshTape());
  },
  onBatch(state: BarsState, batch) {
    for (const bar of batch.bars) {
      const tape = tapes.get(bar.symbol);
      if (tape === undefined) continue;
      tape.closes.push(Number(bar.c));
      tape.highs.push(Number(bar.h));
      tape.lows.push(Number(bar.l));
    }
    return decide(state, tapes);
  },
});
