// Queue selection deliberately remains disabled until the on-chain decoder is validated.
const limitState = { records: {}, edges: new Map(), enabled: false, storageError: false };
const LIMIT_STORAGE = 'exponent-limit-monitor-v2';
let limitAudio = null;
const limitAlarm = { entries: new Map(), source: null, generation: 0 };
function renderLimitAlarm() {
  const panel = document.getElementById('limitAlarmPanel');
  if (!panel) return;
  panel.hidden = limitAlarm.entries.size === 0;
  document.getElementById('limitAlarmItems').textContent = [...limitAlarm.entries.values()].join('\n');
  document.getElementById('limitAlarmData').textContent = apyState.error || Date.now() - apyState.checkedAt > 10000
    ? 'Dữ liệu APY cũ / mất kết nối. Báo thức vẫn tiếp tục đến khi bấm Dừng.'
    : 'Đã ghi nhận điều kiện cảnh báo. Âm tiếp tục kể cả khi APY hồi phục, đến khi bấm Dừng.';
}
function startLimitAlarmAudio() {
  if (!limitAlarm.entries.size || limitAlarm.source) return;
  if (!limitAudio || limitAudio.state !== 'running') {
    limitAudioStatus('Báo thức đang chờ âm thanh. Bấm Thử âm APY để mở khóa.'); return;
  }
  try {
    // Continuous high-volume-style alarm on the audio clock; no silent polling gap.
    const rate = limitAudio.sampleRate;
    const buffer = limitAudio.createBuffer(1, Math.round(rate * 0.88), rate), samples = buffer.getChannelData(0);
    [220, 660, 880, 660].forEach((frequency, index) => {
      for (let n = 0; n < Math.floor(rate * 0.22); n++) {
        const t = n / rate;
        const envelope = Math.min(1, t / 0.008, (0.22 - t) / 0.008);
        // Band-limited sawtooth approximation avoids harsh aliased high harmonics.
        let wave = 0;
        for (let harmonic = 1; harmonic <= Math.min(12, Math.floor(rate / (2 * frequency))); harmonic++)
          wave += Math.sin(2 * Math.PI * frequency * harmonic * t) / harmonic;
        samples[Math.floor(index * 0.22 * rate) + n] = 0.65 * envelope * (2 / Math.PI) * wave;
      }
    });
    const source = limitAudio.createBufferSource();
    source.buffer = buffer; source.loop = true; source.connect(limitAudio.destination);
    source.start(); limitAlarm.source = source;
    limitAudioStatus('');
  } catch { limitAudioStatus('Không phát được báo thức. Bấm Thử âm APY và kiểm tra quyền âm thanh.'); }
}
function stopLimitAlarm() {
  limitAlarm.generation++;
  if (limitAlarm.source) {
    try { limitAlarm.source.stop(); limitAlarm.source.disconnect(); } catch { /* Already stopped. */ }
    limitAlarm.source = null;
  }
  limitAlarm.entries.clear();
  // Preserve edge states: acknowledging does not re-arm a still-triggered market.
  renderLimitAlarm();
}
function limitAudioStatus(message) {
  const status = document.getElementById('limitAudioStatus');
  if (status) status.textContent = message;
}
function unlockLimitAudio() {
  try {
    if (!limitAudio) {
      limitAudio = new (window.AudioContext || window.webkitAudioContext)();
      limitAudio.onstatechange = () => {
        if (limitAudio.state !== 'running' && limitAlarm.entries.size) limitAudioStatus('Báo thức bị trình duyệt đình chỉ. Bấm Thử âm APY để tiếp tục.');
      };
    }
    const generation = limitAlarm.generation;
    const resumed = limitAudio.resume();
    limitAudioStatus(limitAudio.state === 'running' ? '' : 'Nếu chưa nghe được âm, bấm Thử âm APY và cho phép âm thanh cho trang.');
    return Promise.resolve(resumed).then(() => {
      const ready = limitAudio.state === 'running';
      limitAudioStatus(ready ? '' : 'Trình duyệt chặn âm thanh. Bấm Thử âm APY hoặc cho phép âm thanh cho trang.');
      if (ready && generation === limitAlarm.generation) startLimitAlarmAudio();
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
    [220, 660, 880, 660].forEach((frequency, i) => {
      const oscillator = limitAudio.createOscillator(), gain = limitAudio.createGain();
      oscillator.connect(gain); gain.connect(limitAudio.destination);
      oscillator.type = 'sawtooth'; oscillator.frequency.value = frequency;
      const start = limitAudio.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.65, start + 0.008);
      gain.gain.setValueAtTime(0.65, start + 0.212);
      gain.gain.linearRampToValueAtTime(0, start + 0.22);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start); oscillator.stop(start + 0.22);
    });
    limitAudioStatus('');
  } catch { limitAudioStatus('Không phát được âm APY. Bấm Thử âm APY để thử lại.'); }
}
function limitGapAtOrBelow(marketPercent, manualPercent, threshold) {
  // Tolerance only removes floating-point subtraction noise at an equal boundary.
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(marketPercent), Math.abs(manualPercent), threshold) * 4;
  return marketPercent - manualPercent - threshold <= tolerance;
}

function limitNumber(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function limitKey(market) {
  return JSON.stringify([market.vaultAddress, market.maturityDateUnixTs]);
}
function saveLimits() {
  try {
    localStorage.setItem(LIMIT_STORAGE, JSON.stringify({ records: limitState.records }));
    limitState.storageError = false;
  } catch { limitState.storageError = true; }
  const status = document.getElementById('limitStorageStatus');
  if (status) status.textContent = limitState.storageError
    ? 'Không lưu được trên trình duyệt; thiết lập chỉ giữ trong phiên này.'
    : '';
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
  const key = market ? limitKey(market) : '';
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
  if (apyState.error || !apyState.checkedAt || Date.now() - apyState.checkedAt > 8000) return;
  const messages = [];
  for (const [assetKey, asset] of Object.entries(ASSETS)) {
    const market = farthestApyMarket(apyState.markets || [], asset.mint, Date.now() / 1000);
    if (!market) continue;
    const key = limitKey(market), record = limitState.records[key] || {};
    const apy = limitNumber(record.apy), threshold = limitNumber(record.threshold);
    if (apy === null || threshold === null || typeof market.impliedApy !== 'number' || !Number.isFinite(market.impliedApy * 100)) {
      limitState.edges.delete(key); continue;
    }
    const gap = market.impliedApy * 100 - apy;
    const triggered = limitGapAtOrBelow(market.impliedApy * 100, apy, threshold);
    const previous = limitState.edges.get(key);
    limitState.edges.set(key, triggered);
    if (previous === true || !triggered || !limitState.enabled || (selectedAssets.size && !selectedAssets.has(assetKey))) continue;
    const message = `${asset.label}: chênh lệch ${gap >= 0 ? '+' : ''}${gap.toFixed(2)} đpt; ngưỡng ${threshold} đpt. Kỳ hạn ${apyDate(market.maturityDateUnixTs * 1000)}.`;
    if (!limitAlarm.entries.has(key)) {
      limitAlarm.entries.set(key, message);
      messages.push(message);
    }
  }
  if (messages.length) {
    const body = messages.join('\n');
    startLimitAlarmAudio();
    renderLimitAlarm();
    // Synchronous notification creation: no delayed callback can alert for a previous wallet.
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification('Chênh lệch APY ≤ ngưỡng', { body, tag: 'limit-apy', silent: true }); } catch { /* Inline alert remains available. */ }
    }
  }
}
if (typeof window !== 'undefined') window.addEventListener('load', () => {
  try {
    const current = localStorage.getItem(LIMIT_STORAGE);
    const saved = JSON.parse(current || '{}');
    if (saved.records && typeof saved.records === 'object' && !Array.isArray(saved.records)) limitState.records = saved.records;
    if (!current) {
      const legacy = JSON.parse(localStorage.getItem('exponent-limit-monitor-v1') || '{}');
      for (const [key, value] of Object.entries(legacy.records || {})) {
        try {
          const [wallet, vault, maturity] = JSON.parse(key);
          if (wallet === legacy.wallet && typeof vault === 'string' && Number.isFinite(maturity))
            limitState.records[JSON.stringify([vault, maturity])] = value;
        } catch { /* Ignore malformed legacy keys. */ }
      }
    }
  } catch { /* Corrupt or unavailable storage must not prevent use. */ }
  document.getElementById('limitAlerts').addEventListener('change', event => {
    limitState.enabled = event.target.checked; limitState.edges.clear();
    if (!limitState.enabled) stopLimitAlarm();
    if (limitState.enabled) unlockLimitAudio();
    if (limitState.enabled && typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  });
  document.getElementById('testLimitAudio').addEventListener('click', () => {
    const generation = limitAlarm.generation;
    unlockLimitAudio().then(ready => { if (ready && generation === limitAlarm.generation && !limitAlarm.entries.size) playLimitApyAlert(); });
  });
  document.getElementById('stopLimitAlarm').addEventListener('click', stopLimitAlarm);
  setInterval(renderLimitAlarm, 2000);
  saveLimits(); renderApy();
});
