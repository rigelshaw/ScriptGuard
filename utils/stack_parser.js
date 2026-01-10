// Stack trace parsing utility
function SG_parseStack(stack) {
  if (!stack || typeof stack !== 'string') return null;
  
  const lines = stack.split('\n');
  for (let i = 1; i < lines.length; i++) { // Skip first line (error message)
    const line = lines[i].trim();
    
    // Match URLs
    const urlMatch = line.match(/(https?|file|chrome-extension):\/\/[^\s)'"]+/);
    if (urlMatch) {
      return urlMatch[0];
    }
    
    // Match eval or anonymous contexts
    if (line.includes('eval at') || line.includes('<anonymous>')) {
      // Try to extract URL from previous line
      if (i > 1) {
        const prevUrl = lines[i-1].match(/(https?|file):\/\/[^\s)'"]+/);
        if (prevUrl) return prevUrl[0];
      }
    }
  }
  
  return null;
}