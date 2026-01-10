// Policy management utilities
const SCRIPTGUARD_POLICIES_KEY = "scriptguard_policies";
const SCRIPTGUARD_PRESETS_KEY = "scriptguard_presets";
const SCRIPTGUARD_ONBOARDED_KEY = "scriptguard_onboarded";
const SCRIPTGUARD_COOKIE_ACTIONS_KEY = "scriptguard_cookie_actions"; // For undo history

// Comprehensive policy schema with all capabilities
const POLICY_SCHEMA = {
  network: {
    fetch: true,
    xhr: true,
    websocket: true,
    beacon: true
  },
  storage: true,
  cookies: true,
  dom: "full",
  geolocation: false,
  camera: false,
  microphone: false,
  clipboard: false,
  notifications: false,
  webrtc: false,
  eval: false,
  scriptLoading: {
    inline: false,
    external: true
  },
  accelerometer: false,
  imageLoading: true,
  styleLoading: true,
  localStorage: true,
  sessionStorage: true,
  indexeddb: true,
  functionConstructor: false
};

// Preset definitions - user-friendly choices
const PRESETS = {
  essential: {
    name: 'Essential',
    subtitle: 'Most restrictive',
    description: 'Blocks all non-essential capabilities for maximum security.',
    icon: '🔒',
    policy: {
      network: { fetch: true, xhr: true, websocket: false, beacon: false },
      storage: true,
      dom: "readonly",
      cookies: true,
      eval: false,
      geolocation: false,
      camera: false,
      microphone: false,
      clipboard: false,
      notifications: false,
      webrtc: false,
      scriptLoading: { inline: false, external: false },
      accelerometer: false,
      imageLoading: true,
      styleLoading: true,
      localStorage: true,
      sessionStorage: true,
      indexeddb: false,
      functionConstructor: false,
      cookiePolicy: {
        allow: ['ESSENTIAL'],
        block: ['TRACKER', 'ADS'],
        sessionize: ['ANALYTICS'],
        tempAllow: {}
      }
    }
  },
  privacy_first: {
    name: 'Privacy First',
    subtitle: 'Recommended for most users',
    description: 'Blocks tracking cookies and long-lived third-party cookies.',
    icon: '🔐',
    policy: {
      network: { fetch: true, xhr: true, websocket: false, beacon: false },
      storage: true,
      dom: "readonly",
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
      indexeddb: false,
      functionConstructor: false,
      cookiePolicy: {
        allow: ['ESSENTIAL', 'REMEMBER_ME'],
        block: ['TRACKER', 'ADS'],
        sessionize: ['ANALYTICS'],
        tempAllow: {}
      }
    }
  },
  balanced: {
    name: 'Balanced',
    subtitle: 'Default option',
    description: 'Keeps sites working while reducing tracking.',
    icon: '⚖️',
    policy: {
      network: { fetch: true, xhr: true, websocket: true, beacon: true },
      storage: true,
      dom: "full",
      cookies: true,
      eval: false,
      geolocation: true,
      camera: false,
      microphone: false,
      clipboard: false,
      notifications: false,
      webrtc: false,
      scriptLoading: { inline: true, external: true },
      accelerometer: false,
      imageLoading: true,
      styleLoading: true,
      localStorage: true,
      sessionStorage: true,
      indexeddb: true,
      functionConstructor: false,
      cookiePolicy: {
        allow: ['ESSENTIAL', 'REMEMBER_ME', 'ANALYTICS'],
        block: ['TRACKER'],
        sessionize: ['ADS'],
        tempAllow: {}
      }
    }
  },
  permissive: {
    name: 'Permissive',
    subtitle: 'Least restrictive',
    description: 'Allows most capabilities for maximum compatibility.',
    icon: '🌐',
    policy: {
      network: { fetch: true, xhr: true, websocket: true, beacon: true },
      storage: true,
      dom: "full",
      cookies: true,
      eval: true,
      geolocation: true,
      camera: true,
      microphone: true,
      clipboard: true,
      notifications: true,
      webrtc: true,
      scriptLoading: { inline: true, external: true },
      accelerometer: true,
      imageLoading: true,
      styleLoading: true,
      localStorage: true,
      sessionStorage: true,
      indexeddb: true,
      functionConstructor: true,
      cookiePolicy: {
        allow: ['ESSENTIAL', 'REMEMBER_ME', 'ANALYTICS', 'TRACKER', 'ADS'],
        block: [],
        sessionize: [],
        tempAllow: {}
      }
    }
  },
  relaxed: {
    name: 'Relaxed',
    subtitle: 'Maximum compatibility',
    description: 'Best when you want maximum compatibility.',
    icon: '🔓',
    policy: {
      network: { fetch: true, xhr: true, websocket: true, beacon: true },
      storage: true,
      dom: "full",
      cookies: true,
      eval: true,
      geolocation: true,
      camera: true,
      microphone: true,
      clipboard: true,
      notifications: true,
      webrtc: true,
      scriptLoading: { inline: true, external: true },
      accelerometer: true,
      imageLoading: true,
      styleLoading: true,
      localStorage: true,
      sessionStorage: true,
      indexeddb: true,
      functionConstructor: true,
      cookiePolicy: {
        allow: ['ESSENTIAL', 'REMEMBER_ME', 'ANALYTICS', 'ADS', 'TRACKER'],
        block: [],
        sessionize: [],
        tempAllow: {}
      }
    }
  }
};

// Initialize default policies
async function SG_initDefaultPolicies() {
  const defaultPolicies = {
    default: PRESETS.balanced.policy,
    _selectedPreset: 'balanced'
  };
  
  await chrome.storage.local.set({
    [SCRIPTGUARD_POLICIES_KEY]: defaultPolicies,
    [SCRIPTGUARD_ONBOARDED_KEY]: false
  });
  return defaultPolicies;
}

// Initialize presets
async function SG_initPresets() {
  await chrome.storage.local.set({
    [SCRIPTGUARD_PRESETS_KEY]: PRESETS
  });
}

// Get all policies
async function getPolicies() {
  const result = await chrome.storage.local.get(SCRIPTGUARD_POLICIES_KEY);
  return result[SCRIPTGUARD_POLICIES_KEY] || {};
}

// Get all presets
async function getPresets() {
  const result = await chrome.storage.local.get(SCRIPTGUARD_PRESETS_KEY);
  return result[SCRIPTGUARD_PRESETS_KEY] || PRESETS;
}

// Apply a preset to a domain
async function applyPreset(domain, presetName) {
  const presets = await getPresets();
  if (!presets[presetName]) {
    throw new Error(`Unknown preset: ${presetName}`);
  }
  
  const policies = await getPolicies();
  policies[domain] = JSON.parse(JSON.stringify(presets[presetName].policy));
  policies._selectedPreset = presetName;
  
  await chrome.storage.local.set({ [SCRIPTGUARD_POLICIES_KEY]: policies });
  return policies;
}

// Get selected preset
async function getSelectedPreset() {
  const policies = await getPolicies();
  return policies._selectedPreset || 'balanced';
}

// Update policy for a specific domain
async function updateDomainPolicy(domain, policy) {
  const policies = await getPolicies();
  policies[domain] = policy;
  await chrome.storage.local.set({ [SCRIPTGUARD_POLICIES_KEY]: policies });
  return policies;
}

// Get policy for a domain
async function getDomainPolicy(domain) {
  const policies = await getPolicies();
  const defaultPolicy = policies.default || PRESETS.balanced.policy;
  const domainPolicy = policies[domain] || {};
  return { ...defaultPolicy, ...domainPolicy };
}

// Set allow-once temporary permission
async function setAllowOnce(domain, durationMinutes = 5) {
  const policy = await getDomainPolicy(domain);
  policy._allowOnce = {
    network: true,
    storage: true,
    dom: "full",
    cookies: true,
    eval: true,
    until: Date.now() + durationMinutes * 60 * 1000
  };
  await updateDomainPolicy(domain, policy);
  return policy;
}

// Record a cookie action for undo history
async function recordCookieAction(domain, action) {
  const result = await chrome.storage.local.get(SCRIPTGUARD_COOKIE_ACTIONS_KEY);
  const history = result[SCRIPTGUARD_COOKIE_ACTIONS_KEY] || [];
  
  const actionWithMeta = {
    ...action,
    timestamp: Date.now(),
    domain
  };
  
  history.unshift(actionWithMeta);
  // Keep only last 50 actions
  if (history.length > 50) history.length = 50;
  
  await chrome.storage.local.set({ [SCRIPTGUARD_COOKIE_ACTIONS_KEY]: history });
  return actionWithMeta;
}

// Get cookie action history
async function getCookieActionHistory() {
  const result = await chrome.storage.local.get(SCRIPTGUARD_COOKIE_ACTIONS_KEY);
  return result[SCRIPTGUARD_COOKIE_ACTIONS_KEY] || [];
}

// Undo last cookie action
async function undoLastCookieAction() {
  const history = await getCookieActionHistory();
  if (history.length === 0) return null;
  
  const lastAction = history.shift();
  await chrome.storage.local.set({ [SCRIPTGUARD_COOKIE_ACTIONS_KEY]: history });
  return lastAction;
}

// Check if user has been onboarded
async function isOnboarded() {
  const result = await chrome.storage.local.get(SCRIPTGUARD_ONBOARDED_KEY);
  return result[SCRIPTGUARD_ONBOARDED_KEY] || false;
}

// Mark user as onboarded
async function markOnboarded() {
  await chrome.storage.local.set({ [SCRIPTGUARD_ONBOARDED_KEY]: true });
}

// Export for use in other scripts
if (typeof module !== 'undefined') {
  module.exports = { 
    SG_initDefaultPolicies,
    getPresets,
    PRESETS
  };
}