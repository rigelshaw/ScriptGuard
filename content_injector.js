// Content script that injects page_agent.js and relays messages
// SAFE VERSION – single injection, no feedback loops

const SCRIPTGUARD_POLICIES_KEY = "scriptguard_policies";

// Prevent multiple injections (very important)
if (!window.__SCRIPTGUARD_INJECTED__) {
  window.__SCRIPTGUARD_INJECTED__ = true;

  injectPageAgent();
}

// ------------------ INJECTION ------------------

function injectPageAgent() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('page_agent.js');
  script.async = false;
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

// ------------------ POLICY SYNC ------------------

async function sendPoliciesToPage() {
  try {
    const result = await chrome.storage.local.get(SCRIPTGUARD_POLICIES_KEY);
    const policies = result[SCRIPTGUARD_POLICIES_KEY] || {};
    window.postMessage({ __SG_INIT_POLICIES__: true, policies }, '*');
  } catch (e) {
    // fail silently
  }
}

async function sendBlockedCookiesToPage() {
  try {
    const result = await chrome.storage.local.get('scriptguard_blocked_cookies');
    const blockedCookies = result.scriptguard_blocked_cookies || {};
    window.postMessage({ __SG_INIT_BLOCKED_COOKIES__: true, blockedCookies }, '*');
  } catch (e) {
    // fail silently
  }
}

// Initial policy and blocked cookies push
sendPoliciesToPage();
sendBlockedCookiesToPage();

// Update page when policies change
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes[SCRIPTGUARD_POLICIES_KEY]) {
    sendPoliciesToPage();
  }
  if (namespace === 'local' && changes['scriptguard_blocked_cookies']) {
    sendBlockedCookiesToPage();
  }
});

// ------------------ LOG RELAY ------------------

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;

  // Forward logs to background
  if (event.data.__SG_LOG__) {
    try {
      chrome.runtime.sendMessage({
        type: 'SG_LOG',
        payload: event.data.__SG_LOG__
      });
    } catch (e) {}
  }

  // Page agent requesting policies
  if (event.data.__SG_REQUEST_POLICIES__) {
    sendPoliciesToPage();
  }
});
