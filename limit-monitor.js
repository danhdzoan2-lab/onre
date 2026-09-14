// Independent gap and reward-range alarm edges, sharing one latched audio loop.
const limitState = { records: {}, edges: new Map(), enabled: false, storageError: false };
const LIMIT_STORAGE = 'exponent-limit-monitor-v2';
let limitAudio = null;
const limitAlarm = { entries: new Map(), source: null, generation: 0 };
function renderLimitAlarmRow(row) {
  // Stable attribute keeps the CSS animation running across refreshes.
  const active = Boolean(row.limitKey && limitAlarm.entries.has(row.limitKey));
  row.dataset.alarm = active ? 'true' : 'false';
}
function renderLimitAlarm() {
  if (typeof renderOrderWatches === 'function') renderOrderWatches();
  for (const key of Object.keys(ASSETS)) {
    const row = document.getElementById(`apy-${key}`);
    if (row) renderLimitAlarmRow(row);
  }
  const panel = document.getElementById('limitAlarmPanel');
  if (!panel) return;
  panel.hidden = limitAlarm.entries.size === 0;
  document.getElementById('limitAlarmItems').textContent = [...limitAlarm.entries.values()].join('\n');
  document.getElementById('limitAlarmData').textContent = apyState.error || Date.now() - apyState.checkedAt > 10000
    ? 'APY data stale / offline. Press Stop Alarm to silence.'
    : 'Alarm stays on until stopped.';
}
function startLimitAlarmAudio() {
  if (!limitAlarm.entries.size || limitAlarm.source) return;
  if (!limitAudio || limitAudio.state !== 'running') {
    limitAudioStatus('Audio locked. Turn APY Alarm off and on to enable audio.'); return;
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
  } catch { limitAudioStatus('Playback failed. Check site audio permissions, then turn APY Alarm off and on.'); }
}
function stopLimitAlarm() {
  if (typeof acknowledgeOrderWatches === 'function') acknowledgeOrderWatches();
  limitAlarm.generation++;
  if (limitAlarm.source) {
    try { limitAlarm.source.stop(); limitAlarm.source.disconnect(); } catch { /* Already stopped. */ }
    limitAlarm.source = null;
  }
  limitAlarm.entries.clear();
  // Preserve edge states: acknowledging does not re-arm a still-triggered market.
  renderLimitAlarm();
}
function handleLimitAlarmSpace(event) {
  if ((event.code !== 'Space' && event.key !== ' ') || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || !limitAlarm.entries.size) return;
  const target = event.target;
  if (target?.isContentEditable || target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
  event.preventDefault(); // Do not scroll or activate a focused button while silencing.
  event.stopPropagation();
  stopLimitAlarm();
}
function limitAudioStatus(message) {
  const status = document.getElementById('limitAudioStatus');
  if (status) status.textContent = message;
}
function limitNotificationStatus(message) {
  const status = document.getElementById('limitNotificationStatus');
  if (status) status.textContent = message;
}
function updateLimitNotificationPermission() {
  if (!limitState.enabled) { limitNotificationStatus(''); return; }
  const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  limitNotificationStatus(permission === 'granted' ? '' : permission === 'denied'
    ? 'Desktop notifications blocked. Allow notifications for this site in your browser settings.'
    : permission === 'unsupported' ? 'Desktop notifications unavailable. Open this page in Chrome or Edge.'
    : 'Allow browser notifications to receive APY desktop alerts.');
}
async function notifyLimitAlarm(body, isRelevant = () => true) {
  updateLimitNotificationPermission();
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const generation = limitAlarm.generation;
  const isCurrent = () => limitState.enabled && limitAlarm.entries.size > 0 && generation === limitAlarm.generation && isRelevant();
  const options = { body, tag: 'limit-apy', renotify: true, requireInteraction: true, silent: true };
  try {
    if (typeof showBrowserNotification === 'function') {
      const shown = await showBrowserNotification('APY Alarm', options, isCurrent);
      if (shown === false && isCurrent()) limitNotificationStatus('Desktop notification failed. Check browser and Windows notification settings.');
    } else if (isCurrent()) {
      const notice = new Notification('APY Alarm', options);
      notice.onclick = () => { window.focus(); notice.close(); };
    }
  } catch {
    if (isCurrent()) limitNotificationStatus('Desktop notification failed. Check browser and Windows notification settings.');
  }
}
function unlockLimitAudio() {
  try {
    if (!limitAudio) {
      limitAudio = new (window.AudioContext || window.webkitAudioContext)();
      limitAudio.onstatechange = () => {
        if (limitAudio.state !== 'running' && limitAlarm.entries.size) limitAudioStatus('Audio suspended. Turn APY Alarm off and on to resume.');
      };
    }
    const generation = limitAlarm.generation;
    const resumed = limitAudio.resume();
    limitAudioStatus(limitAudio.state === 'running' ? '' : 'Allow site audio, then turn APY Alarm off and on if needed.');
    return Promise.resolve(resumed).then(() => {
      const ready = limitAudio.state === 'running';
      limitAudioStatus(ready ? '' : 'Audio blocked. Allow site audio, then turn APY Alarm off and on.');
      if (ready && generation === limitAlarm.generation) startLimitAlarmAudio();
      return ready;
    }).catch(() => { limitAudioStatus('Cannot unlock audio. Check permissions, then turn APY Alarm off and on.'); return false; });
  } catch {
    limitAudioStatus('Audio unsupported or blocked.');
    return Promise.resolve(false);
  }
}
function playLimitApyAlert() {
  if (!limitAudio || limitAudio.state !== 'running') {
    limitAudioStatus('Audio not ready. Turn APY Alarm off and on.'); return;
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
  } catch { limitAudioStatus('Audio failed. Turn APY Alarm off and on to retry.'); }
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
    ? 'Storage unavailable. Settings kept for this session only.'
    : '';
}
function renderLimitCells(row, assetKey, market) {
  if (!row.limitInputs) {
    const cells = ['My Limit APY', 'Gap', 'Threshold'].map(label => {
      const td = document.createElement('td'); td.dataset.label = label; row.appendChild(td); return td;
    });
    const inputs = ['apy', 'threshold'].map((field, index) => {
      const input = document.createElement('input');
      input.type = 'text'; input.inputMode = 'decimal'; input.placeholder = '—';
      input.setAttribute('aria-label', `${ASSETS[assetKey].label} ${field === 'apy' ? 'My Limit APY' : 'Threshold'}`);
      input.addEventListener('input', () => {
        if (!row.limitKey) return;
        const record = limitState.records[row.limitKey] || {};
        record[field] = input.value;
        limitState.records[row.limitKey] = record;
        limitState.edges.delete(row.limitKey); // Recheck edited settings on the next successful APY fetch.
        limitState.edges.delete(row.limitKey + ':range');
        saveLimits(); renderApy();
      });
      const cell = cells[index === 0 ? 0 : 2];
      const error = document.createElement('small');
      error.id = `limit-${assetKey}-${field}-error`;
      error.style.color = '#ffb4a8';
      input.setAttribute('aria-describedby', error.id);
      input.limitError = error;
      const wrap = document.createElement('div'), unit = document.createElement('span');
      wrap.className = 'limit-input-wrap'; unit.textContent = field === 'apy' ? '%' : 'pp';
      wrap.appendChild(input); wrap.appendChild(unit);
      cell.appendChild(wrap); cell.appendChild(error); return input;
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
  renderLimitAlarmRow(row);
  row.limitInputs.forEach((input, index) => {
    input.disabled = !key;
    const invalid = input.value !== '' && limitNumber(input.value) === null;
    input.setAttribute('aria-invalid', String(invalid));
    input.limitError.textContent = invalid ? `${index ? 'Threshold' : 'APY'} must be nonnegative (e.g. 0.10). ${index ? 'Gap alarm disabled.' : 'Alarm disabled.'}` : '';
  });
  const apy = limitNumber(record.apy);
  const gap = market && typeof market.impliedApy === 'number' && Number.isFinite(market.impliedApy * 100) && apy !== null
    ? market.impliedApy * 100 - apy : null;
  row.limitGap.textContent = gap === null ? '—' : `${gap >= 0 ? '+' : ''}${gap.toFixed(2)}${apyState.error ? ' (stale)' : ''}`;
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
    if (apy === null) { limitState.edges.delete(key); limitState.edges.delete(key + ':range'); continue; }
    const reasons = [];
    function check(edgeKey, triggered, reason) {
      if (triggered === null) return; // Unknown/stale data cannot re-arm a condition.
      const previous = limitState.edges.get(edgeKey);
      limitState.edges.set(edgeKey, triggered);
      if (triggered && previous !== true) reasons.push(reason);
    }
    if (threshold !== null && typeof market.impliedApy === 'number' && Number.isFinite(market.impliedApy * 100)) {
      const gap = market.impliedApy * 100 - apy;
      check(key, limitGapAtOrBelow(market.impliedApy * 100, apy, threshold), `gap ${gap >= 0 ? '+' : ''}${gap.toFixed(2)} pp; threshold ${threshold} pp`);
    } else limitState.edges.delete(key);
    const range = typeof limitRewardRangeCheck === 'function' ? limitRewardRangeCheck(market, apy) : null;
    check(key + ':range', range?.outside ?? null, `My Limit APY ${apy}% outside APY Range${range ? ' ' + range.label : ''}`);
    if (!reasons.length || !limitState.enabled || (selectedAssets.size && !selectedAssets.has(assetKey))) continue;
    const message = `${asset.label}: ${reasons.join(' · ')}. Maturity ${apyDate(market.maturityDateUnixTs * 1000)}.`;
    const existing = limitAlarm.entries.get(key);
    if (!existing) { limitAlarm.entries.set(key, message); messages.push(message); }
    else if (!existing.includes(message)) { limitAlarm.entries.set(key, existing + '\n' + message); renderLimitAlarm(); }
  }
  if (messages.length) {
    const body = messages.join('\n');
    startLimitAlarmAudio();
    renderLimitAlarm();
    void notifyLimitAlarm(body);
  }
}
if (typeof window !== 'undefined') window.addEventListener('load', () => {
  const alarmButton = document.getElementById('limitAlerts');
  alarmButton.title = 'Gap ≤ Threshold, My Limit APY outside APY Range, or a watched order at Group Position 1 / N. Alarm until stopped.';
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
  alarmButton.addEventListener('click', () => {
    limitState.enabled = !limitState.enabled; limitState.edges.clear();
    alarmButton.setAttribute('aria-pressed', String(limitState.enabled));
    alarmButton.textContent = `APY Alarm: ${limitState.enabled ? 'ON' : 'OFF'}`;
    if (!limitState.enabled) stopLimitAlarm();
    if (limitState.enabled) unlockLimitAudio();
    if (typeof pollOrderWatches === 'function') { renderOrderWatches(); void pollOrderWatches(); }
    updateLimitNotificationPermission();
    if (limitState.enabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().then(updateLimitNotificationPermission).catch(updateLimitNotificationPermission);
    }
  });
  document.getElementById('stopLimitAlarm').addEventListener('click', stopLimitAlarm);
  const stopButton = document.getElementById('stopLimitAlarm');
  stopButton.textContent = 'Stop Alarm · Space';
  stopButton.setAttribute('aria-keyshortcuts', 'Space');
  window.addEventListener('keydown', handleLimitAlarmSpace, { capture: true });
  setInterval(renderLimitAlarm, 2000);
  saveLimits(); renderApy();
});
