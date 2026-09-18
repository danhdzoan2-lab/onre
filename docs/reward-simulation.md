# Exponent simulation parity

Verified 2026-09-18 using the public Exponent srONyc-10JAN27 page.

- Frontend asset: `/_next/static/chunks/1224-1e028d42775557fc.js`.
- Function `Y(model,t)` uses squared proximity, not the previous linear triangle.
- Source: `/api/orderbook-emissions/campaigns?includeInactiveTranching=true`.
  This documented-in-frontend query variant includes `emissionRateRawPerSecond`;
  the default endpoint did not include it during verification. Filter inactive
  and unrelated campaigns before rendering. This does not replace the existing
  alarm/reward feed.
- srONyc campaign `ndAp6RJ1-9J8Vvigc-ce893140` returned emission `1902175`
  raw units/second, decimals 9, market rate 85930, band 600 bps, cap 8000 bps,
  currentRewardsApy 80. For 1,000 units the peak rounds to 78.95%.
- Capital uses the numeric underlying-token amount shown by Exponent. Only
  matching underlying/emission mint is supported, to avoid unverified currency
  conversion. Capital changes extend Exponent's fixed 1,000-unit hypothetical
  weight to the entered amount; neither uses personal fill/queue scores.
- No division of undistributed funding by remaining time. Missing emission or
  invalid model inputs result in Simulation unavailable.
- Additional emissions/markets are not combined: each campaign has a separate
  chart and Buy/Sell label. UI rounding never changes the model.
- Simulation amounts use separate device-local storage. STRCx remains in the
  asset registry and wallet tracking; only its filter and simulation are absent.

Validation: `node --test tests/*.test.cjs`. Browser smoke check used isolated
headless Edge and captured live market/campaign responses; verified capital
changes, 78.95% peak, focus stability, filter, mobile labels, reload, stale-data
retention, and no page exceptions. Alarm logic is unchanged.
