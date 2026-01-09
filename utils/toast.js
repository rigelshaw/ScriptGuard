// Toast notification system for user feedback
// Shows non-intrusive notifications with optional undo actions

const Toast = {
  containerId: 'sg-toast-container',
  
  /**
   * Initialize toast container in DOM
   */
  init() {
    if (document.getElementById(this.containerId)) return;
    
    const container = document.createElement('div');
    container.id = this.containerId;
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  },

  /**
   * Show a toast notification
   * @param {Object} options - {message, type: 'info'|'success'|'error'|'warning', duration, onUndo}
   */
  show(options = {}) {
    this.init();
    
    const {
      message = '',
      type = 'info',
      duration = 5000,
      onUndo = null
    } = options;
    
    const toast = document.createElement('div');
    toast.className = `sg-toast sg-toast-${type}`;
    
    const colorMap = {
      'success': '#34a853',
      'error': '#ea4335',
      'warning': '#fbbc05',
      'info': '#1a73e8'
    };
    
    const bgColorMap = {
      'success': '#f1f8f5',
      'error': '#fdf1f0',
      'warning': '#fffbf0',
      'info': '#f0f7ff'
    };
    
    toast.style.cssText = `
      background: ${bgColorMap[type] || bgColorMap['info']};
      border-left: 4px solid ${colorMap[type] || colorMap['info']};
      border-radius: 4px;
      padding: 12px 16px;
      margin-bottom: 12px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.15);
      display: flex;
      align-items: center;
      justify-content: space-between;
      pointer-events: auto;
      animation: slideIn 0.3s ease-out;
      font-size: 14px;
      color: #333;
      max-width: 400px;
    `;
    
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    messageSpan.style.cssText = 'flex: 1;';
    toast.appendChild(messageSpan);
    
    if (onUndo) {
      const undoBtn = document.createElement('button');
      undoBtn.textContent = 'Undo';
      undoBtn.style.cssText = `
        margin-left: 12px;
        padding: 4px 8px;
        background: transparent;
        border: 1px solid ${colorMap[type] || colorMap['info']};
        color: ${colorMap[type] || colorMap['info']};
        border-radius: 3px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: background 0.2s;
      `;
      undoBtn.onmouseover = () => {
        undoBtn.style.background = colorMap[type] + '20';
      };
      undoBtn.onmouseout = () => {
        undoBtn.style.background = 'transparent';
      };
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
      line-height: 1;
    `;
    closeBtn.onclick = () => toast.remove();
    toast.appendChild(closeBtn);
    
    const container = document.getElementById(this.containerId);
    container.appendChild(toast);
    
    if (duration > 0) {
      setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }
    
    return toast;
  },

  success(message, options = {}) {
    return this.show({ ...options, message, type: 'success' });
  },

  error(message, options = {}) {
    return this.show({ ...options, message, type: 'error' });
  },

  warning(message, options = {}) {
    return this.show({ ...options, message, type: 'warning' });
  },

  info(message, options = {}) {
    return this.show({ ...options, message, type: 'info' });
  }
};

// Add animations to stylesheet
if (!document.getElementById('sg-toast-styles')) {
  const style = document.createElement('style');
  style.id = 'sg-toast-styles';
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}
