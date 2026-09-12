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
  return new Date(ms).toLocaleString('vi-VN', { timeZone: 'Asia/Saigon', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
      for (const label of ['Token', 'Ngày đáo hạn', 'Thời gian còn lại', 'Implied APY']) {
        const cell = document.createElement('td');
        cell.dataset.label = label;
        row.appendChild(cell);
      }
      row.lastElementChild.className = 'amount';
      body.appendChild(row);
    }
    row.hidden = selectedAssets.size > 0 && !selectedAssets.has(key);
    const market = farthestApyMarket(apyState.markets || [], asset.mint, now / 1000);
    const minutes = market ? Math.max(1, Math.ceil((market.maturityDateUnixTs * 1000 - now) / 60000)) : 0;
    const remaining = minutes >= 1440 ? `${Math.floor(minutes / 1440)} ngày ${Math.floor(minutes % 1440 / 60)} giờ`
      : `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút`;
    const values = [asset.label, market ? apyDate(market.maturityDateUnixTs * 1000)
      : apyState.markets ? 'Chưa có market còn hạn' : '—', market ? remaining : '—', market ? formatImpliedApy(market.impliedApy) : '—'];
    values.forEach((value, i) => { if (row.children[i].textContent !== value) row.children[i].textContent = value; });
  }
  const status = document.getElementById('apyStatus');
  status.dataset.stale = String(Boolean(apyState.error));
  const checked = apyState.checkedAt ? `Lần kiểm tra thành công gần nhất: ${apyDate(apyState.checkedAt)}` : 'Chưa kiểm tra thành công';
  status.textContent = apyState.error ? `${apyState.markets ? 'Dữ liệu cũ · ' : ''}${apyState.error} · ${checked}`
    : apyState.checkedAt ? checked : 'Đang tải APY…';
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
      throw new Error('Nguồn giới hạn truy cập, đang chờ thử lại');
    }
    if (!response.ok) throw new Error(`Không tải được APY (${response.status})`);
    const markets = await response.json();
    if (!Array.isArray(markets) || markets.some(m => !m || typeof m !== 'object' || Array.isArray(m))) throw new Error('Dữ liệu APY không hợp lệ');
    apyState.markets = markets;
    apyState.checkedAt = Date.now();
    apyState.error = '';
    apyState.retryAt = 0;
  } catch (error) {
    apyState.error = error.name === 'AbortError' ? 'Nguồn APY phản hồi quá chậm' : error.message || 'Không tải được APY';
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
