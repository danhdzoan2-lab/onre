# Read-only YT order tracking

Use **Mark #…** on a supported buy-YT Post Offer, or paste its Solscan transaction
link into **Marked YT Orders**. Multiple markers are saved in browser localStorage;
no wallet connection or wallet-address input is required. Unmarking only removes
the local marker and never cancels an order.

## Verification

The decoder follows the public Exponent frontend SDK's account layout and event
definitions, inspected 13 Sep 2026:
https://app.exponent.finance/_next/static/chunks/7687-061c0358270b90cd.js

- Program: `XPBookgQTN2p8Yw1C2La35XkPMmZTCEYH77AdReVvK1`.
- Book layout: 1,000 price nodes, 2,500 offers, 1,500 user escrows; 317,688 bytes.
- Follow the exact price node's buy head, each next-offer pointer, and buy tail.
  Validate links, price pointer, side, owner, created time, expiry and amount.
  Offer IDs are reusable: an ID alone is not an identity or sequence number.
- Expired/zero-amount entries are excluded. Queue position is at the **same exact
  raw price**, not across all price levels or across maturity dates.
- Live queue uses confirmed account snapshots; historical events and marker
  imports use finalized transactions. Confirmed state can change before finality.
- The sample transaction ending `VEWjo3P` decodes to offer 28, buy YT, non-virtual,
  raw rate 84708 (8.839920772459143% APY), 10,095.523225482 SY units at 9 decimals.
  Live inspection matched owner and creation/expiry, and the chain was 24 → 28.

## YT amounts

For non-virtual buy YT, using the source SDK formula:
`floor(remainingSyRaw * max(bookSyIndex, marketATHIndex) /
       (1 - exp(-rawPrice / 1e6 * secondsRemaining / 31536000)))`.

Display in market token decimals. This is an estimate before fees, at snapshot
time, not a fixed receipt amount or a reward guarantee. Reference indices and
decimals use the existing markets response. Missing/stale indices or unsupported
virtual offers show a dash, never a guessed amount. Other price levels can execute
before this price; last in this queue does not guarantee avoiding execution.

## History and failure behavior

The activity feed loads 50 contract signatures before token filtering. A separate
paginated stream per marked orderbook tracks decoded Post Offers after each marker
in that market. It does not claim that all later posts have the same side/price.
Execution comparisons use slot, transaction index, outer instruction and inner
event index, never API list order or timestamps. Missing execution indices leave
the comparison unverified.

Only verified Post Offer variants (FillOrKill option, no immediate fills, non-null
offer index) are currently decoded. Unsupported historical Post Offers stop the
history checkpoint and show incomplete history; the independent live queue still
works. Checkpoints advance only after all pages/transactions reach the previous
checkpoint or initial markers. History is bounded to 10,000 decoded events per
book with an explicit error at that limit. Reload revalidates before reporting
history synchronized. Snapshot and history polling have independent overlap guards,
8-second request timeouts, and rate-limit backoff. No queue notification or trade
mutation is implemented; existing APY alarms remain unchanged.

Run regression checks: `node --test tests/*.cjs`.
