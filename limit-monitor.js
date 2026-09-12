// Queue selection deliberately remains disabled until the on-chain decoder is validated.
const limitState = { wallet: '', records: {}, edges: new Map(), enabled: false, storageError: false };
const LIMIT_STORAGE = 'exponent-limit-monitor-v1';
let limitAudio = null;
function limitAudioStatus(message) {
  const status = document.getElementById('limitAudioStatus');
  if (status) status.textContent = message;
}
function unlockLimitAudio() {
  try {
    if (!limitAudio) limitAudio = new (window.AudioContext || window.webkitAudioContext)();
    const resumed = limitAudio.resume();
    limitAudioStatus(limitAudio.state === 'running' ? '' : 'Nếu chưa nghe được âm, bấm Thử âm APY và cho phép âm thanh cho trang.');
    return Promise.resolve(resumed).then(() => {
      const ready = limitAudio.state === 'running';
      limitAudioStatus(ready ? '' : 'Trình duyệt chặn âm thanh. Bấm Thử âm APY hoặc cho phép âm thanh cho trang.');
      return ready;
    }).catch(() => { limitAudioStatus('Không mở được âm thanh. Bấm Thử âm APY và kiểm tra quyền âm thanh.'); return false; });
  } catch {
    limitAudioStatus('Trình duyệt chưa hỗ trợ hoặc đang chặn âm thanh APY.');
    return Promise.resolve(false);
  }
}
function playLimitApyAlert() {
  if (!limitAudio || limitAudio.state !== 'running') {
    limitAudioStatus('Âm APY chưa sẵn sàng. Bấm Thử âm APY để mở khóa âm thanh.'); return;
  }
  try {
    [1046.5, 1318.5, 1568].forEach((frequency, i) => {
      const oscillator = limitAudio.createOscillator(), gain = limitAudio.createGain();
      oscillator.connect(gain); gain.connect(limitAudio.destination);
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      const start = limitAudio.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.17);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start); oscillator.stop(start + 0.19);
    });
    limitAudioStatus('');
  } catch { limitAudioStatus('Không phát được âm APY. Bấm Thử âm APY để thử lại.'); }
}
function limitGapAtOrBelow(marketPercent, manualPercent, threshold) {
  // Tolerance only removes floating-point subtraction noise at an equal boundary.
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(marketPercent), Math.abs(manualPercent), threshold) * 4;
  return marketPercent - manualPercent - threshold <= tolerance;
}

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
        limitState.edges.delete(row.limitKey); // Recheck edited settings on the next successful APY fetch.
        saveLimits(); renderApy();
      });
      const cell = cells[index === 0 ? 0 : 2];
      const error = document.createElement('small');
      error.id = `limit-${assetKey}-${field}-error`;
      error.style.color = '#ffb4a8';
      input.setAttribute('aria-describedby', error.id);
      input.limitError = error;
      cell.appendChild(input); cell.appendChild(error); return input;
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
  row.limitInputs.forEach((input, index) => {
    input.disabled = !key;
    const invalid = input.value !== '' && limitNumber(input.value) === null;
    input.setAttribute('aria-invalid', String(invalid));
    input.limitError.textContent = invalid ? `${index ? 'Ngưỡng' : 'APY'} phải là số không âm (ví dụ 0.10); cảnh báo market này đang tắt.` : '';
  });
  const apy = limitNumber(record.apy);
  const gap = market && typeof market.impliedApy === 'number' && Number.isFinite(market.impliedApy * 100) && apy !== null
    ? market.impliedApy * 100 - apy : null;
  row.limitGap.textContent = gap === null ? '—' : `${gap >= 0 ? '+' : ''}${gap.toFixed(2)}${apyState.error ? ' (dữ liệu cũ)' : ''}`;
  if (typeof renderRewardRange === 'function') renderRewardRange(row, market, record.apy);
}
function evaluateLimitAlerts() {
  if (!limitState.wallet || apyState.error || !apyState.checkedAt || Date.now() - apyState.checkedAt > 8000) return;
  const messages = [];
  for (const [assetKey, asset] of Object.entries(ASSETS)) {
    const market = farthestApyMarket(apyState.markets || [], asset.mint, Date.now() / 1000);
    if (!market) continue;
    const key = limitKey(limitState.wallet, market), record = limitState.records[key] || {};
    const apy = limitNumber(record.apy), threshold = limitNumber(record.threshold);
    if (apy === null || threshold === null || typeof market.impliedApy !== 'number' || !Number.isFinite(market.impliedApy * 100)) {
      limitState.edges.delete(key); continue;
    }
    const gap = market.impliedApy * 100 - apy;
    const triggered = limitGapAtOrBelow(market.impliedApy * 100, apy, threshold);
    const previous = limitState.edges.get(key);
    limitState.edges.set(key, triggered);
    if (previous === true || !triggered || !limitState.enabled || (selectedAssets.size && !selectedAssets.has(assetKey))) continue;
    messages.push(`${asset.label}: chênh lệch ${gap >= 0 ? '+' : ''}${gap.toFixed(2)} đpt; ngưỡng ${threshold} đpt. Kỳ hạn ${apyDate(market.maturityDateUnixTs * 1000)}.`);
  }
  if (messages.length) {
    const body = `${messages.join('\n')}\nVí ${limitState.wallet}`;
    playLimitApyAlert();
    document.getElementById('limitAlertStatus').textContent = `Chênh lệch APY ≤ ngưỡng · ${body}`;
    // Synchronous notification creation: no delayed callback can alert for a previous wallet.
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification('Chênh lệch APY ≤ ngưỡng', { body, tag: `limit-${limitState.wallet}`, silent: true }); } catch { /* Inline alert remains available. */ }
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
    if (limitState.enabled) unlockLimitAudio();
    if (limitState.enabled && typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  });
  document.getElementById('testLimitAudio').addEventListener('click', () => {
    unlockLimitAudio().then(ready => { if (ready) playLimitApyAlert(); });
  });
  saveLimits(); renderApy();
});
