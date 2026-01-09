// Background service worker for ScriptGuard
// Handles policies and buffered log persistence (SAFE VERSION)

const SCRIPTGUARD_POLICIES_KEY = "scriptguard_policies";
const SCRIPTGUARD_LOGS_KEY = "scriptguard_logs";

// Default policy with comprehensive capabilities
const DEFAULT_POLICY = {
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
  scriptLoading: { inline: false, external: true }
};

// Preset policies
const PRESET_POLICIES = {
  essential: {
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
    scriptLoading: { inline: false, external: false }
  },
  privacy_first: {
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
    scriptLoading: { inline: false, external: true }
  },
  balanced: {
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
    scriptLoading: { inline: true, external: true }
  },
  permissive: {
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
    scriptLoading: { inline: true, external: true }
  }
};

// ------------------ POLICY INIT ------------------

chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.local.get(SCRIPTGUARD_POLICIES_KEY);
  if (!result[SCRIPTGUARD_POLICIES_KEY]) {
    const defaultPolicies = {
      default: DEFAULT_POLICY,
      _presets: PRESET_POLICIES
    };
    await chrome.storage.local.set({
      [SCRIPTGUARD_POLICIES_KEY]: defaultPolicies
    });
    console.log("ScriptGuard: Default policies initialized with comprehensive capabilities");
  }
});

// ------------------ LOG BUFFER ------------------

let logBuffer = [];
let flushTimer = null;
const FLUSH_INTERVAL = 500; // ms
const MAX_LOGS = 1000;
const MAX_BUFFER = 200;

async function flushLogs() {
  if (logBuffer.length === 0) return;

  try {
    const result = await chrome.storage.local.get(SCRIPTGUARD_LOGS_KEY);
    const existingLogs = result[SCRIPTGUARD_LOGS_KEY] || [];

    const merged = logBuffer.concat(existingLogs);
    if (merged.length > MAX_LOGS) merged.length = MAX_LOGS;

    await chrome.storage.local.set({ [SCRIPTGUARD_LOGS_KEY]: merged });
    logBuffer = [];
  } catch (err) {
    console.error("ScriptGuard: Failed to flush logs", err);
  }
}

function bufferLog(logObj) {
  logBuffer.unshift(logObj);
  if (logBuffer.length > MAX_BUFFER) logBuffer.length = MAX_BUFFER;

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushLogs();
    }, FLUSH_INTERVAL);
  }
}

// ------------------ MESSAGE HANDLING ------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    case 'SG_LOG':
      if (message.payload) {
        if (!message.payload.ts) {
          message.payload.ts = Date.now();
        }
        bufferLog(message.payload);
      }
      break;

    case 'SG_GET_LOGS':
      chrome.storage.local.get(SCRIPTGUARD_LOGS_KEY).then(result => {
        sendResponse({ logs: result[SCRIPTGUARD_LOGS_KEY] || [] });
      });
      return true;

    case 'SG_CLEAR_LOGS':
      chrome.storage.local.set({ [SCRIPTGUARD_LOGS_KEY]: [] }).then(() => {
        sendResponse({ ok: true });
      });
      return true;
  }
});
