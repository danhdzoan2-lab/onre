# Read-only Buy Orderbook

Current behavior is documented in **Buy Orderbook (14 Sep 2026)** below. Manual
order marking and its background monitoring have been removed at the user's
request. The following earlier verification notes are retained as historical
decoder research, not instructions for the current UI.

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

Post Offer events include the FillOrKill option, optional offer index and filled
offer vector. Events without a queued offer index are not markable and are excluded
from later-post counts. Unsupported historical Post Offers stop the
history checkpoint and show incomplete history; the independent live queue still
works. Checkpoints advance only after all pages/transactions reach the previous
checkpoint or initial markers. History is bounded to 10,000 decoded events per
book with an explicit error at that limit. Reload revalidates before reporting
history synchronized. Snapshot and history polling have independent overlap guards,
8-second request timeouts, and rate-limit backoff. No queue notification or trade
mutation is implemented; existing APY alarms remain unchanged.

Run regression checks: `node --test tests/*.cjs`.

## Buy Orderbook (14 Sep 2026)

Update: the user requested removal of Marked YT Orders after the detailed book
became available. The marking UI, Mark/Unmark buttons, marker storage access and
background history synchronization have been removed. Earlier marked-order notes
above are historical implementation records only. `order-rpc.js` now supplies
on-demand read-only snapshots for expanded Buy Orderbook markets; it starts no
background work. Existing saved APY inputs and alarms are unaffected.

The collapsed-by-default market view uses `/api/open-orders/vault/{vaultAddress}`.
It follows the same mint filter and farthest-active-maturity selection as APY.
Farm bids include `buyYT` and virtual `sellPT`. Each order's raw log rate is
converted with `100 * expm1(raw / 1e6)` and displayed to two decimals. Display
buckets are nearest 0.1 percentage point; FIFO always uses the original raw rate
and the specific book, never the bucket or rounded APY.

The public Farm UI quantity conversion uses remaining SY * market.syExchangeRate
divided by `1 - exp(-raw / 1e6 * secondsRemaining / 31536000)` for buyYT, and
remaining amount directly for sellPT, then scales by market.decimals. Remaining
time is rounded to the nearest minute, as in Exponent's UI. Each range group sums
individual conversions, not a conversion at the bucket price. Unknown or unsafe
integer amounts yield a dash, including in the group total. This display estimate
is before fees and differs from the SDK-based marked-order estimate documented
above when exchange-rate references or sampling times differ.

Queue verification requires API/on-chain vault, book maturity, offer index,
owner, raw price, side/virtual flag, creation/expiry, and remaining amount to match.
IDs alone never identify an order. Confirmed linked-list snapshots are shared
across expanded views, deduplicated per book and polled only for open,
selected markets.
All requests time out after eight seconds; API/RPC 429 responses use Retry-After.
Closed or filtered markets do not start new detail requests. Stale snapshots keep
their estimates, but no current FIFO position is claimed.

Live srONyc validation found an important conservative fallback: some API
created_at values differ from on-chain creation by one second, and API expiry
can extend past book maturity while the actual offer is capped at maturity.
These rows remain Unverified rather than relaxing identity matching. At slot
446764257, offers 5 and 28 at raw 86177 verified as 1/2 and 2/2 respectively;
offer 24 at raw 85810 verified as 2/2. API-indexed offers 30, 29 and 34 had
placement-time discrepancies and correctly remained Unverified. UI buy groups
matched Exponent's 9.00, 8.90, 8.00 and 7.30 percent buckets. Totals drift with
the time-to-maturity reference even without order changes.

APY Range formatting is display-only: ceil the lower original bound to 0.001
percentage point and floor the upper, checking inclusion back in original units
to avoid floating multiplication boundary errors. Disjoint campaigns stay
separate; an empty representable interval says No valid 3-decimal value.
Inputs, stored settings and the signed APY alarm calculation are unchanged.
