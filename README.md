# Exponent CLMM Transaction Tracker

A real-time dashboard for all transactions involving the Exponent CLMM contract on Solana.

## Tracked contract

`XPC1MM4dYACDfykNuXYZ5una2DsMDWL24CrYubCvarC`

The tracker does not filter by PT market, token mint, instruction, or transaction result. It displays the latest 20 contract signatures, including successful and failed transactions.

## Features

- Shows every recent Exponent CLMM transaction
- Decodes the primary Exponent instruction from program logs
- Displays signer-owned SPL token balance changes for any mint
- Shows successful and failed transaction status
- Provides an ONyc-only button that filters both the feed and notifications for mint `5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5`
- Lets each user set and locally save a high-volume threshold
- Refreshes every 20 seconds
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
