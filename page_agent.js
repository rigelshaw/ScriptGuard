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
      scriptLoading: { inline: false, external: true },
      accelerometer: false,
      imageLoading: true,
      styleLoading: true,
      localStorage: true,
      sessionStorage: true,
      indexeddb: true,
      functionConstructor: false
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

        // Check granular network capability: fetch - block only if explicitly disabled
        if (policy.network && typeof policy.network === 'object') {
          if (policy.network.fetch !== true) {
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
            
            // Check granular network capability: xhr - block only if explicitly disabled
            if (policy.network && typeof policy.network === 'object') {
              if (policy.network.xhr !== true) {
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
        
        // Check granular network capability: websocket - block only if explicitly disabled
        if (policy.network && typeof policy.network === 'object') {
          if (policy.network.websocket !== true) {
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

  // 4) Geolocation API - Comprehensive blocking
  (function() {
    if (!navigator.geolocation) return;
    try {
      const origGetPosition = navigator.geolocation.getCurrentPosition;
      const origWatchPosition = navigator.geolocation.watchPosition;
      const origClearWatch = navigator.geolocation.clearWatch;
      
      // Create error for geolocation denial
      const createGeoError = function() {
        try {
          return new GeolocationPositionError(1, 'User denied geolocation');
        } catch (e) {
          // Fallback error object
          return { code: 1, message: 'User denied geolocation', PERMISSION_DENIED: 1 };
        }
      };
      
      navigator.geolocation.getCurrentPosition = function(success, error, options) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy)) {
            return origGetPosition.call(this, success, error, options);
          }
          // Block unless explicitly allowed
          if (policy.geolocation !== true) {
            SG_sendLog(SG_createLog('geolocation', 'blocked', { api: 'getCurrentPosition', method: 'policy' }));
            // Schedule error callback asynchronously to match browser behavior
            setTimeout(() => {
              if (error && typeof error === 'function') {
                try {
                  error(createGeoError());
                } catch (e) {}
              }
            }, 0);
            return undefined;
          }
        } catch (e) {}
        return origGetPosition.call(this, success, error, options);
      };
      
      navigator.geolocation.watchPosition = function(success, error, options) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy)) {
            return origWatchPosition.call(this, success, error, options);
          }
          // Block unless explicitly allowed
          if (policy.geolocation !== true) {
            SG_sendLog(SG_createLog('geolocation', 'blocked', { api: 'watchPosition', method: 'policy' }));
            // Schedule error callback asynchronously
            setTimeout(() => {
              if (error && typeof error === 'function') {
                try {
                  error(createGeoError());
                } catch (e) {}
              }
            }, 0);
            // Return a fake watch ID so clearWatch doesn't break
            return Math.floor(Math.random() * 1000000);
          }
        } catch (e) {}
        return origWatchPosition.call(this, success, error, options);
      };
      
      // clearWatch should work even if we blocked the watch
      navigator.geolocation.clearWatch = function(id) {
        try {
          return origClearWatch.call(this, id);
        } catch (e) {}
      };
    } catch (e) {}
  })();

  // 4b) Block geolocation via permission API
  (function() {
    if (!navigator.permissions || !navigator.permissions.query) return;
    try {
      const origQuery = navigator.permissions.query;
      navigator.permissions.query = function(parameters) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          // Block geolocation permission queries
          if (parameters && parameters.name === 'geolocation' && policy.geolocation !== true) {
            SG_sendLog(SG_createLog('geolocation', 'blocked', { api: 'permissions.query' }));
            // Return promise that resolves to denied state
            return Promise.resolve({ state: 'denied', onchange: null });
          }
        } catch (e) {}
        return origQuery.call(this, parameters);
      };
    } catch (e) {}
  })();

  // 4c) Block geolocation detection via feature detection
  (function() {
    try {
      // Some sites check if geolocation exists
      Object.defineProperty(navigator, 'geolocation', {
        enumerable: true,
        configurable: true,
        get: function() {
          try {
            const policy = SG_getDomainPolicy(location.hostname);
            // If blocked, return undefined so sites think it doesn't exist
            if (policy.geolocation !== true) {
              SG_sendLog(SG_createLog('geolocation', 'blocked', { method: 'property access' }));
              return undefined;
            }
          } catch (e) {}
          // Return actual geolocation object
          return this.__geolocation__ || {};
        }
      });
    } catch (e) {}
  })();

  // 5) Camera & Microphone via getUserMedia - Comprehensive blocking
  (function() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
      const origGetUserMedia = navigator.mediaDevices.getUserMedia;
      navigator.mediaDevices.getUserMedia = function(constraints) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy)) {
            if (constraints && constraints.video === false && constraints.audio === false) {
              return origGetUserMedia.call(this, constraints);
            }
          }
          
          const needsCamera = constraints && constraints.video;
          const needsMicrophone = constraints && constraints.audio;
          
          if (needsCamera && policy.camera !== true) {
            SG_sendLog(SG_createLog('camera', 'blocked', { api: 'getUserMedia', method: 'policy' }));
            return Promise.reject(new DOMException('Camera blocked by ScriptGuard', 'NotAllowedError'));
          }
          if (needsMicrophone && policy.microphone !== true) {
            SG_sendLog(SG_createLog('microphone', 'blocked', { api: 'getUserMedia', method: 'policy' }));
            return Promise.reject(new DOMException('Microphone blocked by ScriptGuard', 'NotAllowedError'));
          }
        } catch (e) {}
        return origGetUserMedia.call(this, constraints);
      };
    } catch (e) {}
  })();

  // 5b) Block camera/microphone via permissions API
  (function() {
    if (!navigator.permissions || !navigator.permissions.query) return;
    try {
      const origQuery = navigator.permissions.query;
      navigator.permissions.query = function(parameters) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          // Block camera permission queries
          if (parameters && parameters.name === 'camera' && policy.camera !== true) {
            SG_sendLog(SG_createLog('camera', 'blocked', { api: 'permissions.query' }));
            return Promise.resolve({ state: 'denied', onchange: null });
          }
          // Block microphone permission queries
          if (parameters && parameters.name === 'microphone' && policy.microphone !== true) {
            SG_sendLog(SG_createLog('microphone', 'blocked', { api: 'permissions.query' }));
            return Promise.resolve({ state: 'denied', onchange: null });
          }
        } catch (e) {}
        return origQuery.call(this, parameters);
      };
    } catch (e) {}
  })();

  // 5c) Block enumerateDevices for camera/microphone
  (function() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const origEnumerate = navigator.mediaDevices.enumerateDevices;
      navigator.mediaDevices.enumerateDevices = function() {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          // If both camera and mic blocked, return empty device list
          if (policy.camera !== true && policy.microphone !== true) {
            SG_sendLog(SG_createLog('camera', 'blocked', { api: 'enumerateDevices' }));
            SG_sendLog(SG_createLog('microphone', 'blocked', { api: 'enumerateDevices' }));
            return Promise.resolve([]);
          }
          // Otherwise enumerate but filter devices
          return origEnumerate.call(this).then(devices => {
            const filtered = devices.filter(device => {
              if (device.kind === 'videoinput' && policy.camera !== true) {
                SG_sendLog(SG_createLog('camera', 'blocked', { device: device.label }));
                return false;
              }
              if (device.kind === 'audioinput' && policy.microphone !== true) {
                SG_sendLog(SG_createLog('microphone', 'blocked', { device: device.label }));
                return false;
              }
              return true;
            });
            return filtered;
          });
        } catch (e) {}
        return origEnumerate.call(this);
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
          if (policy.clipboard !== true) {
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
          if (policy.clipboard !== true) {
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
          if (policy.notifications !== true) {
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
          if (policy.webrtc !== true) {
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
        if (policy.eval !== true) {
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
                if (policy.scriptLoading && typeof policy.scriptLoading === 'object') {
                  if (policy.scriptLoading.external !== true) {
                    SG_sendLog(SG_createLog('scriptLoading', 'blocked', { type: 'external', src: safeToString(value) }));
                    return;
                  }
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
          
          // Check granular network capability: beacon - block only if explicitly disabled
          if (policy.network && typeof policy.network === 'object') {
            if (policy.network.beacon !== true) {
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

  // 12) Accelerometer API (Device Motion)
  (function() {
    if (!window.DeviceMotionEvent) return;
    try {
      window.addEventListener('devicemotion', function(event) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (policy.accelerometer !== true) {
            SG_sendLog(SG_createLog('accelerometer', 'blocked', { event: 'devicemotion' }));
            event.preventDefault();
            return false;
          }
        } catch (e) {}
      }, true);
    } catch (e) {}
  })();

  // 13) Device Orientation API
  (function() {
    if (!window.DeviceOrientationEvent) return;
    try {
      window.addEventListener('deviceorientation', function(event) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (policy.accelerometer !== true) {
            SG_sendLog(SG_createLog('deviceorientation', 'blocked', { event: 'deviceorientation' }));
            event.preventDefault();
            return false;
          }
        } catch (e) {}
      }, true);
    } catch (e) {}
  })();

  // 14) Image Loading - Comprehensive blocking
  (function() {
    try {
      // Block Image() constructor
      const OrigImage = window.Image;
      window.Image = function() {
        const img = new OrigImage();
        const origSrc = Object.getOwnPropertyDescriptor(OrigImage.prototype, 'src') || {};
        
        Object.defineProperty(img, 'src', {
          set: function(url) {
            try {
              const policy = SG_getDomainPolicy(location.hostname);
              // Block ONLY if explicitly false (unchecked)
              if (policy.imageLoading === false) {
                SG_sendLog(SG_createLog('imageLoading', 'blocked', { url: safeToString(url).slice(0, 100), method: 'Image.src' }));
                return;
              }
            } catch (e) {}
            if (origSrc.set) origSrc.set.call(this, url);
          },
          get: function() {
            return origSrc.get ? origSrc.get.call(this) : this._src;
          }
        });
        return img;
      };
      window.Image.prototype = OrigImage.prototype;
    } catch (e) {}
  })();

  // 14b) Block img tag src attribute and properties
  (function() {
    try {
      const OrigHTMLImageElement = window.HTMLImageElement;
      if (OrigHTMLImageElement && OrigHTMLImageElement.prototype) {
        const origSrcDesc = Object.getOwnPropertyDescriptor(OrigHTMLImageElement.prototype, 'src');
        if (origSrcDesc && origSrcDesc.set) {
          Object.defineProperty(OrigHTMLImageElement.prototype, 'src', {
            enumerable: origSrcDesc.enumerable,
            configurable: true,
            get: origSrcDesc.get,
            set: function(url) {
              try {
                const policy = SG_getDomainPolicy(location.hostname);
                // Block ONLY if explicitly false (unchecked)
                if (policy.imageLoading === false) {
                  SG_sendLog(SG_createLog('imageLoading', 'blocked', { url: safeToString(url).slice(0, 100), method: 'img.src' }));
                  return;
                }
              } catch (e) {}
              origSrcDesc.set.call(this, url);
            }
          });
        }
      }
    } catch (e) {}
  })();

  // 14c) Block img srcset attribute
  (function() {
    try {
      const OrigHTMLImageElement = window.HTMLImageElement;
      if (OrigHTMLImageElement && OrigHTMLImageElement.prototype) {
        const origSrcsetDesc = Object.getOwnPropertyDescriptor(OrigHTMLImageElement.prototype, 'srcset');
        if (origSrcsetDesc && origSrcsetDesc.set) {
          Object.defineProperty(OrigHTMLImageElement.prototype, 'srcset', {
            enumerable: origSrcsetDesc.enumerable,
            configurable: true,
            get: origSrcsetDesc.get,
            set: function(value) {
              try {
                const policy = SG_getDomainPolicy(location.hostname);
                // Block ONLY if explicitly false (unchecked)
                if (policy.imageLoading === false) {
                  SG_sendLog(SG_createLog('imageLoading', 'blocked', { srcset: safeToString(value).slice(0, 100) }));
                  return;
                }
              } catch (e) {}
              origSrcsetDesc.set.call(this, value);
            }
          });
        }
      }
    } catch (e) {}
  })();

  // 14d) Block img setAttribute for src
  (function() {
    try {
      const origSetAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function(name, value) {
        try {
          if (this.tagName && this.tagName.toLowerCase() === 'img' && name && name.toLowerCase() === 'src') {
            const policy = SG_getDomainPolicy(location.hostname);
            // Block ONLY if explicitly false (unchecked)
            if (policy.imageLoading === false) {
              SG_sendLog(SG_createLog('imageLoading', 'blocked', { url: safeToString(value).slice(0, 100), method: 'setAttribute' }));
              return;
            }
          }
        } catch (e) {}
        return origSetAttribute.call(this, name, value);
      };
    } catch (e) {}
  })();

  // 15) Style Sheet Loading - Comprehensive blocking
  (function() {
    try {
      const origCreateElement = document.createElement;
      document.createElement = function(tagName, ...args) {
        const element = origCreateElement.call(this, tagName, ...args);
        if (tagName && tagName.toLowerCase() === 'link') {
          const origSetAttribute = element.setAttribute;
          element.setAttribute = function(name, value) {
            try {
              if (name && name.toLowerCase() === 'href') {
                const rel = element.rel || '';
                if (rel.toLowerCase().includes('stylesheet')) {
                  const policy = SG_getDomainPolicy(location.hostname);
                  // Block ONLY if explicitly false (unchecked)
                  if (policy.styleLoading === false) {
                    SG_sendLog(SG_createLog('styleLoading', 'blocked', { href: safeToString(value).slice(0, 100), method: 'setAttribute' }));
                    return;
                  }
                }
              }
              if (name && name.toLowerCase() === 'rel') {
                // Block if setting rel to stylesheet
                if (value && value.toLowerCase().includes('stylesheet')) {
                  const policy = SG_getDomainPolicy(location.hostname);
                  // Block ONLY if explicitly false (unchecked)
                  if (policy.styleLoading === false) {
                    SG_sendLog(SG_createLog('styleLoading', 'blocked', { rel: value, method: 'setAttribute' }));
                    return;
                  }
                }
              }
            } catch (e) {}
            return origSetAttribute.call(this, name, value);
          };
        }
        if (tagName && tagName.toLowerCase() === 'style') {
          // Block <style> tag content injection
          const origTextContentDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'textContent');
          if (origTextContentDesc && origTextContentDesc.set) {
            Object.defineProperty(element, 'textContent', {
              enumerable: origTextContentDesc.enumerable,
              configurable: true,
              get: origTextContentDesc.get,
              set: function(value) {
                try {
                  const policy = SG_getDomainPolicy(location.hostname);
                  // Block ONLY if explicitly false (unchecked)
                  if (policy.styleLoading === false) {
                    SG_sendLog(SG_createLog('styleLoading', 'blocked', { length: String(value).length, method: 'style.textContent' }));
                    return;
                  }
                } catch (e) {}
                origTextContentDesc.set.call(this, value);
              }
            });
          }
        }
        return element;
      };
      document.createElement.prototype = origCreateElement.prototype;
    } catch (e) {}
  })();

  // 15b) Block link href property
  (function() {
    try {
      const OrigHTMLLinkElement = window.HTMLLinkElement;
      if (OrigHTMLLinkElement && OrigHTMLLinkElement.prototype) {
        const origHrefDesc = Object.getOwnPropertyDescriptor(OrigHTMLLinkElement.prototype, 'href');
        if (origHrefDesc && origHrefDesc.set) {
          Object.defineProperty(OrigHTMLLinkElement.prototype, 'href', {
            enumerable: origHrefDesc.enumerable,
            configurable: true,
            get: origHrefDesc.get,
            set: function(url) {
              try {
                const policy = SG_getDomainPolicy(location.hostname);
                const rel = (this.rel || '').toLowerCase();
                // Block ONLY if explicitly false (unchecked)
                if (policy.styleLoading === false && rel.includes('stylesheet')) {
                  SG_sendLog(SG_createLog('styleLoading', 'blocked', { href: safeToString(url).slice(0, 100), method: 'link.href' }));
                  return;
                }
              } catch (e) {}
              origHrefDesc.set.call(this, url);
            }
          });
        }
      }
    } catch (e) {}
  })();

  // 15c) Block inline style attribute
  (function() {
    try {
      const origStyleDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style');
      if (origStyleDesc && origStyleDesc.set) {
        const origStyleSetter = origStyleDesc.set;
        Object.defineProperty(HTMLElement.prototype, 'style', {
          enumerable: origStyleDesc.enumerable,
          configurable: true,
          get: origStyleDesc.get,
          set: function(value) {
            try {
              const policy = SG_getDomainPolicy(location.hostname);
              // Block ONLY if explicitly false (unchecked)
              if (policy.styleLoading === false) {
                SG_sendLog(SG_createLog('styleLoading', 'blocked', { inlineStyle: safeToString(value).slice(0, 100) }));
                return;
              }
            } catch (e) {}
            origStyleSetter.call(this, value);
          }
        });
      }
    } catch (e) {}
  })();

  // 16) IndexedDB
  (function() {
    if (!window.indexedDB) return;
    try {
      const origOpen = window.indexedDB.open;
      window.indexedDB.open = function(name, version) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (policy.indexeddb !== true) {
            SG_sendLog(SG_createLog('indexeddb', 'blocked', { dbName: safeToString(name) }));
            return Promise.reject(new Error('IndexedDB blocked by ScriptGuard'));
          }
        } catch (e) {}
        return origOpen.call(this, name, version);
      };
    } catch (e) {}
  })();

  // 17) Function Constructor
  (function() {
    try {
      const OrigFunction = Function;
      const FunctionHandler = {
        construct(target, args) {
          try {
            const policy = SG_getDomainPolicy(location.hostname);
            if (policy.functionConstructor !== true) {
              SG_sendLog(SG_createLog('functionConstructor', 'blocked', { argsCount: args.length }));
              throw new Error('Function constructor blocked by ScriptGuard');
            }
          } catch (e) {
            if (e.message.includes('blocked by ScriptGuard')) throw e;
          }
          return new target(...args);
        }
      };
      window.Function = new Proxy(OrigFunction, FunctionHandler);
    } catch (e) {}
  })();

  // 4) Storage.setItem
  (function() {
    try {
      const origSet = Storage.prototype.setItem;
      const origGetItem = Storage.prototype.getItem;
      const origRemoveItem = Storage.prototype.removeItem;
      const origClear = Storage.prototype.clear;
      
      Storage.prototype.setItem = function(key, value) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy)) return origSet.apply(this, [key, value]);
          
          // Check if this is localStorage or sessionStorage
          const isSessionStorage = this === window.sessionStorage;
          const capability = isSessionStorage ? 'sessionStorage' : 'localStorage';
          
          if (policy[capability] !== true) {
            SG_sendLog(SG_createLog(capability, 'blocked', { key: String(key).slice(0,100), action: 'setItem' }));
            return;
          }
        } catch (e) {}
        return origSet.apply(this, [key, value]);
      };
      
      Storage.prototype.getItem = function(key) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy)) return origGetItem.apply(this, [key]);
          
          const isSessionStorage = this === window.sessionStorage;
          const capability = isSessionStorage ? 'sessionStorage' : 'localStorage';
          
          if (policy[capability] !== true) {
            SG_sendLog(SG_createLog(capability, 'blocked', { key: String(key).slice(0,100), action: 'getItem' }));
            return null;
          }
        } catch (e) {}
        return origGetItem.apply(this, [key]);
      };
      
      Storage.prototype.removeItem = function(key) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy)) return origRemoveItem.apply(this, [key]);
          
          const isSessionStorage = this === window.sessionStorage;
          const capability = isSessionStorage ? 'sessionStorage' : 'localStorage';
          
          if (policy[capability] !== true) {
            SG_sendLog(SG_createLog(capability, 'blocked', { key: String(key).slice(0,100), action: 'removeItem' }));
            return;
          }
        } catch (e) {}
        return origRemoveItem.apply(this, [key]);
      };
      
      Storage.prototype.clear = function() {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy)) return origClear.apply(this);
          
          const isSessionStorage = this === window.sessionStorage;
          const capability = isSessionStorage ? 'sessionStorage' : 'localStorage';
          
          if (policy[capability] !== true) {
            SG_sendLog(SG_createLog(capability, 'blocked', { action: 'clear' }));
            return;
          }
        } catch (e) {}
        return origClear.apply(this);
      };
    } catch (e) {}
  })();

  // 5) cookie setter and getter
  (function() {
    try {
      const cookieDesc =
        Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
        Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');

      if (cookieDesc) {
        const originalSet = cookieDesc.set;
        const originalGet = cookieDesc.get;
        
        Object.defineProperty(document, 'cookie', {
          configurable: true,
          enumerable: true,
          get: function() {
            try {
              const policy = SG_getDomainPolicy(location.hostname);
              if (policy.cookies !== true) {
                // Cookies disabled - return empty string and log
                SG_sendLog(SG_createLog('cookie', 'blocked', { operation: 'read', effect: 'cookie access blocked' }));
                return '';
              }
            } catch (e) {}
            
            // Cookies allowed - return actual value
            if (originalGet) {
              return originalGet.call(document);
            }
            return '';
          },
          set: function(val) {
            try {
              const policy = SG_getDomainPolicy(location.hostname);
              if (SG_isTempAllowed(policy)) {
                if (originalSet) return originalSet.call(document, val);
                return;
              }
              if (policy.cookies !== true) {
                SG_sendLog(SG_createLog('cookie', 'blocked', { value: String(val).slice(0, 120), operation: 'write' }));
                return;
              }
            } catch (e) {}
            if (originalSet) return originalSet.call(document, val);
          }
        });
      }
    } catch (e) {}
  })();

  // 6) DOM mutations — guarded
  (function() {
    const domModes = { FULL: 'full', READ: 'readonly', NONE: 'none' };

    try {
      const origAppend = Element.prototype.appendChild;
      Element.prototype.appendChild = function(node) {
        try {
          if (window.__SG_INTERNAL_CALL__) return origAppend.call(this, node);
          const policy = SG_getDomainPolicy(location.hostname);
          if (SG_isTempAllowed(policy)) return origAppend.call(this, node);
          // Block if policy says "readonly" or "none"
          if (policy.dom && (policy.dom === 'readonly' || policy.dom === 'none')) {
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
              // Block if policy says "readonly" or "none"
              if (policy.dom && (policy.dom === 'readonly' || policy.dom === 'none')) {
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

  // 23) Block DeviceOrientation/DeviceMotion (can reveal location via movement patterns)
  (function() {
    try {
      const origAddEventListener = window.addEventListener;
      window.addEventListener = function(type, listener, options) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          // Block device motion/orientation sensors
          if (type === 'devicemotion' && policy.geolocation !== true) {
            SG_sendLog(SG_createLog('geolocation', 'blocked', { api: 'devicemotion_listener' }));
            return;
          }
          if (type === 'deviceorientation' && policy.geolocation !== true) {
            SG_sendLog(SG_createLog('geolocation', 'blocked', { api: 'deviceorientation_listener' }));
            return;
          }
          if ((type === 'orientationchange') && policy.geolocation !== true) {
            SG_sendLog(SG_createLog('geolocation', 'blocked', { api: 'orientationchange_listener' }));
            return;
          }
        } catch (e) {}
        return origAddEventListener.call(this, type, listener, options);
      };
    } catch (e) {}
  })();

  // 24) Block WebRTC IP leak (can reveal real IP and geolocate)
  (function() {
    try {
      const origRTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
      if (!origRTCPeerConnection) return;
      
      window.RTCPeerConnection = function(config) {
        try {
          const policy = SG_getDomainPolicy(location.hostname);
          if (policy.geolocation !== true) {
            SG_sendLog(SG_createLog('geolocation', 'blocked', { api: 'RTCPeerConnection' }));
            // Return a no-op object that looks like RTCPeerConnection
            return {
              createDataChannel: () => ({ send: () => {}, close: () => {} }),
              createOffer: () => Promise.resolve(),
              createAnswer: () => Promise.resolve(),
              setLocalDescription: () => Promise.resolve(),
              setRemoteDescription: () => Promise.resolve(),
              addTrack: () => {},
              removeTrack: () => {},
              getSenders: () => [],
              getReceivers: () => [],
              getTransceivers: () => [],
              close: () => {},
              addEventListener: () => {},
              removeEventListener: () => {}
            };
          }
        } catch (e) {}
        return new origRTCPeerConnection(config);
      };
      window.RTCPeerConnection.prototype = origRTCPeerConnection.prototype;
      
      if (window.webkitRTCPeerConnection) {
        window.webkitRTCPeerConnection = window.RTCPeerConnection;
      }
    } catch (e) {}
  })();

  // 25) Block WiFi Access Point enumeration
  (function() {
    try {
      if (navigator.getNetworkInformation) {
        const origGetNetworkInfo = navigator.getNetworkInformation;
        navigator.getNetworkInformation = function() {
          try {
            const policy = SG_getDomainPolicy(location.hostname);
            if (policy.geolocation !== true) {
              SG_sendLog(SG_createLog('geolocation', 'blocked', { api: 'getNetworkInformation' }));
              return Promise.reject(new Error('Network information blocked'));
            }
          } catch (e) {}
          return origGetNetworkInfo.call(this);
        };
      }
    } catch (e) {}
  })();

})();
