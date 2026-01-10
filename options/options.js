// Options page script - handles policy management and log viewing
document.addEventListener('DOMContentLoaded', async () => {
  // Load initial data
  await loadPolicies();
  await loadLogs();
  
  // Set up event listeners
  document.getElementById('exportPolicies').addEventListener('click', exportPolicies);
  document.getElementById('importPolicies').addEventListener('click', () => {
    document.getElementById('policyFile').click();
  });
  document.getElementById('policyFile').addEventListener('change', importPolicies);
  document.getElementById('clearLogs').addEventListener('click', clearLogs);
  document.getElementById('logSearch').addEventListener('input', (e) => filterLogs(e.target.value));
});

// Load and display policies
async function loadPolicies() {
  const SCRIPTGUARD_POLICIES_KEY = "scriptguard_policies";
  const result = await chrome.storage.local.get(SCRIPTGUARD_POLICIES_KEY);
  const policies = result[SCRIPTGUARD_POLICIES_KEY] || {};
  
  document.getElementById('policiesJson').textContent = 
    JSON.stringify(policies, null, 2);
}

// Export policies as JSON file
async function exportPolicies() {
  const SCRIPTGUARD_POLICIES_KEY = "scriptguard_policies";
  const result = await chrome.storage.local.get(SCRIPTGUARD_POLICIES_KEY);
  const policies = result[SCRIPTGUARD_POLICIES_KEY] || {};
  
  const blob = new Blob([JSON.stringify(policies, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `scriptguard-policies-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Import policies from JSON file
async function importPolicies(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const policies = JSON.parse(e.target.result);
      const SCRIPTGUARD_POLICIES_KEY = "scriptguard_policies";
      
      await chrome.storage.local.set({ [SCRIPTGUARD_POLICIES_KEY]: policies });
      await loadPolicies();
      alert('Policies imported successfully!');
    } catch (error) {
      alert('Error importing policies: ' + error.message);
    }
  };
  reader.readAsText(file);
  
  // Reset file input
  event.target.value = '';
}

// Load and display logs
async function loadLogs() {
  const response = await chrome.runtime.sendMessage({ type: 'SG_GET_LOGS' });
  window.allLogs = response.logs || [];
  renderLogs(window.allLogs);
}

// Render logs to the page
function renderLogs(logs) {
  const container = document.getElementById('logsList');
  container.innerHTML = '';
  
  if (logs.length === 0) {
    container.innerHTML = '<div class="log-entry">No logs yet</div>';
    return;
  }
  
  logs.forEach(log => {
    const entry = document.createElement('div');
    entry.className = `log-entry ${log.decision}`;
    
    const time = new Date(log.ts).toLocaleString();
    const detail = typeof log.detail === 'object' ? 
      JSON.stringify(log.detail, null, 2) : 
      String(log.detail);
    
    entry.innerHTML = `
      <div class="log-header">
        <div>
          <span class="log-type">${log.type}</span>
          <span class="log-decision ${log.decision}">${log.decision}</span>
          <span class="log-host">${log.host}</span>
        </div>
        <div class="log-time">${time}</div>
      </div>
      <div class="log-detail">${detail}</div>
      <div class="log-stack">${log.script || 'No script URL'}</div>
    `;
    
    container.appendChild(entry);
  });
}

// Filter logs based on search query
function filterLogs(query) {
  if (!window.allLogs) return;
  
  if (!query.trim()) {
    renderLogs(window.allLogs);
    return;
  }
  
  const filtered = window.allLogs.filter(log => {
    const logString = JSON.stringify(log).toLowerCase();
    return logString.includes(query.toLowerCase());
  });
  
  renderLogs(filtered);
}

// Clear all logs
async function clearLogs() {
  if (!confirm('Are you sure you want to clear all logs? This cannot be undone.')) {
    return;
  }
  
  const response = await chrome.runtime.sendMessage({ type: 'SG_CLEAR_LOGS' });
  if (response.ok) {
    window.allLogs = [];
    renderLogs([]);
  }
}