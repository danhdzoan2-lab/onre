# Exponent Transaction Tracker

A real-time dashboard for Exponent CLMM and Exponent Orderbook transactions on Solana. Select a contract to scope the feed and alerts. Asset filters apply to either contract.

## Tracked contract

`XPC1MM4dYACDfykNuXYZ5una2DsMDWL24CrYubCvarC`

Orderbook: `XPBookgQTN2p8Yw1C2La35XkPMmZTCEYH77AdReVvK1`

Switching contracts discards stale pending results and starts a fresh notification baseline, so historical transactions do not trigger alerts.

The tracker does not filter by PT market, token mint, instruction, or transaction result. It displays the latest 20 contract signatures, including successful and failed transactions.

## Features

### Automatic wallet buy-order monitoring

Add public Solana addresses under **Buy Orderbook**. Wallets are saved locally; no connection or signing is required. Manual Watch/Unwatch is replaced by automatic discovery of open buyYT orders across all unexpired Orderbook markets for ONyc, STRCx, srONyc, eUSX, USX and srEHYUSD, independent of filters and collapsed sections.

Adding a wallet or reopening the page scans once. **Refresh orders** scans manually; **APY Alarm: ON** continues scanning every 2 seconds, including wallets with no orders yet. API and on-chain requests share a three-request concurrency limit and per-vault/book cache, with 8-second request timeouts and rate-limit backoff. Failed markets retain stale records; only successful responses remove missing orders without assuming fill/cancel.

Personal orders use the same APY-group ordering as Buy Orderbook, including sellPT competitors and the existing on-chain timestamp reconciliation. A fresh position **1 / N**, with **N >= 2**, latches the existing audio/visual/Windows alarm. Stop/Space acknowledges active alarms; acknowledgment is saved by complete placement identity. Removing a wallet clears only its alarms. Order-ID reuse is a new identity. Browser suspension or closure can interrupt monitoring.

Legacy manual Watch storage is preserved but not loaded or imported. APY/threshold and transaction-refresh settings are unchanged. This section supersedes the historical wallet/queue notes below.

Run `node --test tests/*.cjs` for the full regression suite.

- Market Implied APY table reads the public Exponent `/api/markets` endpoint every 2 seconds (source cache: 30 seconds).
- Matches underlying mint and selects the farthest active maturity; shared market APY is independent of the CLMM/Orderbook selector and follows the multi-token filter.
- Displays Asia/Saigon maturity times, remaining time, and last successful check. Preserves stale data on failure and respects HTTP 429 Retry-After.
- Run `node tests/apy.test.cjs` to verify APY selection, rendering, and request recovery.

- Shows every recent Exponent CLMM transaction
- Decodes the primary Exponent instruction from program logs
- Displays signer-owned SPL token balance changes for any mint
- Shows successful and failed transaction status
- Select multiple tokens (ONyc, STRCx, srONyc, eUSX, USX) to filter the feed and notifications; a transaction matching any selected token is included once. Click again to deselect. All, or deselecting the last token, restores all activity.
- Tracks srONyc `9J8VvigcjFTkN3jhZH2ieTi2hdGVBVpEXbcA1JDo7QpA`, eUSX `3ThdFZQKM6kRyVGLG48kaPg5TRMhYMKY1iCRa9xop1WC`, and USX `6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG`
- Tracks ONyc mint `5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5` and STRCx mint `Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH`
- Lets each user set and locally save a high-volume threshold
- Refreshes every 2 seconds
- Caches immutable transaction data to reduce RPC traffic
- Supports regular and high-volume browser alerts
- Links every result to Solscan
- Responsive desktop and mobile layouts

High volume is calculated from the largest absolute signer token change in a transaction. Token units are not normalized across different assets.

## Local development

```bash
npx http-server
```

Open the local URL, keep the default Cloudflare Worker endpoint or enter another compatible Solana JSON-RPC proxy, then select **Load data**.

## Deployment

The repository is a static Vercel site. Pushing an update to the connected production branch triggers the existing Vercel deployment.

## Configuration

The main constants are in `index.html`:

- `PROGRAM`
- `SIGNATURE_SCAN_LIMIT`
- `DISPLAY_LIMIT`
- `POLL_INTERVAL_MS`
- `DEFAULT_HIGH_VOLUME_THRESHOLD`

No environment variables are required.

## Manual limit APY monitor

Update: wallet entry and queue UI have been removed. Settings now use `exponent-limit-monitor-v2`, scoped only by vault and maturity. On first load, settings from the last selected v1 wallet are copied into v2; the legacy storage remains untouched. No wallet is needed for editing APY or sounding alarms. Range cells are numeric-only using the same `amount` styling as market APY; `*` denotes stale values. Older wallet-specific descriptions below document historical behavior only.

Wallet address, manual APY and nonnegative threshold (percentage points) are stored in browser localStorage, scoped by wallet + vault address + exact maturity. Empty/invalid inputs disable that market's alert. Refresh never overwrites the input. Alerts require opt-in each page session and respect token filters. After enabling, editing settings or changing wallet, the next successful APY fetch alerts once if the signed gap is already at or below the threshold. Otherwise alerts fire on subsequent above-to-at/below transitions. Desktop notifications require permission; inline alerts remain available. No background monitoring is promised when the page is closed.

Queue monitoring is intentionally **unavailable**, including marker selection, queue checkpoints, fill alerts and claims of position. The public `/api/orderbooks` catalog exposes aggregate book/vault metadata, not verified individual orders. The sample wallet transaction `3xdeXesYNYYA92YDZJmwjBhd7nYAS5KzM1o2ZT814UhdnWGfnbN5yp3gMaZoLRJbzXXycGUuEYwrRW8VnQ7oquV7` contains successful `WrapperPostOffer` and `PostOffer` instructions, but the complete order/event decoder has not been validated. Do not enable this gate until owner, order ID, buy-YT side, exact price, execution ordering, partial fills and cancellation are reconciled against real orders. A complete paginated event synchronizer with persisted checkpoints and resync before notifications is still required; the 20-row activity feed is not a substitute.

APY alerts trigger when `Market APY - My APY <= threshold`, including equality, with a floating-point boundary tolerance. This is a signed comparison, not an absolute distance: negative gaps also qualify against nonnegative thresholds. Negative thresholds stay visible with validation errors and disable that market. Each alert plays one three-note ascending APY chime, independent of transaction audio and notification permission. Simultaneous alerts are grouped. Use **Thử âm APY** to unlock/test browser audio; no audio guarantee is made for closed or suspended tabs. Initial/restored settings satisfying the condition alert once after successful fetching when alerts are enabled; stale data never triggers a new alert.

Tests: `node tests/apy.test.cjs` and `node tests/limit-monitor.test.cjs`.

## Latched APY alarm

APY alerts now latch a shared two-second Web Audio buffer loop until **Dừng báo thức** is pressed. The panel retains all triggered markets and their trigger-time details even if APY recovers, filters change or the API fails. Stop immediately halts/disconnects the audio source and acknowledges every current entry without clearing threshold edge state. A new above-to-at/below crossing or explicit settings reset can re-arm. Switching wallet or disabling alerts stops and clears the alarm. Notification messages are sent only for newly latched entries, never for sound repetitions. The test button plays a short chime when idle, or unlocks the existing alarm without layering another sound. Audio runs independently of polling but cannot be guaranteed during browser suspension, sleep or tab closure. Alarm state is not persisted. Run `node tests/limit-alarm.test.cjs` for the lifecycle tests.

## Reward APY range

`reward-range.js` reads the public Exponent campaigns API independently every 2 seconds (8-second timeout, no overlap, Retry-After on 429). It matches the selected farthest-maturity vault and its orderbook addresses, requires buyYT quote incentives, current campaign dates and remaining funding using BigInt. Multiple campaigns remain separate. The range follows Exponent's exponential conversion of campaign marketImpliedApy and priceBandBps, not the dashboard market APY. Manual APY is compared against unrounded inclusive bounds; expandable details expose precision. Missing metadata is unknown, not a made-up range. Failed fetches retain previous ranges marked stale without claiming current membership. No range notifications or order eligibility guarantees are added. Run `node tests/reward-range.test.cjs` for fixtures and polling failure checks.
