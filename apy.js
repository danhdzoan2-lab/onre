const APY_ENDPOINT = 'https://app.exponent.finance/api/markets';
const apyState = { markets: null, checkedAt: 0, error: '', inFlight: false, retryAt: 0 };

function farthestApyMarket(markets, mint, nowSeconds) {
  return markets.filter(m => m?.underlyingAsset?.mint === mint && m.marketStatus === 'active'
    && Number.isFinite(m.maturityDateUnixTs) && m.maturityDateUnixTs > nowSeconds
    && typeof m.vaultAddress === 'string')
    .sort((a, b) => b.maturityDateUnixTs - a.maturityDateUnixTs || a.vaultAddress.localeCompare(b.vaultAddress))[0] || null;
}

function formatImpliedApy(value) {
  return typeof value === 'number' && Number.isFinite(value) && Number.isFinite(value * 100)
    ? `${(value * 100).toFixed(2)}%` : '—';
}

function apyRetryDelay(header, now = Date.now()) {
  if (header != null && header.trim() !== '') {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  return 30000;
}

function apyDate(ms) {
  return new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Saigon', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).replace('Sept', 'Sep');
}

function renderApy() {
  const body = document.getElementById('apyRows');
  if (!body) return;
  const now = Date.now();
  for (const [key, asset] of Object.entries(ASSETS)) {
    let row = document.getElementById(`apy-${key}`);
    if (!row) {
      row = document.createElement('tr');
      row.id = `apy-${key}`;
      for (const label of ['Token', 'Maturity', 'Time Left', 'Implied APY']) {
        const cell = document.createElement('td');
        cell.dataset.label = label;
        row.appendChild(cell);
      }
      row.lastElementChild.className = 'amount';
      row.apyCells = Array.from(row.children);
      body.appendChild(row);
    }
    row.hidden = selectedAssets.size > 0 && !selectedAssets.has(key);
    const market = farthestApyMarket(apyState.markets || [], asset.mint, now / 1000);
    const minutes = market ? Math.max(1, Math.ceil((market.maturityDateUnixTs * 1000 - now) / 60000)) : 0;
    const remaining = minutes >= 1440 ? `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`
      : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    const values = [asset.label, market ? apyDate(market.maturityDateUnixTs * 1000)
      : apyState.markets ? 'No active maturity' : '—', market ? remaining : '—', market ? formatImpliedApy(market.impliedApy) : '—'];
    values.forEach((value, i) => { if (row.apyCells[i].textContent !== value) row.apyCells[i].textContent = value; });
    if (typeof renderLimitCells === 'function') renderLimitCells(row, key, market);
  }
  const status = document.getElementById('apyStatus');
  status.dataset.stale = String(Boolean(apyState.error));
  const checked = apyState.checkedAt ? `Updated: ${apyDate(apyState.checkedAt)}` : 'Not updated yet';
  status.textContent = apyState.error ? `${apyState.markets ? 'Stale data · ' : ''}${apyState.error} · ${checked}`
    : apyState.checkedAt ? checked : 'Loading APY…';
}

async function fetchApy() {
  if (apyState.inFlight || Date.now() < apyState.retryAt) return;
  apyState.inFlight = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(APY_ENDPOINT, { signal: controller.signal });
    if (response.status === 429) {
      apyState.retryAt = Date.now() + apyRetryDelay(response.headers.get('Retry-After'));
      throw new Error('Rate limited; waiting to retry');
    }
    if (!response.ok) throw new Error(`Unable to load APY (${response.status})`);
    const markets = await response.json();
    if (!Array.isArray(markets) || markets.some(m => !m || typeof m !== 'object' || Array.isArray(m))) throw new Error('Invalid APY data');
    apyState.markets = markets;
    apyState.checkedAt = Date.now();
    apyState.error = '';
    apyState.retryAt = 0;
    if (typeof evaluateLimitAlerts === 'function') evaluateLimitAlerts();
  } catch (error) {
    apyState.error = error.name === 'AbortError' ? 'APY request timed out' : error.message || 'Unable to load APY';
  } finally {
    clearTimeout(timeout);
    apyState.inFlight = false;
    renderApy();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    renderApy();
    fetchApy();
    setInterval(() => { renderApy(); fetchApy(); }, 2000);
  });
}
