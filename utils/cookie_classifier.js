// Cookie classifier - categorizes and scores cookies for user-friendly display
// Turns technical cookie attributes into plain-language categories and risk levels

const CookieClassifier = {
  // Plain-language categories users understand
  CATEGORIES: {
    ESSENTIAL: { icon: '🔐', label: 'Essential', description: 'Needed for login, shopping carts, site functions.' },
    REMEMBER_ME: { icon: '⭐', label: 'Remember Me', description: 'Saves your preferences like language or theme.' },
    ANALYTICS: { icon: '📊', label: 'Analytics', description: 'Helps sites measure visits and improve content.' },
    ADS: { icon: '🎯', label: 'Personalized Ads', description: 'Used to show ads across sites.' },
    TRACKER: { icon: '⚠️', label: 'Potential Tracker', description: 'This may follow you across sites and over time.' }
  },

  RISK_LEVELS: {
    LOW: { color: '🟢', label: 'Low', description: 'Unlikely to hurt your privacy. Usually first-party and session cookies.' },
    MEDIUM: { color: '🟠', label: 'Medium', description: 'May remember you across visits or help analytics.' },
    HIGH: { color: '🔴', label: 'High', description: 'Likely to track you across sites or persist long-term.' }
  },

  // Pattern matching for common tracker/analytics cookies
  TRACKER_PATTERNS: /^(_ga|_gat|_gid|track|utm|fbp|__hssc|__hssrc|__hstc|twk_|ads|ad_|doubleclick|pagead|adx|advertis|mixpanel|amplitude|segment|drift|intercom|datadoghq)/i,
  
  ANALYTICS_PATTERNS: /^(_ga|_gat|_gid|analytics|track|mixpanel|amplitude|segment|heap|datadog|gtag|wistia|google_analytics)/i,
  
  ADS_PATTERNS: /^(ads|ad_|fbp|anj|dpm|c|uuid|advertising|adtech|dfp|goog|doubleclick|criteo|taboola|outbrain)/i,
  
  ESSENTIAL_PATTERNS: /^(session|csrf|token|auth|login|sid|sessionid|xsrf|nonce|state|code_verifier|user|jsessionid|phpsessid)/i,

  /**
   * Classify a cookie and return its category
   * @param {Object} cookie - Cookie object {name, value, domain, path, expires, secure, httpOnly, sameSite}
   * @returns {Object} {category, categoryInfo, reason}
   */
  classifyCategory(cookie) {
    const name = cookie.name || '';
    
    // Check patterns in priority order
    if (this.ESSENTIAL_PATTERNS.test(name)) {
      return {
        category: 'ESSENTIAL',
        categoryInfo: this.CATEGORIES.ESSENTIAL,
        reason: 'Contains login or session-related keywords.'
      };
    }
    
    if (this.TRACKER_PATTERNS.test(name)) {
      return {
        category: 'TRACKER',
        categoryInfo: this.CATEGORIES.TRACKER,
        reason: 'Name matches known tracker patterns.'
      };
    }
    
    if (this.ANALYTICS_PATTERNS.test(name)) {
      return {
        category: 'ANALYTICS',
        categoryInfo: this.CATEGORIES.ANALYTICS,
        reason: 'Name matches analytics service pattern.'
      };
    }
    
    if (this.ADS_PATTERNS.test(name)) {
      return {
        category: 'ADS',
        categoryInfo: this.CATEGORIES.ADS,
        reason: 'Name matches ad/personalization pattern.'
      };
    }
    
    // Default to Remember Me for persistent cookies, Essential for session
    if (this.isPersistent(cookie)) {
      return {
        category: 'REMEMBER_ME',
        categoryInfo: this.CATEGORIES.REMEMBER_ME,
        reason: 'Persistent non-tracking cookie.'
      };
    }
    
    return {
      category: 'ESSENTIAL',
      categoryInfo: this.CATEGORIES.ESSENTIAL,
      reason: 'Session cookie with no tracking indicators.'
    };
  },

  /**
   * Calculate risk score and return risk level
   * Score logic:
   * - Third-party: +3
   * - Persistent (>30 days): +2
   * - Tracker pattern: +2
   * - HttpOnly: -2 (less accessible to JS)
   * - Secure: -1
   * 
   * 0-2: Low, 3-5: Medium, 6+: High
   */
  calculateRisk(cookie, requestUrl = '') {
    let score = 0;
    const reasons = [];
    
    // Check if third-party
    const isThirdParty = this.isThirdPartyCookie(cookie, requestUrl);
    if (isThirdParty) {
      score += 3;
      reasons.push('Set by a different domain');
    }
    
    // Check if persistent
    if (this.isPersistent(cookie)) {
      score += 2;
      reasons.push(`Stored for ${this.getExpiryDescription(cookie)}`);
    }
    
    // Check name patterns
    if (this.TRACKER_PATTERNS.test(cookie.name || '')) {
      score += 2;
      reasons.push('Name matches tracker patterns');
    }
    
    // Reduce score for secure indicators
    if (cookie.httpOnly) {
      score -= 2;
    }
    if (cookie.secure) {
      score -= 1;
    }
    
    // Floor at 0
    score = Math.max(0, score);
    
    // Map score to risk level
    let riskLevel;
    if (score <= 2) {
      riskLevel = 'LOW';
    } else if (score <= 5) {
      riskLevel = 'MEDIUM';
    } else {
      riskLevel = 'HIGH';
    }
    
    return {
      score,
      riskLevel,
      riskInfo: this.RISK_LEVELS[riskLevel],
      reasons
    };
  },

  /**
   * Check if cookie is third-party
   */
  isThirdPartyCookie(cookie, requestUrl = '') {
    if (!requestUrl || !cookie.domain) return false;
    
    try {
      const reqUrl = new URL(requestUrl);
      const cookieDomain = cookie.domain.replace(/^\./, ''); // Remove leading dot
      const reqDomain = reqUrl.hostname;
      
      return !reqDomain.endsWith(cookieDomain);
    } catch (e) {
      return false;
    }
  },

  /**
   * Check if cookie is persistent (not session)
   */
  isPersistent(cookie) {
    if (!cookie.expirationDate) return false;
    
    const expiryMs = cookie.expirationDate * 1000;
    const now = Date.now();
    const daysDiff = (expiryMs - now) / (1000 * 60 * 60 * 24);
    
    return daysDiff > 1; // More than 1 day = persistent
  },

  /**
   * Human-readable expiry description
   */
  getExpiryDescription(cookie) {
    if (!cookie.expirationDate) return 'session';
    
    const expiryMs = cookie.expirationDate * 1000;
    const now = Date.now();
    const daysDiff = (expiryMs - now) / (1000 * 60 * 60 * 24);
    
    if (daysDiff < 1) return 'less than a day';
    if (daysDiff < 7) return `${Math.floor(daysDiff)} days`;
    if (daysDiff < 30) return `${Math.floor(daysDiff / 7)} weeks`;
    if (daysDiff < 365) return `${Math.floor(daysDiff / 30)} months`;
    return `${Math.floor(daysDiff / 365)} years`;
  },

  /**
   * Classify a cookie with all information
   */
  classify(cookie, requestUrl = '') {
    const categoryResult = this.classifyCategory(cookie);
    const riskResult = this.calculateRisk(cookie, requestUrl);
    
    return {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expirationDate: cookie.expirationDate,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      ...categoryResult,
      ...riskResult,
      displayText: this.getDisplayText(categoryResult, riskResult, cookie),
      explanation: this.getExplanation(categoryResult, riskResult)
    };
  },

  /**
   * Get display text for UI
   */
  getDisplayText(categoryResult, riskResult, cookie) {
    const icon = categoryResult.categoryInfo.icon;
    const category = categoryResult.categoryInfo.label;
    const risk = riskResult.riskInfo.label;
    const domain = new URL(`http://${cookie.domain}`).hostname;
    
    return `${icon} ${cookie.name} • ${category} • Risk: ${risk} ${riskResult.riskInfo.color}`;
  },

  /**
   * Get human-readable explanation
   */
  getExplanation(categoryResult, riskResult) {
    const reasons = riskResult.reasons.join('; ');
    return `${categoryResult.reason} ${reasons ? '(' + reasons + ')' : ''}`;
  }
};

// Export for use in other scripts
if (typeof module !== 'undefined') {
  module.exports = CookieClassifier;
}
