# Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana — "Dip rider"

[![make.fun](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/fulede9394/makefun-tiny-bot-sol/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/fulede9394/makefun-tiny-bot-sol/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

Built for the make.fun bounty [Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1).

## Strategy

A "dip rider" on hourly Solana bars (FARTCOIN, JITOSOL, POPCAT, RAY, SOL, WETH, WIF):

- **Entry:** a symbol closes more than 1.5 ATRs below its own 12-bar mean — oversold against its own recent range.
- **Regime gate:** entries only while the equal-weight 12-bar return across all 7 symbols is positive. Dips in a falling market keep falling, so the bot holds cash there.
- **Exit:** sell when the close gets back to the 12-bar mean (the reversion), when it falls 2.5 ATRs under the peak since entry (the cut), or after 12 bars (stale).
- **Sizing:** risks 0.5% of equity per trade, sized by the stop distance, capped at the 25% per-symbol weight cap. Long only, no leverage.
- **Deterministic:** decisions on closes only, no clock, no randomness — two runs produce byte-identical results.

## Dev grade (kit's `grade-local`, process driver, 136-hour dev window)

- Net PnL: **−$10.03** (return −0.10%) vs buy-and-hold **−$869.34** — beats buy-and-hold by +$859 and beats the best kit baseline (macd-cci, −$20.22).
- Trades: 22 (win rate 63.6%), max drawdown 0.995%, exposure 10.4%.
- Determinism: two runs, identical action-log and result hashes.

Honest caveat: the dev window is one 5.7-day sample in a broad downtrend, and the bot is essentially flat (−$10 on $10,000) rather than profitable. The final window is 3 fresh days of bars — the ranking there depends on whether the market bounces enough for dips to revert. Realistic outcome: ranked, possibly unpaid.

## Files

- `main.ts` — entrypoint: feeds each bar into the strategy and returns its orders.
- `strategy.ts` — the dip-rider logic (own structure, own names; no baseline code).
- `vendor/makefun-bars.ts` — the kit's SDK shim, vendored byte-for-byte.

## License

MIT — see `LICENSE`.
