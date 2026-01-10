// Demo social widget - simulates comments and DOM updates
(function() {
  'use strict';
  
  const STORAGE_KEY = 'sg_demo_comments';
  const COMMENTS_ID = 'comments';
  
  function log(message, type = 'info') {
    console.log(`[Social Widget] ${message}`);
  }
  
  function loadComments() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      log(`Failed to load comments: ${error.message}`, 'error');
      return [];
    }
  }
  
  function saveComments(comments) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(comments));
      log(`Saved ${comments.length} comments to storage`);
      return true;
    } catch (error) {
      log(`Failed to save comments: ${error.message}`, 'error');
      return false;
    }
  }
  
  function renderComments() {
    const container = document.getElementById(COMMENTS_ID);
    if (!container) return;
    
    const comments = loadComments();
    
    // Clear and re-render
    container.innerHTML = '';
    
    if (comments.length === 0) {
      container.innerHTML = '<p>No comments yet. Be the first to comment!</p>';
      return;
    }
    
    const list = document.createElement('div');
    list.className = 'comment-list';
    
    comments.forEach((comment, index) => {
      const div = document.createElement('div');
      div.className = 'comment';
      div.style.padding = '10px';
      div.style.margin = '10px 0';
      div.style.background = '#f0f0f0';
      div.style.borderRadius = '4px';
      
      div.innerHTML = `
        <strong>${comment.author || 'Anonymous'}</strong>
        <small>${new Date(comment.timestamp).toLocaleTimeString()}</small>
        <p>${comment.text}</p>
      `;
      
      list.appendChild(div);
    });
    
    try {
      container.appendChild(list);
      log(`Rendered ${comments.length} comments to DOM`);
    } catch (error) {
      log(`Failed to render comments: ${error.message}`, 'error');
    }
  }
  
  function addComment(text = 'Demo comment from social widget', author = 'Demo User') {
    const comments = loadComments();
    
    const newComment = {
      text,
      author,
      timestamp: Date.now()
    };
    
    comments.push(newComment);
    
    if (saveComments(comments)) {
      renderComments();
      log(`Added comment: "${text.substring(0, 50)}..."`);
      return true;
    }
    
    return false;
  }
  
  function initializeWidget() {
    log('Initializing social widget...');
    
    // Load existing comments
    const comments = loadComments();
    log(`Loaded ${comments.length} existing comments`);
    
    // Render comments
    renderComments();
    
    // Add a demo comment if none exist
    if (comments.length === 0) {
      setTimeout(() => {
        addComment('Welcome to the ScriptGuard demo! This is a test comment stored in localStorage.', 'System');
      }, 1000);
    }
    
    // Add sample DOM elements
    try {
      const widget = document.getElementById('socialWidget');
      if (widget) {
        const header = document.createElement('h3');
        header.textContent = '💬 Live Comments';
        header.style.color = '#1a73e8';
        widget.insertBefore(header, document.getElementById(COMMENTS_ID));
        
        log('Added widget header to DOM');
      }
    } catch (error) {
      log(`Failed to add widget elements: ${error.message}`, 'error');
    }
  }
  
  // Initialize when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWidget);
  } else {
    initializeWidget();
  }
  
  // Expose API for manual testing
  window.socialWidget = {
    addComment,
    loadComments,
    renderComments
  };
  
  console.log('Social widget script loaded');
})();