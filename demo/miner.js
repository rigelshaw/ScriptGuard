// Demo miner (safe & cooperative)
// Replaces heavy blocking loops with chunked work to avoid freezing,
// and catches fetch errors caused by malformed RequestInit arguments.

(function() {
  'use strict';

  const LOG_ID = 'minerLogs'; // optional element id on page (may not exist)
  let isMining = false;

  function logConsole(message, level = 'info') {
    try {
      if (level === 'error') console.error('[Miner] ' + message);
      else if (level === 'warning') console.warn('[Miner] ' + message);
      else console.log('[Miner] ' + message);
    } catch (e) {}
  }

  // Cooperative batch worker to avoid locking main thread
  function simulateWorkCooperative(payload, batchCount = 20000) {
    return new Promise((resolve) => {
      let i = 0;
      let result = 0;
      const total = Math.max(1, Math.min(200000, batchCount));
      function step() {
        const chunk = 2000;
        const end = Math.min(i + chunk, total);
        for (; i < end; i++) {
          result ^= payload.charCodeAt(i % payload.length) * i;
          result = ((result << 1) | (result >>> 31)) >>> 0;
        }
        if (i < total) {
          setTimeout(step, 0);
        } else {
          resolve({ result: result.toString(16), duration: 0 });
        }
      }
      step();
    });
  }

  // Safe fetch helper for demo to avoid passing bad init args
  async function safeFetch(url, init) {
    try {
      // If init exists but is not an object, drop it
      if (init != null && typeof init !== 'object') init = undefined;
      return await fetch(url, init);
    } catch (e) {
      // bubble error to caller
      throw e;
    }
  }

  async function startMining() {
    if (isMining) {
      logConsole('Already mining', 'warning');
      return;
    }
    isMining = true;
    logConsole('Starting miner (safe mode)...');

    try {
      logConsole('Fetching payload...');
      const response = await safeFetch('/fake/miner_payload', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.text();

      logConsole(`Received payload (${payload.length} bytes). Starting cooperative work...`);
      const workResult = await simulateWorkCooperative(payload, 50000);
      logConsole(`Mining complete: ${workResult.result}`, 'info');

    } catch (error) {
      logConsole('Mining failed: ' + (error && error.message ? error.message : String(error)), 'error');
    } finally {
      isMining = false;
    }
  }

  // Start mining once after load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => startMining(), 2000));
  } else {
    setTimeout(() => startMining(), 2000);
  }

  window.demoMiner = { start: startMining, isMining: () => isMining };
  logConsole('Demo miner (safe) loaded');
})();
