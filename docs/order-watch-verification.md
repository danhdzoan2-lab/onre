# Order watch release gate

`ORDER_WATCH_PRIORITY_VERIFIED` remains **false** until the real-fill checks below
are recorded. Synthetic tests are not evidence that the deployed matching engine
uses the predicted priority. The Watch UI may be used to retain order identities;
it must display that priority alarms are unavailable while this gate is closed.

## Observed evidence (14 September 2026)

- Public SDK: https://app.exponent.finance/_next/static/chunks/7687-061c0358270b90cd.js
  `Orderbook.getQuote` (minified class `V`) filters opposing offers and sorts by
  descending `priceApy` when the taker sells YT. `PT_TO_SY` maps to virtual BuyYt,
  so `sellPT` cannot be omitted from the Farm buy side.
- **SDK same-price quotes use expiry as a tie breaker.** This is not sufficient
  proof of on-chain FIFO. Watch traversal deliberately uses decoded head/next/tail
  links, not this SDK sort.
- Live srONyc book `ndAp6RJ1Q2wkoczCdXQteZk2UMnmDNWQDCCCKyLtymv`, slot
  `446927965`, vault `y5UFEeB3LfUErLBjDMdZynAoqCwBgsMnDZSzth68aaH`:
  raw price `86177` has linked live offers `[5, 28]`, raw `85810` has `[30, 24]`.
  This verifies that links can be decoded, not that an upcoming taker must execute
  that sequence.
- Offer `28` now belongs to `6HNVk2UeApTKY2w8h4WDwcLhY58t9jrQRC68cHuC3Gmi`,
  created `1789303382`. The earlier provided Post Offer at slot `446645939` used
  `28` for `3srhDoV9VunGoVGEVNy8NMhkoqeQE8szhN1T2Z6qPgof` at raw `84708`.
  Tracking ID alone would incorrectly follow another wallet.
- A bounded check of the latest 15 srONyc transactions returned no decoded
  matching fill event suitable for the required before/after comparison.
- Extending the bounded read to 50 signatures found four MarketOffer events.
  Decoded samples `3NVNuBNE2qyvwZnNSgLH6mwrCe7nkmhDsU462so11cWigwR8bSmiM7932HUC4vqHKkXAtmvXirjfCD5iNHqJDRAg`
  (slot `446701576`) and
  `4LCT2k6GXLGiBKZhZe8nfJdpG2N6YDworCeoNqqoFPhqtLvWGME3rJmVX9qiJoocLdV5qmb1HA7tVAuL7f46xFkG`
  (slot `446701748`) each fill offer `29` at last raw price `91211`, with taker
  side `2` (buyYT), virtual `0`. They exercise the **sell** side, not the watched
  buy-side priority, and do not provide a pre-trade book snapshot. Gate stays closed.

## Required before enabling

1. Record confirmed pre-trade book bytes/slot, a successful actual taker sell
   transaction, decoded ordered fill events and confirmed post-trade book.
2. Compare fills against descending raw-price traversal and head/next order at
   equal raw price, including buyYT and virtual sellPT. Preserve remaining-amount
   checks for partial fills. Do not infer priority from API timestamps.
3. Reconcile watched API identity with on-chain owner, book, vault, side, price,
   creation/expiry and original amount. Do not permit a timestamp tolerance just
   to resolve Unverified rows.
4. Add reproducible real-data fixtures and assertions. Investigate exceptions
   such as fill-or-kill, dust/threshold handling or self-trade constraints before
   classifying any affected order as At front.
5. Run the full test suite and manual desktop/mobile QA, then change the release
   gate in reviewed source (not through localStorage or a runtime UI override).

The feature does not prove execution probability or provide enough time to cancel.
There is no order placement/cancellation code or new backend.

## Local QA (14 September 2026)

- All 17 test files pass, including overflow/oversized stored identity rejection.
- Local browser loaded live APY, reward ranges, 50 transactions and the srONyc
  book. Expanded 9.00% group showed buyYT #24 with an inline Watch control.
- Browser automation could not activate Watch (shadow-root target check failed
  through both locator and accessibility actions). Manual persistence/Unwatch
  and mobile visual QA remain outstanding; lifecycle tests cover these in a VM.
- No production deployment or release-gate change was made.

## Placement evidence extension

`order-placement.js` verifies the exact Post Offer event (owner, book, vault,
offer ID, raw price, original amount, side and duration) from finalized RPC data.
It obtains the transaction index from finalized getBlock signatures and uses
outer/inner instruction indexes to order events within one transaction. API
timestamps are not used as an ordering fallback. Multiple matching events fail
closed. Finalized evidence is memory-cached and reloaded after page reload.

The watched vault's current open orders are polled independently of collapsed
markets and token filters. Counts include only identity-verified live buyYT
orders at the same raw price. Unknown peers are explicitly counted; virtual
sellPT is excluded, so this is not a full execution queue rank. Expired/removed
API orders are excluded and stale snapshot counts withheld. This does not add
a historical event replay or establish the reason an order disappeared.

Read-only live check: supplied signature 5WTKGrr5Mio6RwJYoqbcdnQYsViRAhLdQbHMJkuJVtbphPMWhUQ7YzVXGnYWH7kUnoeL7LwxfbuVBt1ANVEWjo3P
returned one decoded Post Offer at slot 446645939, zero-based transaction index
1191 from getBlock. Both requests returned HTTP 200 through the existing Worker.
All 18 test files pass. Priority gate remains false; not deployed.
