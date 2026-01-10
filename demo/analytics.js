// Demo analytics script - simulates tracking calls
(function() {
  'use strict';
  
  const LOG_ID = 'analyticsLogs';
  let intervalId = null;
  
  function log(message, type = 'info') {
    const container = document.getElementById(LOG_ID);
    if (!container) return;
    
    const div = document.createElement('div');
    div.className = `log ${type}`;
    div.textContent = `[Analytics] ${new Date().toLocaleTimeString()}: ${message}`;
    container.appendChild(div);
    
    // Keep only last 5 logs
    const logs = container.querySelectorAll('.log');
    if (logs.length > 5) {
      logs[0].remove();
    }
    
    console.log(`[Analytics] ${message}`);
  }
  
  function sendPing() {
    const timestamp = Date.now();
    const url = `/fake/track?ts=${timestamp}&page=${encodeURIComponent(window.location.href)}`;
    
    fetch(url)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        log(`Ping successful: ${data.status} (${data.ts})`, 'success');
      })
      .catch(error => {
        log(`Ping failed: ${error.message}`, 'error');
      });
  }
  
  function startTracking() {
    log('Starting analytics tracking...');
    // Send initial ping
    sendPing();
    // Schedule periodic pings every 10 seconds
    intervalId = setInterval(sendPing, 10000);
  }
  
  function stopTracking() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      log('Tracking stopped');
    }
  }
  
  // Auto-start when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startTracking);
  } else {
    startTracking();
  }
  
  // Expose controls to global scope for manual testing
  window.demoAnalytics = {
    start: startTracking,
    stop: stopTracking,
    sendPing: sendPing
  };
  
  console.log('Demo analytics script loaded');
})();