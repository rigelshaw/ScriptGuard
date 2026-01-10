// Enhanced popup script - handles UI interactions, presets, and cookie management
document.addEventListener('DOMContentLoaded', async () => {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // Extract hostname from tab URL
  let hostname = '';
  try {
    const url = new URL(tab.url);
    hostname = url.hostname;
  } catch (err) {
    // Invalid URL (e.g., extension pages, new tab, about:blank)
    document.getElementById('currentDomain').textContent = 'Invalid URL';
    document.getElementById('cookiesList').innerHTML = '<div class="empty-message">Cannot manage this page (extension page or restricted URL)</div>';
    disableAllControls();
    return;
  }
  
  // Verify we have a valid hostname
  if (!hostname || hostname.length === 0) {
    document.getElementById('currentDomain').textContent = 'No domain';
    document.getElementById('cookiesList').innerHTML = '<div class="empty-message">Cannot manage this page (no domain)</div>';
    disableAllControls();
    return;
  }
  
  document.getElementById('currentDomain').textContent = hostname;
  
  // Show onboarding every time popup opens (for quick preset access)
  // This allows users to quickly change presets per domain
  showOnboarding();
  
  // Load current policy
  await loadPolicy(hostname);
  
  // Load and display cookies
  await loadCookies(hostname);
  
  // Load recent logs
  await loadLogs();
  
  // Set up event listeners
  const savePolicyBtn = document.getElementById('savePolicy');
  const allowOnceBtn = document.getElementById('allowOnce');
  const refreshLogsBtn = document.getElementById('refreshLogs');
  const refreshCookiesBtn = document.getElementById('refreshCookies');
  const openDashboardBtn = document.getElementById('openDashboard');
  const toggleAdvancedBtn = document.getElementById('toggleAdvanced');
  const policyPresetsSelect = document.getElementById('policy-presets');
  
  if (savePolicyBtn) savePolicyBtn.addEventListener('click', () => savePolicy(hostname));
  if (allowOnceBtn) allowOnceBtn.addEventListener('click', () => setAllowOnce(hostname));
  if (refreshLogsBtn) refreshLogsBtn.addEventListener('click', () => loadLogs());
  if (refreshCookiesBtn) refreshCookiesBtn.addEventListener('click', () => loadCookies(hostname));
  if (openDashboardBtn) openDashboardBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // Advanced controls toggle
  if (toggleAdvancedBtn) {
    toggleAdvancedBtn.addEventListener('click', () => {
      const advControls = document.getElementById('advancedControls');
      advControls.style.display = advControls.style.display === 'none' ? 'block' : 'none';
      toggleAdvancedBtn.textContent = advControls.style.display === 'none' ? '▼ Advanced Controls' : '▲ Advanced Controls';
    });
  }
  
  // Preset selector
  if (policyPresetsSelect) {
    policyPresetsSelect.addEventListener('change', async (e) => {
      const presetId = e.target.value;
      await applyPresetToUI(hostname, presetId);
    });
  }
  
  // Setup tab switching
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  
  // Add auto-save listeners to all toggle inputs (for real-time saving)
  const allToggles = document.querySelectorAll('input[type="checkbox"]');
  allToggles.forEach(toggle => {
    toggle.addEventListener('change', async () => {
      await savePolicy(hostname);
    });
  });
  
  // Add auto-save listener to DOM mode selector
  const domModeSelect = document.getElementById('domMode');
  if (domModeSelect) {
    domModeSelect.addEventListener('change', async () => {
      await savePolicy(hostname);
    });
  }
});

function disableAllControls() {
  const btns = document.querySelectorAll('button');
  btns.forEach(btn => btn.disabled = true);
  const selects = document.querySelectorAll('select, input[type="checkbox"]');
  selects.forEach(el => el.disabled = true);
}

function switchTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.remove('active');
  });
  
  // Deactivate all tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Show selected tab
  const tabPane = document.getElementById(tabName + '-tab');
  if (tabPane) {
    tabPane.classList.add('active');
  }
  
  // Activate selected tab button
  const tabBtn = document.querySelector('[data-tab="' + tabName + '"]');
  if (tabBtn) {
    tabBtn.classList.add('active');
  }
}

// ===== ONBOARDING =====

async function showOnboarding() {
  document.getElementById('onboardingSection').style.display = 'block';
  const presets = await getPresets();
  const presetGrid = document.getElementById('presetGrid');
  presetGrid.innerHTML = '';
  
  Object.entries(presets).forEach(([presetId, preset]) => {
    const option = document.createElement('div');
    option.className = 'preset-option';
    option.innerHTML = `
      <div class="preset-icon">${preset.icon}</div>
      <div class="preset-name">${preset.name}</div>
      <div class="preset-desc">${preset.subtitle}</div>
    `;
    option.onclick = async () => {
      // Mark as selected visually
      document.querySelectorAll('.preset-option').forEach(el => el.classList.remove('active'));
      option.classList.add('active');
      
      // Store selection
      window.selectedPresetId = presetId;
    };
    presetGrid.appendChild(option);
  });
  
  // Remove old event listener and add new one
  const confirmBtn = document.getElementById('confirmPreset');
  const newConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  
  newConfirmBtn.addEventListener('click', async () => {
    const presetId = window.selectedPresetId || 'balanced';
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const hostname = new URL(tab.url).hostname;
    
    await applyPreset(hostname, presetId);
    // Don't mark as onboarded - show popup every time
    // Just hide onboarding and show the policy controls
    hideOnboarding();
    
    // Reload policy view to show the newly applied preset
    await loadPolicy(hostname);
  });
}

function hideOnboarding() {
  document.getElementById('onboardingSection').style.display = 'none';
}

// ===== COOKIES =====

async function loadCookies(hostname) {
  try {
    console.log(`Loading cookies for hostname: ${hostname}`);
    
    // Try multiple strategies to find cookies
    let cookies = [];
    
    // Strategy 1: Try https URL
    let result = await chrome.cookies.getAll({ url: `https://${hostname}` });
    console.log(`Cookies from https://${hostname}:`, result);
    if (result && result.length > 0) {
      cookies = result;
    }
    
    // Strategy 2: Try http URL if https didn't work
    if (!cookies || cookies.length === 0) {
      result = await chrome.cookies.getAll({ url: `http://${hostname}` });
      console.log(`Cookies from http://${hostname}:`, result);
      if (result && result.length > 0) {
        cookies = result;
      }
    }
    
    // Strategy 3: Try by domain directly (without trailing path)
    if (!cookies || cookies.length === 0) {
      result = await chrome.cookies.getAll({ domain: hostname });
      console.log(`Cookies by domain ${hostname}:`, result);
      if (result && result.length > 0) {
        cookies = result;
      }
    }
    
    // Strategy 4: Try with www. prefix
    if (!cookies || cookies.length === 0) {
      result = await chrome.cookies.getAll({ url: `https://www.${hostname}` });
      console.log(`Cookies from https://www.${hostname}:`, result);
      if (result && result.length > 0) {
        cookies = result;
      }
    }
    
    const cookiesList = document.getElementById('cookiesList');
    
    if (!cookies || cookies.length === 0) {
      console.log('No cookies found for this site');
      cookiesList.innerHTML = '<div class="empty-message">No cookies found for this site</div>';
      return;
    }
    
    console.log(`Found ${cookies.length} cookies`);
    cookiesList.innerHTML = '';
    
    // Classify and score each cookie
    for (const cookie of cookies) {
      const classified = CookieClassifier.classify(cookie, `https://${hostname}`);
      const cookieEl = createCookieCard(classified, hostname);
      cookiesList.appendChild(cookieEl);
    }
  } catch (err) {
    console.error('Failed to load cookies:', err);
    const cookiesList = document.getElementById('cookiesList');
    cookiesList.innerHTML = 
      `<div class="empty-message">Error loading cookies: ${err.message}</div>`;
  }
}

function createCookieCard(classified, hostname) {
  const riskClass = `${classified.riskLevel.toLowerCase()}-risk`;
  const card = document.createElement('div');
  card.className = `cookie-card ${riskClass}`;
  
  const expiryText = classified.expirationDate 
    ? `Expires: ${CookieClassifier.getExpiryDescription(classified)}`
    : 'Session only';
  
  card.innerHTML = `
    <div class="cookie-header">
      <div class="cookie-title">
        <span>${classified.categoryInfo.icon}</span>
        <span>${classified.name}</span>
        <span class="cookie-category">${classified.categoryInfo.label}</span>
      </div>
      <div class="cookie-risk">${classified.riskInfo.color} ${classified.riskInfo.label}</div>
    </div>
    
    <div class="cookie-detail">
      Domain: <strong>${classified.domain}</strong> • ${expiryText}
    </div>
    
    <div class="cookie-explanation">
      ${classified.explanation}
    </div>
    
    <div class="cookie-actions">
      <button class="btn btn-primary" data-action="allow" data-cookie="${classified.name}" data-host="${hostname}">Allow Once</button>
      <button class="btn btn-secondary" data-action="sessionize" data-cookie="${classified.name}" data-host="${hostname}">Sessionize</button>
      <button class="btn btn-danger" data-action="block" data-cookie="${classified.name}" data-host="${hostname}">Block</button>
    </div>
  `;
  
  // Attach event listeners to buttons
  card.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const action = btn.dataset.action;
      const cookieName = btn.dataset.cookie;
      const host = btn.dataset.host;
      
      if (action === 'allow') {
        await allowCookieOnce(cookieName, host);
      } else if (action === 'sessionize') {
        await sessionizeCookie(cookieName, host);
      } else if (action === 'block') {
        await blockCookie(cookieName, host);
      }
    });
  });
  
  return card;
}

async function allowCookieOnce(cookieName, hostname) {
  await recordCookieAction(hostname, {
    action: 'allow_once',
    cookieName,
    duration: 5
  });
  
  showToast({
    message: `Cookie "${cookieName}" allowed for 5 minutes`,
    type: 'success',
    duration: 4000
  });
}

async function sessionizeCookie(cookieName, hostname) {
  try {
    // Try both https and http
    let cookie = await chrome.cookies.get({ 
      url: `https://${hostname}`,
      name: cookieName 
    });
    
    if (!cookie) {
      cookie = await chrome.cookies.get({ 
        url: `http://${hostname}`,
        name: cookieName 
      });
    }
    
    if (cookie) {
      // Remove expiration to make it session-only
      await chrome.cookies.set({
        url: `https://${hostname}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite
        // expirationDate is omitted = session-only
      });
      
      await recordCookieAction(hostname, {
        action: 'sessionize',
        cookieName
      });
      
      showToast({
        message: `Cookie "${cookieName}" converted to session-only. It will be deleted when you close the tab.`,
        type: 'success',
        duration: 4000
      });
      
      // Refresh cookie list
      await loadCookies(hostname);
    } else {
      console.warn('Cookie not found:', cookieName);
      showToast({
        message: `Cookie "${cookieName}" not found`,
        type: 'error',
        duration: 3000
      });
    }
  } catch (err) {
    console.error('Failed to sessionize cookie:', err);
    showToast({
      message: `Error: ${err.message}`,
      type: 'error',
      duration: 3000
    });
  }
}

async function blockCookie(cookieName, hostname) {
  try {
    console.log(`Attempting to block cookie: ${cookieName} for hostname: ${hostname}`);

    // First, try to find all cookies with this name across domains/paths
    let matches = await chrome.cookies.getAll({ name: cookieName });
    console.log(`Found ${matches.length} matching cookie(s) for name=${cookieName}`, matches);

    let removedAny = false;

    // Helper to build removal URL for a cookie entry
    const buildUrlForCookie = (c) => {
      const domain = c.domain ? (c.domain.startsWith('.') ? c.domain.slice(1) : c.domain) : hostname;
      const scheme = c.secure ? 'https://' : 'http://';
      const path = c.path || '/';
      return `${scheme}${domain}${path}`;
    };

    // Attempt removal for each matching cookie entry
    for (const c of matches) {
      try {
        const url = buildUrlForCookie(c);
        console.log(`Removing cookie '${c.name}' at url=${url} (domain=${c.domain}, path=${c.path})`);
        const res = await chrome.cookies.remove({ url, name: c.name });
        console.log('Removal result for entry:', res);
        if (res) removedAny = true;
      } catch (e) {
        console.error('Error removing cookie entry:', e);
      }
    }

    // If none removed via getAll matches, try common hostname variants as fallback
    if (!removedAny) {
      console.log('No cookie entries removed via getAll lookup, trying hostname fallbacks...');
      const tryUrls = [
        `https://${hostname}/`,
        `http://${hostname}/`,
        `https://www.${hostname}/`,
        `http://www.${hostname}/`
      ];
      for (const url of tryUrls) {
        try {
          const res = await chrome.cookies.remove({ url, name: cookieName });
          console.log(`Fallback removal attempt for ${url}:`, res);
          if (res) {
            removedAny = true;
            break;
          }
        } catch (e) {
          console.error('Fallback removal error for', url, e);
        }
      }
    }

    if (!removedAny) {
      console.warn(`Cookie ${cookieName} could not be removed - it may be protected, HttpOnly, SameSite-recreated, or re-set by the server on reload`);
      showToast({
        message: `⚠️ Could not block "${cookieName}" — site may re-create it on reload or it may be protected. Try clearing site data or inspecting Network Set-Cookie headers.`,
        type: 'warning',
        duration: 8000
      });
      return;
    }

    await recordCookieAction(hostname, {
      action: 'block',
      cookieName
    });

    // Store in persistent blocked cookies list so page_agent can enforce it
    const blockedResult = await chrome.storage.local.get('scriptguard_blocked_cookies');
    const blockedCookies = blockedResult.scriptguard_blocked_cookies || {};
    if (!blockedCookies[hostname]) {
      blockedCookies[hostname] = [];
    }
    if (!blockedCookies[hostname].includes(cookieName)) {
      blockedCookies[hostname].push(cookieName);
    }
    await chrome.storage.local.set({ scriptguard_blocked_cookies: blockedCookies });
    console.log(`Cookie "${cookieName}" added to persistent block list for ${hostname}`);

    showToast({
      message: `✓ Blocked "${cookieName}" | Will be removed if server tries to recreate it`,
      type: 'success',
      duration: 6000
    });

    // Refresh cookie list
    await loadCookies(hostname);
  } catch (err) {
    console.error('Failed to block cookie:', err);
    showToast({
      message: `Error blocking cookie: ${err.message}`,
      type: 'error',
      duration: 5000
    });
  }
}

// ===== POLICY MANAGEMENT =====

// Load policy for domain
async function loadPolicy(hostname) {
  const SCRIPTGUARD_POLICIES_KEY = "scriptguard_policies";
  const result = await chrome.storage.local.get(SCRIPTGUARD_POLICIES_KEY);
  const policies = result[SCRIPTGUARD_POLICIES_KEY] || {};
  
  // Get policy for this domain or default
  const defaultPolicy = policies.default || { 
    network: { fetch: true, xhr: true, websocket: true, beacon: true },
    storage: true, 
    dom: "full", 
    cookies: true, 
    eval: false,
    geolocation: false,
    camera: false,
    microphone: false,
    clipboard: false,
    notifications: false,
    webrtc: false,
    scriptLoading: { inline: false, external: true },
    accelerometer: false,
    imageLoading: true,
    styleLoading: true,
    localStorage: true,
    sessionStorage: true,
    indexeddb: true,
    functionConstructor: false
  };
  const domainPolicy = policies[hostname] || defaultPolicy;
  
  // Helper: get value from policy, default to true if not explicitly set
  const getValue = (obj, path, defaultValue = true) => {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return defaultValue;
      current = current[part];
    }
    return current !== undefined ? current : defaultValue;
  };
  
  // Update basic UI - these use checkboxes so true = checked, false = unchecked
  const networkObj = domainPolicy.network || {};
  document.getElementById('toggleNetwork').checked = 
    getValue(networkObj, 'fetch', true) || getValue(networkObj, 'xhr', true);
  document.getElementById('toggleStorage').checked = getValue(domainPolicy, 'storage', true);
  document.getElementById('toggleCookies').checked = getValue(domainPolicy, 'cookies', true);
  document.getElementById('domMode').value = getValue(domainPolicy, 'dom', "full");
  
  // Update advanced network controls
  document.getElementById('fetch').checked = getValue(networkObj, 'fetch', true);
  document.getElementById('xhr').checked = getValue(networkObj, 'xhr', true);
  document.getElementById('websocket').checked = getValue(networkObj, 'websocket', true);
  document.getElementById('beacon').checked = getValue(networkObj, 'beacon', true);
  
  // Update capability controls - these are all disabled by default (false), enabled on toggle
  document.getElementById('geolocation').checked = getValue(domainPolicy, 'geolocation', false);
  document.getElementById('camera').checked = getValue(domainPolicy, 'camera', false);
  document.getElementById('microphone').checked = getValue(domainPolicy, 'microphone', false);
  document.getElementById('clipboard').checked = getValue(domainPolicy, 'clipboard', false);
  document.getElementById('notifications').checked = getValue(domainPolicy, 'notifications', false);
  document.getElementById('webrtc').checked = getValue(domainPolicy, 'webrtc', false);
  document.getElementById('eval').checked = getValue(domainPolicy, 'eval', false);
  
  // Script loading - nested object
  const scriptLoadObj = domainPolicy.scriptLoading || {};
  document.getElementById('inline').checked = getValue(scriptLoadObj, 'inline', false);
  document.getElementById('external').checked = getValue(scriptLoadObj, 'external', true);
  
  // New capabilities - mostly enabled by default
  document.getElementById('accelerometer').checked = getValue(domainPolicy, 'accelerometer', false);
  document.getElementById('imageLoading').checked = getValue(domainPolicy, 'imageLoading', true);
  document.getElementById('styleLoading').checked = getValue(domainPolicy, 'styleLoading', true);
  document.getElementById('localStorage').checked = getValue(domainPolicy, 'localStorage', true);
  document.getElementById('sessionStorage').checked = getValue(domainPolicy, 'sessionStorage', true);
  document.getElementById('indexeddb').checked = getValue(domainPolicy, 'indexeddb', true);
  document.getElementById('functionConstructor').checked = getValue(domainPolicy, 'functionConstructor', false);
}

// Apply preset to UI and save
async function applyPresetToUI(hostname, presetId) {
  const SCRIPTGUARD_PRESETS_KEY = "scriptguard_presets";
  const result = await chrome.storage.local.get(SCRIPTGUARD_PRESETS_KEY);
  const presets = result[SCRIPTGUARD_PRESETS_KEY] || PRESETS;
  
  const preset = presets[presetId];
  if (!preset || !preset.policy) return;
  
  const policy = preset.policy;
  
  // Helper: get value from policy, default to true if not explicitly set
  const getValue = (obj, path, defaultValue = true) => {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return defaultValue;
      current = current[part];
    }
    return current !== undefined ? current : defaultValue;
  };
  
  // Update basic UI
  const networkObj = policy.network || {};
  document.getElementById('toggleNetwork').checked = 
    getValue(networkObj, 'fetch', true) || getValue(networkObj, 'xhr', true);
  document.getElementById('toggleStorage').checked = getValue(policy, 'storage', true);
  document.getElementById('toggleCookies').checked = getValue(policy, 'cookies', true);
  document.getElementById('domMode').value = getValue(policy, 'dom', "full");
  
  // Update advanced network controls
  document.getElementById('fetch').checked = getValue(networkObj, 'fetch', true);
  document.getElementById('xhr').checked = getValue(networkObj, 'xhr', true);
  document.getElementById('websocket').checked = getValue(networkObj, 'websocket', true);
  document.getElementById('beacon').checked = getValue(networkObj, 'beacon', true);
  
  // Update capability controls
  document.getElementById('geolocation').checked = getValue(policy, 'geolocation', false);
  document.getElementById('camera').checked = getValue(policy, 'camera', false);
  document.getElementById('microphone').checked = getValue(policy, 'microphone', false);
  document.getElementById('clipboard').checked = getValue(policy, 'clipboard', false);
  document.getElementById('notifications').checked = getValue(policy, 'notifications', false);
  document.getElementById('webrtc').checked = getValue(policy, 'webrtc', false);
  document.getElementById('eval').checked = getValue(policy, 'eval', false);
  
  // Script loading - nested object
  const scriptLoadObj = policy.scriptLoading || {};
  document.getElementById('inline').checked = getValue(scriptLoadObj, 'inline', false);
  document.getElementById('external').checked = getValue(scriptLoadObj, 'external', true);
  
  // New capabilities
  document.getElementById('accelerometer').checked = getValue(policy, 'accelerometer', false);
  document.getElementById('imageLoading').checked = getValue(policy, 'imageLoading', true);
  document.getElementById('styleLoading').checked = getValue(policy, 'styleLoading', true);
  document.getElementById('localStorage').checked = getValue(policy, 'localStorage', true);
  document.getElementById('sessionStorage').checked = getValue(policy, 'sessionStorage', true);
  document.getElementById('indexeddb').checked = getValue(policy, 'indexeddb', true);
  document.getElementById('functionConstructor').checked = getValue(policy, 'functionConstructor', false);
  
  // Save to storage
  await savePolicy(hostname);
}

// Save policy for domain
async function savePolicy(hostname) {
  const SCRIPTGUARD_POLICIES_KEY = "scriptguard_policies";
  const result = await chrome.storage.local.get(SCRIPTGUARD_POLICIES_KEY);
  const policies = result[SCRIPTGUARD_POLICIES_KEY] || {};
  
  // Create updated policy with all capabilities
  policies[hostname] = {
    network: {
      fetch: document.getElementById('fetch').checked,
      xhr: document.getElementById('xhr').checked,
      websocket: document.getElementById('websocket').checked,
      beacon: document.getElementById('beacon').checked
    },
    storage: document.getElementById('toggleStorage').checked,
    cookies: document.getElementById('toggleCookies').checked,
    dom: document.getElementById('domMode').value,
    geolocation: document.getElementById('geolocation').checked,
    camera: document.getElementById('camera').checked,
    microphone: document.getElementById('microphone').checked,
    clipboard: document.getElementById('clipboard').checked,
    notifications: document.getElementById('notifications').checked,
    webrtc: document.getElementById('webrtc').checked,
    eval: document.getElementById('eval').checked,
    scriptLoading: {
      inline: document.getElementById('inline').checked,
      external: document.getElementById('external').checked
    },
    accelerometer: document.getElementById('accelerometer').checked,
    imageLoading: document.getElementById('imageLoading').checked,
    styleLoading: document.getElementById('styleLoading').checked,
    localStorage: document.getElementById('localStorage').checked,
    sessionStorage: document.getElementById('sessionStorage').checked,
    indexeddb: document.getElementById('indexeddb').checked,
    functionConstructor: document.getElementById('functionConstructor').checked
  };
  
  // Remove allow-once if present
  if (policies[hostname]._allowOnce) {
    delete policies[hostname]._allowOnce;
  }
  
  await chrome.storage.local.set({ [SCRIPTGUARD_POLICIES_KEY]: policies });
  
  showToast({
    message: 'Policy saved successfully',
    type: 'success',
    duration: 3000
  });
}

// Set temporary allow-once permission
async function setAllowOnce(hostname) {
  const SCRIPTGUARD_POLICIES_KEY = "scriptguard_policies";
  const result = await chrome.storage.local.get(SCRIPTGUARD_POLICIES_KEY);
  const policies = result[SCRIPTGUARD_POLICIES_KEY] || {};
  
  // Get current policy
  const defaultPolicy = policies.default || { network: true, storage: true, dom: "full", cookies: true, eval: true };
  const currentPolicy = policies[hostname] || defaultPolicy;
  
  // Add allow-once override
  currentPolicy._allowOnce = {
    network: true,
    storage: true,
    dom: "full",
    cookies: true,
    eval: true,
    until: Date.now() + 5 * 60 * 1000
  };
  
  policies[hostname] = currentPolicy;
  await chrome.storage.local.set({ [SCRIPTGUARD_POLICIES_KEY]: policies });
  
  showToast({
    message: 'All actions allowed for 5 minutes on this site',
    type: 'info',
    duration: 5000
  });
}

// ===== LOGS =====

async function loadLogs() {
  const SCRIPTGUARD_LOGS_KEY = "scriptguard_logs";
  const result = await chrome.storage.local.get(SCRIPTGUARD_LOGS_KEY);
  const logs = result[SCRIPTGUARD_LOGS_KEY] || [];
  
  renderLogs(logs.slice(0, 10)); // Show last 10 logs
}

function renderLogs(logs) {
  const container = document.getElementById('logsContainer');
  
  if (logs.length === 0) {
    container.innerHTML = '<div class="empty-message">No activity logged yet</div>';
    return;
  }
  
  container.innerHTML = '';
  logs.forEach(log => {
    const entry = document.createElement('div');
    entry.className = `log-entry ${log.decision || 'info'}`;
    
    const time = new Date(log.ts).toLocaleTimeString();
    const typeEmoji = {
      'fetch': '🌐',
      'xhr': '🌐',
      'ws': '📡',
      'storage': '💾',
      'cookie': '🍪',
      'dom-mod': '🖼️',
      'agent': '⚙️'
    }[log.type] || '📝';
    
    entry.innerHTML = `
      <div class="log-type">
        ${typeEmoji} ${log.type}
        <span class="log-decision ${log.decision}">${log.decision?.toUpperCase() || 'INFO'}</span>
      </div>
      ${log.detail ? `<div class="log-detail">${log.detail}</div>` : ''}
      <div class="log-time">${time}</div>
    `;
    
    container.appendChild(entry);
  });
}

// ===== TOAST NOTIFICATIONS =====

function showToast(options = {}) {
  const {
    message = '',
    type = 'info',
    duration = 5000,
    onUndo = null
  } = options;
  
  // Create container if needed
  let container = document.getElementById('sg-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'sg-toast-container';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  toast.style.cssText = `
    background: white;
    border-left: 4px solid #1a73e8;
    border-radius: 4px;
    padding: 12px 16px;
    margin-bottom: 12px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
    display: flex;
    align-items: center;
    justify-content: space-between;
    pointer-events: auto;
    font-size: 14px;
    color: #333;
    max-width: 400px;
  `;
  
  if (type === 'success') {
    toast.style.borderLeftColor = '#34a853';
    toast.style.background = '#f1f8f5';
  } else if (type === 'error') {
    toast.style.borderLeftColor = '#ea4335';
    toast.style.background = '#fdf1f0';
  } else if (type === 'warning') {
    toast.style.borderLeftColor = '#fbbc05';
    toast.style.background = '#fffbf0';
  }
  
  const messageSpan = document.createElement('span');
  messageSpan.textContent = message;
  messageSpan.style.flex = '1';
  toast.appendChild(messageSpan);
  
  if (onUndo) {
    const undoBtn = document.createElement('button');
    undoBtn.textContent = 'Undo';
    undoBtn.style.cssText = `
      margin-left: 12px;
      padding: 4px 8px;
      background: transparent;
      border: 1px solid #1a73e8;
      color: #1a73e8;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
    `;
    undoBtn.onclick = async () => {
      await onUndo();
      toast.remove();
    };
    toast.appendChild(undoBtn);
  }
  
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = `
    margin-left: 12px;
    padding: 0;
    background: transparent;
    border: none;
    color: #999;
    cursor: pointer;
    font-size: 18px;
  `;
  closeBtn.onclick = () => toast.remove();
  toast.appendChild(closeBtn);
  
  container.appendChild(toast);
  
  if (duration > 0) {
    setTimeout(() => toast.remove(), duration);
  }
  
  return toast;
}

// ===== HELPER FUNCTIONS =====

async function getPresets() {
  try {
    const result = await chrome.storage.local.get('scriptguard_presets');
    if (result.scriptguard_presets) {
      return result.scriptguard_presets;
    }
  } catch (e) {}
  
  // Default presets
  return {
    privacy_first: {
      name: 'Privacy First',
      subtitle: 'Recommended',
      description: 'Blocks tracking cookies and long-lived third-party cookies.',
      icon: '🔐'
    },
    balanced: {
      name: 'Balanced',
      subtitle: 'Default',
      description: 'Keeps sites working while reducing tracking.',
      icon: '⚖️'
    },
    relaxed: {
      name: 'Relaxed',
      subtitle: 'Maximum compatibility',
      description: 'Allows most cookies.',
      icon: '🔓'
    }
  };
}

async function applyPreset(hostname, presetId) {
  try {
    const result = await chrome.storage.local.get('scriptguard_policies');
    const policies = result.scriptguard_policies || {};
    const presets = await getPresets();
    
    if (presets[presetId]) {
      policies[hostname] = JSON.parse(JSON.stringify(presets[presetId].policy || {}));
      await chrome.storage.local.set({ scriptguard_policies: policies });
    }
  } catch (e) {
    console.error('Failed to apply preset:', e);
  }
}

async function recordCookieAction(hostname, action) {
  try {
    const result = await chrome.storage.local.get('scriptguard_cookie_actions');
    const history = result.scriptguard_cookie_actions || [];
    history.unshift({ ...action, timestamp: Date.now(), domain: hostname });
    if (history.length > 50) history.length = 50;
    await chrome.storage.local.set({ scriptguard_cookie_actions: history });
  } catch (e) {
    console.error('Failed to record action:', e);
  }
}

async function isOnboarded() {
  try {
    const result = await chrome.storage.local.get('scriptguard_onboarded');
    return result.scriptguard_onboarded || false;
  } catch (e) {
    return false;
  }
}

async function markOnboarded() {
  try {
    await chrome.storage.local.set({ scriptguard_onboarded: true });
  } catch (e) {
    console.error('Failed to mark onboarded:', e);
  }
}