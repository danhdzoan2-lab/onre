// Transaction polling is independent of APY, reward-range and orderbook timers.
const TRANSACTION_REFRESH_STORAGE_KEY = 'exponent-transaction-refresh-seconds-v1';
const DEFAULT_TRANSACTION_REFRESH_SECONDS = 2;
let transactionRefreshTimer = null;
let transactionRefreshSeconds = DEFAULT_TRANSACTION_REFRESH_SECONDS;

function parseTransactionRefreshSeconds(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 2 && seconds <= 3600 ? seconds : null;
}
function showTransactionRefreshStatus(message, error = false) {
  const status = document.getElementById('transactionRefreshStatus');
  status.textContent = error ? message : '';
  status.hidden = !error;
  status.dataset.error = String(error);
}
function restartTransactionRefresh(seconds) {
  if (transactionRefreshTimer !== null) clearInterval(transactionRefreshTimer);
  transactionRefreshSeconds = seconds;
  transactionRefreshTimer = setInterval(() => {
    if (getProxy() && !fetchInFlight) void fetchAll({ silent: true });
  }, seconds * 1000);
}
function saveTransactionRefresh() {
  const input = document.getElementById('transactionRefreshSeconds');
  const seconds = parseTransactionRefreshSeconds(input.value);
  input.setAttribute('aria-invalid', String(seconds === null));
  if (seconds === null) {
    showTransactionRefreshStatus(`Enter a whole number from 2 to 3,600. Still using ${transactionRefreshSeconds}s.`, true);
    return;
  }
  restartTransactionRefresh(seconds);
  input.value = String(seconds);
  try {
    localStorage.setItem(TRANSACTION_REFRESH_STORAGE_KEY, String(seconds));
    showTransactionRefreshStatus(`Saved · Refresh every ${seconds}s on this browser.`);
  } catch {
    showTransactionRefreshStatus(`Refresh every ${seconds}s · Storage unavailable; applies to this session only.`, true);
  }
}
function initTransactionRefresh() {
  const input = document.getElementById('transactionRefreshSeconds');
  let seconds = DEFAULT_TRANSACTION_REFRESH_SECONDS;
  let warning = '';
  try {
    const stored = localStorage.getItem(TRANSACTION_REFRESH_STORAGE_KEY);
    if (stored !== null) {
      const parsed = parseTransactionRefreshSeconds(stored);
      if (parsed !== null) seconds = parsed;
      else warning = 'Saved interval invalid; using 2s.';
    }
  } catch { warning = 'Storage unavailable; using 2s for this session.'; }
  input.value = String(seconds);
  input.setAttribute('aria-invalid', 'false');
  restartTransactionRefresh(seconds);
  showTransactionRefreshStatus(warning || `Refresh every ${seconds}s · Saved on this browser.`, Boolean(warning));
  document.getElementById('saveTransactionRefresh').addEventListener('click', saveTransactionRefresh);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); saveTransactionRefresh(); }
  });
}
