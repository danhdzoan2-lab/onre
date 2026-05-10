# OnRe × ONyc | Real-time Movement Tracker

Real-time transaction tracker for ONyc movements on Solana's Exponent Core program. Integrates with Cloudflare Workers for free RPC access and provides live alerts & desktop notifications.

## Features

✨ **Live Transaction Monitoring** — Real-time tracking of ONyc movements  
🔔 **Smart Alerts** — Regular + high-volume (>5,000 ONyc) notifications with distinct audio cues  
📊 **Analytics Dashboard** — Transaction stats, volume tracking, active wallets  
🔗 **Solscan Integration** — Direct transaction links for verification  
⚡ **Cloudflare Worker Proxy** — Free Solana RPC with configurable endpoint  
📱 **Responsive Design** — Works on desktop and mobile  

## Quick Start

### Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/danhdzoan2-lab/onre.git
   cd onre
   ```

2. Open `index.html` in your browser or use a local server:
   ```bash
   npx http-server
   # or
   python -m http.server 8000
   ```

3. Input your Cloudflare Worker proxy URL and click **Load Data**

### Vercel Deployment

#### Option 1: Deploy via GitHub (Recommended)

1. **Connect GitHub to Vercel:**
   - Go to [vercel.com](https://vercel.com)
   - Sign in with GitHub (or create an account)
   - Click "New Project"
   - Select this repository
   - Vercel auto-detects the configuration

2. **Deploy:**
   - Click "Deploy"
   - Your app is live at `https://<project-name>.vercel.app`

#### Option 2: Deploy via CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# For production
vercel --prod
```

#### Option 3: Manual GitHub Push & Auto-Deploy

```bash
# Ensure all changes are committed
git add .
git commit -m "Setup for Vercel deployment"
git push origin main

# Then enable automatic deployments on Vercel dashboard
```

## Configuration

### Proxy URL
Update the Cloudflare Worker proxy URL in the UI. Default endpoint:
```
https://wild-night-f072.amazygo1.workers.dev
```

### High Volume Threshold
Edit the `HIGH_VOLUME_THRESHOLD` constant in `index.html` (default: 5,000 ONyc)

## Constants

- **Program ID:** `ExponentnaRg3CQbW6dqQNZKXp7gtZ9DGMp1cwC4HAS7`
- **Token Mint:** `5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5`
- **Refresh Interval:** 30 seconds

## Browser Requirements

- Chrome, Firefox, Safari, or Edge (latest versions)
- JavaScript enabled
- Notifications permission (optional but recommended)
- HTTPS required for notifications on deployed site

## Environment Variables

None required. The tracker works out-of-the-box with the provided Cloudflare Worker proxy.

## Project Structure

```
onre/
├── index.html          # Main tracker application
├── package.json        # Project metadata
├── vercel.json         # Vercel configuration
├── .gitignore          # Git ignore rules
└── README.md           # This file
```

## Troubleshooting

### "Only in AI viewer" warning
- Open in a real browser tab (not within an iframe or preview)
- Desktop notifications require HTTPS

### No transactions showing
- Verify the Cloudflare Worker proxy URL is correct
- Check browser console for error messages
- Ensure the program ID and token mint are correct

### Notifications not working
- Allow notifications when prompted
- Check browser notification settings
- Restart the browser if previously denied

## License

MIT

## Support

For issues or questions, open an issue on GitHub: [danhdzoan2-lab/onre](https://github.com/danhdzoan2-lab/onre)