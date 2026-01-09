// Page agent - runs in page context, intercepts APIs (SAFE + network-sanitizing)
// Purpose: wrap high-risk JS APIs while avoiding recursion, runaway logging,
// and handle malformed fetch second-args that cause "not of type RequestInit".

(function() {
  'use strict';

  // -------------------- Safety / state ---------------------------------------
  window.__SG_INTERNAL_CALL__ = window.__SG_INTERNAL_CALL__ || false;
  window.__SG_POLICIES__ = window.__SG_POLICIES__ || {};

  const MAX_STACK_LEN = 2000;

  // -------------------- Helpers ----------------------------------------------
  function safeToString(x) {
    try { return x && x.toString ? x.toString() : String(x); } catch(e) { return String(x); }
  }

  function SG_isInternalURL(url) {
    if (!url) return false;
    try {
      url = url.toString();
      return url.startsWith('chrome-extension://') ||
             url.startsWith('moz-extension://') ||
             url.startsWith('devtools://') ||
             url.startsWith('about:') ||
             url.startsWith('file:');
    } catch (e) {
      return false;
    }
  }

  function SG_isTempAllowed(policy) {
    if (!policy || !policy._allowOnce) return false;
    return (Date.now() <= policy._allowOnce.until);
  }

  // Try multiple keys so popup can store either hostname, host(port) or origin
  function SG_getDomainPolicy(hostname) {
    const policies = window.__SG_POLICIES__ || {};
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
      scriptLoading: { inline: false, external: true }
    };

    // Try in order: hostname (no port), host (hostname:port), origin (scheme://host:port)
    const host = window.location.host; // hostname:port (if present)
    const origin = window.location.origin; // scheme://host:port
    const keysToTry = [hostname, host, origin];

    let hostPolicy = null;
    for (const key of keysToTry) {
      if (!key) continue;
      if (policies[key]) { hostPolicy = policies[key]; break; }
    }

    if (!hostPolicy) hostPolicy = {};

    // If _allowOnce active, merge it (simple merge)
    let merged = Object.assign({}, defaultPolicy, hostPolicy);
    if (hostPolicy._allowOnce && hostPolicy._allowOnce.until > Date.now()) {
      merged = Object.assign({}, merged, hostPolicy._allowOnce);
    }
    return merged;
  }

  // Conservative network-off check: only treat explicit false/'false'/'0'/0 as off
  function SG_policyNetworkOff(policy) {
    if (!policy) return false;
    if (policy.network === false) return true;
    if (typeof policy.network === 'string') {
      const s = policy.network.toLowerCase();
      if (s === 'false' || s === '0') return true;
    }
    if (policy.network === 0) return true;
    return false;
  }

  // -------------------- Logging (minimal & safe) -----------------------------
  function SG_parseStack(stack) {
    if (!stack || typeof stack !== 'string') return null;
    const regex = /(https?:\/\/[^\s)]+|file:\/\/[^\s)]+)/i;
    const m = stack.match(regex);
    if (m) return m[0];
    const lineRegex = /at .* \((.*):\d+:\d+\)/;
    const m2 = stack.match(lineRegex);
    return m2 ? m2[1] : null;
  }

  function SG_trimStack(stack) {
    if (!stack) return '';
    if (stack.length > MAX_STACK_LEN) return stack.slice(0, MAX_STACK_LEN) + '...';
    return stack;
  }

  function SG_createLog(type, decision, detail) {
    const rawStack = (new Error()).stack || '';
    return {
      type: type || 'agent',
      decision: decision || 'allowed',
      detail: detail || null,
      stack: SG_trimStack(rawStack),
      script: SG_parseStack(rawStack),
      host: location.hostname,
      ts: Date.now()
    };
  }

  // Only send blocked/agent/error logs. Drop internal markers.
  function SG_sendLog(logObj) {
    try {
      if (!logObj || typeof logObj !== 'object') return;
      if (logObj._internal) return;
      // Post to content script (which forwards to background)
      window.postMessage({ __SG_LOG__: logObj }, '*');
    } catch (e) {
      // swallow
    }
  }

  // -------------------- Interceptors ----------------------------------------

  // 1) FETCH (sanitizes second arg to avoid RequestInit error)
  (function() {
    if (!window.fetch) return;
    const origFetch = window.fetch;
    window.fetch = function(...args) {
      try {
        const resource = args[0];
        let init = args[1];
        const urlStr = safeToString(resource);

        if (SG_isInternalURL(urlStr)) return origFetch.apply(this, args);

        const policy = SG_getDomainPolicy(location.hostname);
        if (SG_isTempAllowed(policy)) return origFetch.apply(this, args);

        // Check granular network capability: fetch
        if (policy.network && typeof policy.network === 'object') {
          if (policy.network.fetch === false) {
            SG_sendLog(SG_createLog('fetch', 'blocked', { url: urlStr }));
            return Promise.reject(new Error('Fetch blocked by ScriptGuard'));
          }
        } else if (SG_policyNetworkOff(policy)) {
          SG_sendLog(SG_createLog('fetch', 'blocked', { url: urlStr }));
          return Promise.reject(new Error('Fetch blocked by ScriptGuard'));
        }

        // If init exists but is not an object, drop it (prevents RequestInit error)
        if (args.length >= 2 && init != null && typeof init !== 'object') {
          args = [resource];
        }
      } catch (e) {
        try {
          SG_sendLog(SG_createLog('error', 'allowed', { message: 'fetch wrapper error: ' + (e && e.message) }));
        } catch (err) {}
        return origFetch.apply(this, args);
      }
      return origFetch.apply(this, args);
    };
  })();

  // 2) XHR
  (function() {
    try {
      const OrigX = window.XMLHttpRequest;
      function WrappedX() {
        const xhr = new OrigX();
        let targetUrl = null;
        const origOpen = xhr.open;
        xhr.open = function(method, url, ...rest) {
          try { targetUrl = url ? url.toString() : null; } catch(e) { targetUrl = String(url); }
          try { return origOpen.call(this, method, url, ...rest); } catch(e) { return; }
        };
        const origSend = xhr.send;
        xhr.send = function(body) {
          try {
            if (targetUrl && SG_isInternalURL(targetUrl)) return origSend.call(this, body);
            const policy = SG_getDomainPolicy(location.hostname);
            if (SG_isTempAllowed(policy)) return origSend.call(this, body);
            
            // Check granular network capability: xhr
            if (policy.network && typeof policy.network === 'object') {
              if (policy.network.xhr === false) {
                SG_sendLog(SG_createLog('xhr', 'blocked', { url: targetUrl, method: this.__sg_method }));
                try { xhr.abort(); } catch(e) {}
                return;
              }
            } else if (SG_policyNetworkOff(policy)) {
              SG_sendLog(SG_createLog('xhr', 'blocked', { url: targetUrl, method: this.__sg_method }));
              try { xhr.abort(); } catch(e) {}
              return;
            }
          } catch (e) {}
          return origSend.call(this, body);
        };
        return xhr;
      }
      window.XMLHttpRequest = WrappedX;
    } catch (e) {}
  })();

  // 3) WebSocket - Enhanced with granular control
  (function() {
    if (!window.WebSocket) return;
    const OrigWS = window.WebSocket;
    function WrappedWS(url, protocols) {
      try {
        if (SG_isInternalURL(url)) return new OrigWS(url, protocols);
        const policy = SG_getDomainPolicy(location.hostname);
        if (SG_isTempAllowed(policy)) return new OrigWS(url, protocols);
        
        // Check granular network capability: websocket
        if (policy.network && typeof policy.network === 'object') {
          if (policy.network.websocket === false) {
            SG_sendLog(SG_createLog('websocket','blocked',{ url: safeToString(url) }));
            throw new Error('WebSocket blocked by ScriptGuard');
          }
        } else if (SG_policyNetworkOff(policy)) {
          SG_sendLog(SG_createLog('websocket','blocked',{ url: safeToString(url) }));
          throw new Error('WebSocket blocked by ScriptGuard');
        }
      } catch (e) { throw e; }
      return new OrigWS(url, protocols);
    }
    window.WebSocket = WrappedWS;
  })();

  // 4) Geolocation API
  (function() {
    if (!navigator.geolocation) return;
    try {
      const origGetPosition = navigator.geolocation.getCurrentPosition;
      const origWatchPosition = navigator.geolocation.watchPosition;
      
      navigator.geolocation.getCurrentPosition = function(success, error, options) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy) && policy.geolocation !== false) {
            return origGetPosition.call(this, success, error, options);
          }
          if (policy.geolocation === false) {
            SG_sendLog(SG_createLog('geolocation', 'blocked', { api: 'getCurrentPosition' }));
            if (error) error(new GeolocationPositionError(1, 'User denied geolocation'));
            return;
          }
        } catch (e) {}
        return origGetPosition.call(this, success, error, options);
      };
      
      navigator.geolocation.watchPosition = function(success, error, options) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy) && policy.geolocation !== false) {
            return origWatchPosition.call(this, success, error, options);
          }
          if (policy.geolocation === false) {
            SG_sendLog(SG_createLog('geolocation', 'blocked', { api: 'watchPosition' }));
            if (error) error(new GeolocationPositionError(1, 'User denied geolocation'));
            return;
          }
        } catch (e) {}
        return origWatchPosition.call(this, success, error, options);
      };
    } catch (e) {}
  })();

  // 5) Camera & Microphone via getUserMedia
  (function() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
      const origGetUserMedia = navigator.mediaDevices.getUserMedia;
      navigator.mediaDevices.getUserMedia = function(constraints) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy)) {
            if (constraints.video === false && constraints.audio === false) {
              return origGetUserMedia.call(this, constraints);
            }
          }
          
          const needsCamera = constraints && constraints.video;
          const needsMicrophone = constraints && constraints.audio;
          
          if (needsCamera && policy.camera === false) {
            SG_sendLog(SG_createLog('camera', 'blocked', { api: 'getUserMedia' }));
            return Promise.reject(new DOMException('Camera blocked by ScriptGuard', 'NotAllowedError'));
          }
          if (needsMicrophone && policy.microphone === false) {
            SG_sendLog(SG_createLog('microphone', 'blocked', { api: 'getUserMedia' }));
            return Promise.reject(new DOMException('Microphone blocked by ScriptGuard', 'NotAllowedError'));
          }
        } catch (e) {}
        return origGetUserMedia.call(this, constraints);
      };
    } catch (e) {}
  })();

  // 6) Clipboard API
  (function() {
    if (!navigator.clipboard) return;
    try {
      const origReadText = navigator.clipboard.readText;
      const origWriteText = navigator.clipboard.writeText;
      const origRead = navigator.clipboard.read;
      const origWrite = navigator.clipboard.write;
      
      navigator.clipboard.readText = function() {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy)) return origReadText.call(this);
          if (policy.clipboard === false) {
            SG_sendLog(SG_createLog('clipboard', 'blocked', { operation: 'readText' }));
            return Promise.reject(new DOMException('Clipboard read blocked by ScriptGuard', 'NotAllowedError'));
          }
        } catch (e) {}
        return origReadText.call(this);
      };
      
      navigator.clipboard.writeText = function(text) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy)) return origWriteText.call(this, text);
          if (policy.clipboard === false) {
            SG_sendLog(SG_createLog('clipboard', 'blocked', { operation: 'writeText' }));
            return Promise.reject(new DOMException('Clipboard write blocked by ScriptGuard', 'NotAllowedError'));
          }
        } catch (e) {}
        return origWriteText.call(this, text);
      };
    } catch (e) {}
  })();

  // 7) Notifications API
  (function() {
    if (!window.Notification) return;
    try {
      const OrigNotification = window.Notification;
      function WrappedNotification(title, options) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy)) return new OrigNotification(title, options);
          if (policy.notifications === false) {
            SG_sendLog(SG_createLog('notifications', 'blocked', { title: safeToString(title) }));
            throw new Error('Notifications blocked by ScriptGuard');
          }
        } catch (e) { throw e; }
        return new OrigNotification(title, options);
      }
      window.Notification = WrappedNotification;
      Object.setPrototypeOf(WrappedNotification, OrigNotification);
      Object.setPrototypeOf(WrappedNotification.prototype, OrigNotification.prototype);
    } catch (e) {}
  })();

  // 8) WebRTC - RTCPeerConnection
  (function() {
    if (!window.RTCPeerConnection) return;
    try {
      const OrigRTC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
      function WrappedRTC(config) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy)) return new OrigRTC(config);
          if (policy.webrtc === false) {
            SG_sendLog(SG_createLog('webrtc', 'blocked', { api: 'RTCPeerConnection' }));
            throw new Error('WebRTC blocked by ScriptGuard');
          }
        } catch (e) { throw e; }
        return new OrigRTC(config);
      }
      window.RTCPeerConnection = WrappedRTC;
    } catch (e) {}
  })();

  // 9) eval() - Code execution
  (function() {
    const origEval = window.eval;
    window.eval = function(code) {
      try {
        const policy = SG_getDomainPolicy(location.hostname);
        if (SG_isTempAllowed(policy)) return origEval.call(this, code);
        if (policy.eval === false) {
          SG_sendLog(SG_createLog('eval', 'blocked', { code: safeToString(code).slice(0, 100) }));
          throw new Error('eval() blocked by ScriptGuard');
        }
      } catch (e) {
        if (e.message && e.message.includes('blocked by ScriptGuard')) throw e;
      }
      return origEval.call(this, code);
    };
  })();

  // 10) Script tag injection
  (function() {
    try {
      const origCreateElement = document.createElement;
      document.createElement = function(tagName, ...args) {
        const element = origCreateElement.call(this, tagName, ...args);
        
        if (tagName && tagName.toLowerCase() === 'script') {
          const origSetAttribute = element.setAttribute;
          element.setAttribute = function(name, value) {
            try {
              if (name && name.toLowerCase() === 'src') {
                const policy = SG_getDomainPolicy(location.hostname);
                if (policy.scriptLoading && policy.scriptLoading.external === false) {
                  SG_sendLog(SG_createLog('scriptLoading', 'blocked', { type: 'external', src: safeToString(value) }));
                  return;
                }
              }
            } catch (e) {}
            return origSetAttribute.call(this, name, value);
          };
        }
        
        return element;
      };
    } catch (e) {}
  })();

  // 11) Beacon API
  (function() {
    if (!navigator.sendBeacon) return;
    try {
      const origSendBeacon = navigator.sendBeacon;
      navigator.sendBeacon = function(url, data) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy)) return origSendBeacon.call(this, url, data);
          
          // Check granular network capability: beacon
          if (policy.network && typeof policy.network === 'object') {
            if (policy.network.beacon === false) {
              SG_sendLog(SG_createLog('beacon', 'blocked', { url: safeToString(url) }));
              return false;
            }
          } else if (SG_policyNetworkOff(policy)) {
            SG_sendLog(SG_createLog('beacon', 'blocked', { url: safeToString(url) }));
            return false;
          }
        } catch (e) {}
        return origSendBeacon.call(this, url, data);
      };
    } catch (e) {}
  })();

  // 4) Storage.setItem
  (function() {
    try {
      const origSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy)) return origSet.apply(this, [key, value]);
          if (policy.storage === false || (typeof policy.storage === 'string' && policy.storage.toLowerCase() === 'false')) {
            SG_sendLog(SG_createLog('storage', 'blocked', { key: String(key).slice(0,100) }));
            return;
          }
        } catch (e) {}
        return origSet.apply(this, [key, value]);
      };
    } catch (e) {}
  })();

  // 5) cookie setter
  (function() {
    try {
      const cookieDesc =
        Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
        Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');

      if (cookieDesc && cookieDesc.set) {
        const originalSet = cookieDesc.set;
        Object.defineProperty(document, 'cookie', {
          configurable: true,
          enumerable: true,
          get: cookieDesc.get ? cookieDesc.get : function(){ return ''; },
          set: function(val) {
            try {
              const policy = SG_getDomainPolicy(location.hostname);
              if (SG_isTempAllowed(policy)) return originalSet.call(document, val);
              if (policy.cookies === false || (typeof policy.cookies === 'string' && policy.cookies.toLowerCase() === 'false')) {
                SG_sendLog(SG_createLog('cookie','blocked',{ value: String(val).slice(0,120) }));
                return;
              }
            } catch (e) {}
            return originalSet.call(document, val);
          }
        });
      }
    } catch (e) {}
  })();

  // 6) DOM mutations — guarded
  (function() {
    const domModes = { FULL: 'full', READ: 'read-only', NONE: 'none' };

    try {
      const origAppend = Element.prototype.appendChild;
      Element.prototype.appendChild = function(node) {
        try {
          if (window.__SG_INTERNAL_CALL__) return origAppend.call(this, node);
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy)) return origAppend.call(this, node);
          if (policy.dom && policy.dom !== domModes.FULL) {
            SG_sendLog(SG_createLog('dom-mod','blocked',{ operation:'appendChild', nodeName: (node && node.nodeName) || null }));
            return node;
          }
        } catch (e) {}
        return origAppend.call(this, node);
      };
    } catch (e) {}

    try {
      const proto = Element.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
      if (desc && desc.set) {
        const origSet = desc.set;
        Object.defineProperty(proto, 'innerHTML', {
          get: desc.get,
          set: function(v) {
            try {
              if (window.__SG_INTERNAL_CALL__) return origSet.call(this, v);
              const policy = SG_getDomainPolicy(location.hostname);
              if (SG_isTempAllowed(policy)) return origSet.call(this, v);
              if (policy.dom && policy.dom !== domModes.FULL) {
                SG_sendLog(SG_createLog('dom-mod','blocked',{ operation:'innerHTML_set', length: (v && v.length) || 0 }));
                return;
              }
            } catch (e) {}
            return origSet.call(this, v);
          }
        });
      }
    } catch (e) {}
  })();

  // -------------------- Messaging --------------------------------------------
  window.addEventListener('message', (event) => {
    try {
      if (!event || event.source !== window || !event.data) return;
      const d = event.data;
      if (d.__SG_INIT_POLICIES__) {
        window.__SG_POLICIES__ = d.policies || {};
        SG_sendLog(SG_createLog('agent','allowed',{ event: 'policies_updated' }));
      }
      if (d.__SG_INIT_BLOCKED_COOKIES__) {
        const blockedList = d.blockedCookies || {};
        const hostname = window.location.hostname;
        window.__SG_BLOCKED_COOKIES__ = window.__SG_BLOCKED_COOKIES__ || new Set();
        if (blockedList[hostname]) {
          blockedList[hostname].forEach(name => {
            window.__SG_BLOCKED_COOKIES__.add(name);
          });
        }
        SG_sendLog(SG_createLog('agent','allowed',{ event: 'blocked_cookies_initialized', count: window.__SG_BLOCKED_COOKIES__.size }));
      }
    } catch (e) {}
  });

  try { window.postMessage({ __SG_REQUEST_POLICIES__: true }, '*'); } catch (e) {}
  SG_sendLog(SG_createLog('agent','allowed',{ event: 'agent_initialized' }));

  // -------------------- PERSISTENT COOKIE BLOCKER --------------------
  // This monitors for blocked cookies and removes them as soon as they're set
  // Runs every 100ms to catch cookies before they're used
  
  window.__SG_BLOCKED_COOKIES__ = window.__SG_BLOCKED_COOKIES__ || new Set();
  
  async function SG_updateBlockedCookieList() {
    try {
      const result = await chrome.storage.local.get('scriptguard_blocked_cookies');
      const blockedList = result.scriptguard_blocked_cookies || {};
      
      // Clear and rebuild the set for current domain
      window.__SG_BLOCKED_COOKIES__.clear();
      const hostname = window.location.hostname;
      
      if (blockedList[hostname]) {
        blockedList[hostname].forEach(name => {
          window.__SG_BLOCKED_COOKIES__.add(name);
        });
      }
    } catch (e) {
      // Fail silently
    }
  }
  
  function SG_removeBlockedCookies() {
    if (window.__SG_BLOCKED_COOKIES__.size === 0) return;
    
    try {
      const cookies = document.cookie.split(';').map(c => c.trim());
      let removed = false;
      
      for (const cookie of cookies) {
        const name = cookie.split('=')[0];
        if (window.__SG_BLOCKED_COOKIES__.has(name)) {
          // Remove by setting expiry to past date
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${window.location.hostname};`;
          // Try with leading dot for subdomains
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.${window.location.hostname};`;
          removed = true;
        }
      }
      
      if (removed) {
        SG_sendLog(SG_createLog('cookie','blocked',{ 
          event: 'cookies_removed_persistently',
          count: Array.from(window.__SG_BLOCKED_COOKIES__).length
        }));
      }
    } catch (e) {
      // Fail silently
    }
  }
  
  // Update blocked list immediately and every 5 seconds
  SG_updateBlockedCookieList();
  setInterval(SG_updateBlockedCookieList, 5000);
  
  // Remove blocked cookies immediately and every 50ms (very aggressive - catches server-set cookies)
  SG_removeBlockedCookies();
  setInterval(SG_removeBlockedCookies, 50);
  
  // Also hook into DOMContentLoaded and common page events
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      SG_updateBlockedCookieList();
      SG_removeBlockedCookies();
    }, 100);
  });
  
  window.addEventListener('load', () => {
    setTimeout(() => {
      SG_updateBlockedCookieList();
      SG_removeBlockedCookies();
    }, 100);
  });

})();
