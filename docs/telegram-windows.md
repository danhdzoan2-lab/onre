# Telegram on Windows

The dashboard remains a static site. Telegram requires the companion installed on your PC; it continues after closing the browser or locking Windows, but not during Sleep, sign-out, power-off, or loss of connectivity. No order placement/cancellation is supported.

## Setup

1. Install Node.js 20 or newer. Keep this repository checkout at a stable location.
2. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\companion\install.ps1` from the repository directory. This adds one limited-privilege logon task. Windows may require administrator approval to register the task; the monitor itself runs as your current user, not SYSTEM.
3. Create a dedicated bot with [BotFather](https://t.me/BotFather), using `/newbot`. Never share its token in chat, Git, screenshots, or the dashboard.
4. Open `http://127.0.0.1:17643`, enter the token, and follow **Open Telegram and press Start**. Linking codes expire after ten minutes and bind one private chat. Existing webhooks are rejected, not silently removed.
5. On [onre.vercel.app](https://onre.vercel.app), add wallets, choose Buy/Sell Position, then **Settings → Sync Telegram**. Allow the popup. Settings are active only after the local page confirms the save. Sync again after changing wallets, RPC or Position toggles. On a phone or another PC, Sync cannot reach this Windows monitor.
6. Send a test from the local page, and ensure Telegram notifications are enabled on your phone. The monitor does not change Windows power settings or Telegram notification settings.

The default scan target is five seconds, configurable from 2–3,600 seconds locally. API latency, backoff and single-flight scans can make actual intervals longer. Sharing an RPC/API with an open dashboard increases requests; each process individually limits concurrency to three.

## Alerts and state

- Position requires fresh, verified data and `1 / N`, with `N >= 2`. A first successful discovery can alert immediately.
- A partial fill is a decrease between verified raw on-chain quantities. The first snapshot establishes the baseline, not a retrospective fill alarm. Missing orders are never interpreted as fully filled.
- Position repeats once per minute only while still first and fresh, until **Acknowledge**. Acknowledge only affects Telegram. The next genuine partial-fill decrease still alerts.
- During API failures the old state is retained without rearming Position. After sixty seconds, a tracked-market outage gets one warning and one recovery message.
- Persistent state, pending deliveries and DPAPI-encrypted credentials live under `%LOCALAPPDATA%\OnReTelegram`, outside Git/Vercel. No runtime token is served to the dashboard.
- Telegram delivery uses retries with backoff. Telegram has no send-message idempotency key, so an ambiguous network failure can produce a duplicate; exactly-once delivery is not promised. No alerts can guarantee enough time to cancel before a fast fill.

## Stop / uninstall

Use **Pause** or **Disconnect** on the local page. Disconnect removes stored bot credentials and stops Telegram; dashboard alarms are unchanged. Run `companion\uninstall.ps1` to remove the logon task. It retains runtime state for recovery. If a process was started manually, stop that process separately. Do not move the checkout while the scheduled task still points to it; reinstall after moving.

## Verification

Run `node --test tests/*.test.cjs` (PowerShell: `node --test (Get-ChildItem tests\*.test.cjs).FullName`). Automated tests simulate queue/identity/quantity transitions, outages, retries and linking security. A real phone test requires the owner's bot token and Start interaction; never commit credentials for fixtures.
