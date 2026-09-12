const REWARD_RANGE_ENDPOINT = 'https://app.exponent.finance/api/orderbook-emissions/campaigns';
const rewardRangeState = { campaigns: null, checkedAt: 0, error: '', inFlight: false, retryAt: 0 };

function rewardBand(campaign) {
  const value = campaign.marketImpliedApy, bps = campaign.priceBandBps;
  if (typeof value !== 'number' || !Number.isFinite(value) || typeof bps !== 'number' || !Number.isFinite(bps) || bps < 0) return null;
  const r = Math.abs(value) <= 10 ? value : value / 1000000;
  const d = Math.abs(r) * bps / 10000;
  const low = 100 * Math.expm1(r - d), high = 100 * Math.expm1(r + d);
  return Number.isFinite(low) && Number.isFinite(high) ? { low, high } : null;
}
function rewardBudget(c) {
  if (!/^\d+$/.test(c.fundingAmountRaw || '') || !/^\d+$/.test(c.distributedRaw || '')) return null;
  return BigInt(c.fundingAmountRaw) > BigInt(c.distributedRaw);
}
function rewardCandidates(campaigns, market, now) {
  if (!market || !Array.isArray(market.orderbookAddresses)) return null;
  return campaigns.filter(c => c.vaultAddress === market.vaultAddress
    && market.orderbookAddresses.includes(c.orderbookAddress)
    && c.campaignType === 'orderbook_quote' && Array.isArray(c.incentivizedOrderTypes) && c.incentivizedOrderTypes.includes('buyYT')
    && c.isActive !== false)
    .filter(c => {
      const start = Date.parse(c.startsAt), end = Date.parse(c.endsAt);
      // Keep incomplete records visible as unknown rather than reporting no campaign.
      return (!Number.isFinite(start) || start <= now) && (!Number.isFinite(end) || end > now) && rewardBudget(c) !== false;
    }).sort((a,b) => String(a.id).localeCompare(String(b.id)));
}
function rewardPosition(band, manual) {
  if (manual == null || manual.trim() === '') return 'Chưa nhập My APY';
  const value = limitNumber(manual);
  if (value === null) return 'My APY không hợp lệ';
  if (value < band.low) return 'Dưới range';
  if (value > band.high) return 'Trên range';
  return 'Trong range';
}
function renderRewardRange(row, market, manual) {
  if (!row.rewardCell) {
    row.rewardCell = document.createElement('td');
    row.rewardCell.dataset.label = 'Implied APY range';
    row.insertBefore(row.rewardCell, row.limitGap);
  }
  const state = rewardRangeState;
  const stale = !!state.error || !state.checkedAt || Date.now() - state.checkedAt > 10000 || !!apyState.error;
  const candidates = state.campaigns && rewardCandidates(state.campaigns, market, Date.now());
  const entries = candidates?.map(c => {
    const band = rewardBand(c);
    const complete = Number.isFinite(Date.parse(c.startsAt)) && Number.isFinite(Date.parse(c.endsAt)) && rewardBudget(c) === true;
    return { id: c.id, band: complete ? band : null };
  });
  const model = JSON.stringify({ entries, stale, manual });
  if (row.rewardCell.dataset.model === model) return;
  row.rewardCell.dataset.model = model;
  row.rewardCell.replaceChildren();
  const wrap = document.createElement('div');
  if (!entries || (!entries.length && stale)) wrap.textContent = 'Chưa xác định';
  else if (!entries.length) wrap.textContent = 'Chưa có chương trình thưởng còn hiệu lực';
  else for (const entry of entries) {
    const item = document.createElement('div');
    if (!entry.band) item.textContent = 'Chưa xác định';
    else {
      const {low, high} = entry.band;
      item.textContent = `${low.toFixed(2)}%–${high.toFixed(2)}% · ${stale ? 'Dữ liệu cũ · Chưa xác định' : rewardPosition(entry.band, manual)}`;
      const details = document.createElement('details'), summary = document.createElement('summary'), precision = document.createElement('div');
      summary.textContent = 'Chi tiết range';
      precision.textContent = `${low}% – ${high}% · Campaign: ${entry.id}`;
      details.append(summary, precision); item.appendChild(details);
    }
    wrap.appendChild(item);
  }
  row.rewardCell.appendChild(wrap);
}
async function fetchRewardRanges() {
  const state = rewardRangeState;
  if (state.inFlight || Date.now() < state.retryAt) return;
  state.inFlight = true;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(REWARD_RANGE_ENDPOINT, {signal: controller.signal});
    if (response.status === 429) {
      state.retryAt = Date.now() + apyRetryDelay(response.headers.get('Retry-After'));
      throw new Error('Nguồn range giới hạn truy cập, đang chờ thử lại');
    }
    if (!response.ok) throw new Error(`Không tải được range (${response.status})`);
    const data = await response.json();
    if (!Array.isArray(data.campaigns) || data.campaigns.some(c => !c || typeof c !== 'object' || Array.isArray(c))) throw new Error('Dữ liệu range không hợp lệ');
    state.campaigns = data.campaigns; state.checkedAt = Date.now(); state.error = ''; state.retryAt = 0;
  } catch (error) {
    state.error = error.name === 'AbortError' ? 'Nguồn range phản hồi quá chậm' : error.message;
  } finally {
    clearTimeout(timeout); state.inFlight = false;
    const status = document.getElementById('rewardRangeStatus');
    if (status) status.textContent = `${state.error ? 'Dữ liệu range cũ / chưa xác định · ' + state.error + ' · ' : ''}Range: ${state.checkedAt ? 'Lần kiểm tra thành công gần nhất: ' + apyDate(state.checkedAt) : 'Chưa kiểm tra thành công'}`;
    renderApy();
  }
}
if (typeof window !== 'undefined') window.addEventListener('load', () => {
  fetchRewardRanges();
  setInterval(fetchRewardRanges, 2000);
});
