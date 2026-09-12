// Queue selection deliberately remains disabled until the on-chain decoder is validated.
const limitState = { wallet: '', records: {}, edges: new Map(), enabled: false, storageError: false };
const LIMIT_STORAGE = 'exponent-limit-monitor-v1';

function validLimitWallet(value) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const c of value) n = n * 58n + BigInt(alphabet.indexOf(c));
  let bytes = 0;
  while (n > 0n) { bytes++; n >>= 8n; }
  return bytes + (value.match(/^1*/) || [''])[0].length === 32;
}
function limitNumber(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function limitKey(wallet, market) {
  return JSON.stringify([wallet, market.vaultAddress, market.maturityDateUnixTs]);
}
function saveLimits() {
  try {
    localStorage.setItem(LIMIT_STORAGE, JSON.stringify({ wallet: limitState.wallet, records: limitState.records }));
    limitState.storageError = false;
  } catch { limitState.storageError = true; }
  document.getElementById('limitWalletStatus').textContent = limitState.storageError
    ? 'Không lưu được trên trình duyệt; thiết lập chỉ giữ trong phiên này.'
    : limitState.wallet ? `Ví đang theo dõi APY: ${limitState.wallet}` : 'Nhập ví và bấm Load orders để cấu hình APY.';
}
function setLimitWallet(wallet) {
  limitState.wallet = wallet;
  limitState.edges.clear();
  document.getElementById('limitAlertStatus').textContent = '';
  saveLimits();
  renderApy();
}
function renderLimitCells(row, assetKey, market) {
  if (!row.limitInputs) {
    const cells = ['My Limit Order APY (%)', 'Chênh lệch (đpt)', 'Ngưỡng (đpt)'].map(label => {
      const td = document.createElement('td'); td.dataset.label = label; row.appendChild(td); return td;
    });
    const inputs = ['apy', 'threshold'].map((field, index) => {
      const input = document.createElement('input');
      input.type = 'text'; input.inputMode = 'decimal'; input.placeholder = '—'; input.style.width = '95px';
      input.setAttribute('aria-label', `${ASSETS[assetKey].label} ${field === 'apy' ? 'My Limit Order APY (%)' : 'Ngưỡng (đpt)'}`);
      input.addEventListener('input', () => {
        if (!row.limitKey) return;
        const record = limitState.records[row.limitKey] || {};
        record[field] = input.value;
        limitState.records[row.limitKey] = record;
        limitState.edges.delete(row.limitKey); // Editing establishes a new baseline, never an alert.
        saveLimits(); renderApy();
      });
      cells[index === 0 ? 0 : 2].appendChild(input); return input;
    });
    row.limitInputs = inputs; row.limitGap = cells[1];
  }
  const key = limitState.wallet && market ? limitKey(limitState.wallet, market) : '';
  const record = limitState.records[key] || {};
  if (row.limitKey !== key) {
    row.limitKey = key;
    row.limitInputs[0].value = typeof record.apy === 'string' ? record.apy : '';
    row.limitInputs[1].value = typeof record.threshold === 'string' ? record.threshold : '';
  }
  row.limitInputs.forEach(input => {
    input.disabled = !key;
    input.setAttribute('aria-invalid', String(input.value !== '' && limitNumber(input.value) === null));
  });
  const apy = limitNumber(record.apy);
  const gap = market && typeof market.impliedApy === 'number' && Number.isFinite(market.impliedApy * 100) && apy !== null
    ? market.impliedApy * 100 - apy : null;
  row.limitGap.textContent = gap === null ? '—' : `${gap >= 0 ? '+' : ''}${gap.toFixed(2)}${apyState.error ? ' (dữ liệu cũ)' : ''}`;
}
function evaluateLimitAlerts() {
  if (!limitState.wallet || apyState.error || !apyState.checkedAt || Date.now() - apyState.checkedAt > 8000) return;
  for (const [assetKey, asset] of Object.entries(ASSETS)) {
    const market = farthestApyMarket(apyState.markets || [], asset.mint, Date.now() / 1000);
    if (!market) continue;
    const key = limitKey(limitState.wallet, market), record = limitState.records[key] || {};
    const apy = limitNumber(record.apy), threshold = limitNumber(record.threshold);
    if (apy === null || threshold === null || typeof market.impliedApy !== 'number' || !Number.isFinite(market.impliedApy * 100)) {
      limitState.edges.delete(key); continue;
    }
    const gap = market.impliedApy * 100 - apy;
    const inside = Math.abs(gap) <= threshold + Number.EPSILON * Math.max(1, Math.abs(apy)) * 4;
    const previous = limitState.edges.get(key);
    limitState.edges.set(key, inside);
    if (previous !== false || !inside || !limitState.enabled || (selectedAssets.size && !selectedAssets.has(assetKey))) continue;
    const body = `${asset.label}: chênh lệch ${gap.toFixed(2)} đpt; ngưỡng ${threshold} đpt. Kỳ hạn ${apyDate(market.maturityDateUnixTs * 1000)}. Ví ${limitState.wallet}`;
    document.getElementById('limitAlertStatus').textContent = body;
    // Synchronous notification creation: no delayed callback can alert for a previous wallet.
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification('Khoảng cách APY vào ngưỡng cảnh báo', { body, tag: `limit-${key}` }); } catch { /* Inline alert remains available. */ }
    }
  }
}
if (typeof window !== 'undefined') window.addEventListener('load', () => {
  try {
    const saved = JSON.parse(localStorage.getItem(LIMIT_STORAGE) || '{}');
    if (saved.records && typeof saved.records === 'object' && !Array.isArray(saved.records)) limitState.records = saved.records;
    if (validLimitWallet(saved.wallet || '')) limitState.wallet = saved.wallet;
  } catch { /* Corrupt or unavailable storage must not prevent use. */ }
  const input = document.getElementById('limitWallet');
  input.value = limitState.wallet;
  // Stop old-wallet alerts immediately while the user edits the address.
  input.addEventListener('input', () => { if (input.value.trim() !== limitState.wallet) setLimitWallet(''); });
  document.getElementById('loadLimitOrders').addEventListener('click', () => {
    const wallet = input.value.trim();
    if (!validLimitWallet(wallet)) {
      document.getElementById('limitWalletStatus').textContent = 'Địa chỉ Solana không hợp lệ (cần public key 32 byte).'; return;
    }
    setLimitWallet(wallet);
    document.getElementById('queueStatus').textContent = 'Chưa xác minh được vị trí · Đã chọn ví, nhưng chưa thể tải danh sách lệnh được xác minh. Chọn mốc và cảnh báo hàng chờ đang tắt; không suy diễn từ giao dịch gần đây.';
  });
  document.getElementById('limitAlerts').addEventListener('change', event => {
    limitState.enabled = event.target.checked; limitState.edges.clear();
    if (limitState.enabled && typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  });
  saveLimits(); renderApy();
});
