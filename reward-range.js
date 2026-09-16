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
function rewardCandidates(campaigns, market, now, orderType='buyYT') {
  if (!market || !Array.isArray(market.orderbookAddresses)) return null;
  return campaigns.filter(c => c.vaultAddress === market.vaultAddress
    && market.orderbookAddresses.includes(c.orderbookAddress)
    && c.campaignType === 'orderbook_quote' && Array.isArray(c.incentivizedOrderTypes) && c.incentivizedOrderTypes.includes(orderType)
    && c.isActive !== false)
    .filter(c => {
      const start = Date.parse(c.startsAt), end = Date.parse(c.endsAt);
      // Keep incomplete records visible as unknown rather than reporting no campaign.
      return (!Number.isFinite(start) || start <= now) && (!Number.isFinite(end) || end > now) && rewardBudget(c) !== false;
    }).sort((a,b) => String(a.id).localeCompare(String(b.id)));
}
function rewardPosition(band, manual) {
  if (manual == null || manual.trim() === '') return 'Enter My APY';
  const value = limitNumber(manual);
  if (value === null) return 'Invalid My APY';
  if (value < band.low) return 'Below range';
  if (value > band.high) return 'Above range';
  return 'Within range';
}
function limitRewardRangeCheck(market, manual, orderType='buyYT') {
  const state = rewardRangeState;
  if (!Number.isFinite(manual) || state.error || !state.checkedAt || Date.now() - state.checkedAt > 8000 || !state.campaigns) return null;
  const campaigns = rewardCandidates(state.campaigns, market, Date.now(), orderType);
  if (!campaigns?.length) return null;
  const bands = campaigns.map(c => Number.isFinite(Date.parse(c.startsAt)) && Number.isFinite(Date.parse(c.endsAt)) && rewardBudget(c) === true ? rewardBand(c) : null);
  // Membership is a union, never the envelope between disjoint campaigns.
  if (bands.some(b => b && manual >= b.low && manual <= b.high)) return { outside: false, label: '' };
  if (bands.some(b => !b)) return null;
  return { outside: true, label: bands.map(b => `${b.low.toFixed(6)}%–${b.high.toFixed(6)}%`).join(' / ') };
}
function formatRewardsApy(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value.toFixed(2)}%` : '—';
}
function formatInwardRange(low, high) {
  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high || Math.max(Math.abs(low),Math.abs(high)) > 1e10) return '—';
  let lower = Math.ceil(low * 1000), upper = Math.floor(high * 1000);
  // Compare back in the original units, avoiding multiplication-rounding at exact boundaries.
  while (lower / 1000 < low) lower++;
  while ((lower - 1) / 1000 >= low) lower--;
  while (upper / 1000 > high) upper--;
  while ((upper + 1) / 1000 <= high) upper++;
  return lower > upper ? 'No valid 3-decimal value' : `${(lower / 1000).toFixed(3)}%–${(upper / 1000).toFixed(3)}%`;
}
function renderRewardRange(row, market, manual) {
  if (!row.rewardCell) {
    row.rewardCell = document.createElement('td');
    row.rewardCell.dataset.label = 'APY Range';
    row.rewardCell.className = 'amount';
    row.insertBefore(row.rewardCell, row.apyCells ? row.apyCells[3] : row.limitGap);
  }
  if (!row.rewardsApyCell) {
    row.rewardsApyCell = document.createElement('td');
    row.rewardsApyCell.dataset.label = 'Est. Reward APY';
    row.rewardsApyCell.className = 'amount';
    row.insertBefore(row.rewardsApyCell, row.rewardCell);
  }
  const state = rewardRangeState;
  const stale = !!state.error || !state.checkedAt || Date.now() - state.checkedAt > 10000 || !!apyState.error;
  const buyCandidates = state.campaigns && rewardCandidates(state.campaigns, market, Date.now(),'buyYT');
  const sellCandidates = state.campaigns && rewardCandidates(state.campaigns, market, Date.now(),'sellYT');
  const signature=list=>(list||[]).map(c=>c.id).join('|'),split=!!sellCandidates?.length&&signature(buyCandidates)!==signature(sellCandidates);
  const candidates=split?[...(buyCandidates||[]).map(c=>({c,side:'Buy'})),...(sellCandidates||[]).map(c=>({c,side:'Sell'}))]:(buyCandidates||[]).map(c=>({c,side:''}));
  const entries = candidates?.map(({c,side}) => {
    const band = rewardBand(c);
    const complete = Number.isFinite(Date.parse(c.startsAt)) && Number.isFinite(Date.parse(c.endsAt)) && rewardBudget(c) === true;
    return { id: c.id, side, band: complete ? band : null, rewardsApy: complete ? formatRewardsApy(c.currentRewardsApy) : '—' };
  });
  const model = JSON.stringify({ entries, stale, manual });
  if (row.rewardCell.dataset.model === model) return;
  row.rewardCell.dataset.model = model;
  row.rewardCell.replaceChildren();
  row.rewardsApyCell.replaceChildren();
  const rewardsWrap = document.createElement('div');
  if (!entries?.length) rewardsWrap.textContent = '—';
  else for (const entry of entries) {
    const item = document.createElement('div');
    item.textContent = (entry.side?entry.side+' ':'')+entry.rewardsApy + (stale && entry.rewardsApy !== '—' ? ' *' : '');
    item.title = stale && entry.rewardsApy !== '—' ? 'Stale data' : '';
    rewardsWrap.appendChild(item);
  }
  row.rewardsApyCell.appendChild(rewardsWrap);
  const wrap = document.createElement('div');
  if (!entries || (!entries.length && stale)) wrap.textContent = '—';
  else if (!entries.length) wrap.textContent = '—';
  else for (const entry of entries) {
    const item = document.createElement('div');
    if (!entry.band) item.textContent = '—';
    else {
      const {low, high} = entry.band;
      item.textContent = (entry.side?entry.side+' ':'')+formatInwardRange(low, high) + (stale ? ' *' : '');
      item.title = `${stale ? 'Stale data · ' : ''}Rounded inward. Range may change; not confirmation of order rewards.`;
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
      throw new Error('Range rate limited; waiting to retry');
    }
    if (!response.ok) throw new Error(`Unable to load range (${response.status})`);
    const data = await response.json();
    if (!Array.isArray(data.campaigns) || data.campaigns.some(c => !c || typeof c !== 'object' || Array.isArray(c))) throw new Error('Invalid range data');
    state.campaigns = data.campaigns; state.checkedAt = Date.now(); state.error = ''; state.retryAt = 0;
    if (typeof evaluateLimitAlerts === 'function') evaluateLimitAlerts();
  } catch (error) {
    state.error = error.name === 'AbortError' ? 'Range request timed out' : error.message;
  } finally {
    clearTimeout(timeout); state.inFlight = false;
    const status = document.getElementById('rewardRangeStatus');
    if (status) status.textContent = `${state.error ? 'Range stale / unknown · ' + state.error + ' · ' : ''}Range: ${state.checkedAt ? 'Updated: ' + apyDate(state.checkedAt) : 'Not updated yet'}`;
    renderApy();
  }
}
if (typeof window !== 'undefined') window.addEventListener('load', () => {
  fetchRewardRanges();
  setInterval(fetchRewardRanges, 2000);
});
