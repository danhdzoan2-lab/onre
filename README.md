# Exponent Transaction Tracker

A real-time dashboard for Exponent CLMM and Exponent Orderbook transactions on Solana. Select a contract to scope the feed and alerts. Asset filters apply to either contract.

## Tracked contract

`XPC1MM4dYACDfykNuXYZ5una2DsMDWL24CrYubCvarC`

Orderbook: `XPBookgQTN2p8Yw1C2La35XkPMmZTCEYH77AdReVvK1`

Switching contracts discards stale pending results and starts a fresh notification baseline, so historical transactions do not trigger alerts.

The tracker does not filter by PT market, token mint, instruction, or transaction result. It displays the latest 20 contract signatures, including successful and failed transactions.

## Features

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
