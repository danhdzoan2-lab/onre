# Exponent PT-bulkSOL Buy Tracker

A real-time dashboard for confirmed PT-bulkSOL purchases on Solana. It scans the Exponent XPC contract, then keeps only transactions that:

- invoke the `BuyPt` instruction;
- decrease the signer's bulkSOL balance; and
- increase the signer's PT-bulkSOL balance.

This combination excludes other PT markets and non-purchase activity handled by the same contract.

## Tracked addresses

- Exponent contract: `XPC1MM4dYACDfykNuXYZ5una2DsMDWL24CrYubCvarC`
- bulkSOL mint: `BULKoNSGzxtCqzwTvg5hFJg8fx6dqZRScyXe5LYMfxrn`
- PT-bulkSOL mint: `HgyWqTZ6JdGYF5TfrYmScTyvsyuopwYRJXwqA2LzCrz6`

Reference transaction:

`2UfAWVpkDSSrzkwdQaQkadQrfYzq3KaL4UtyhSXm27zdycQ3LHSLaxSrjXaSQpzjFr71oetCVvmNLMZxrxvbEFoP`

## Features

- Scans the latest 40 confirmed contract transactions
- Shows up to 20 matching PT-bulkSOL buys
- Displays PT-bulkSOL received and bulkSOL spent
- Refreshes every 20 seconds
- Caches immutable transaction data to reduce RPC traffic
- Supports regular and high-volume browser alerts
- Links every result to Solscan
- Responsive desktop and mobile layouts

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
- `BULKSOL_MINT`
- `PT_BULKSOL_MINT`
- `SIGNATURE_SCAN_LIMIT`
- `DISPLAY_LIMIT`
- `POLL_INTERVAL_MS`
- `TRACKER.highVolumeThreshold`

No environment variables are required.
