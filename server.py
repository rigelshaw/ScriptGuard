#!/usr/bin/env python3
"""
ScriptGuard Demo Server
Serves demo files and provides endpoints for analytics/miner simulation
"""
import http.server
import socketserver
import json
import time
from urllib.parse import urlparse, parse_qs
from datetime import datetime

PORT = 8000

class DemoHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Parse URL
        parsed = urlparse(self.path)
        path = parsed.path
        
        # Handle API endpoints
        if path == '/fake/track':
            self.handle_track(parsed)
        elif path == '/fake/miner_payload':
            self.handle_miner_payload()
        else:
            # Serve static files from current directory
            super().do_GET()
    
    def handle_track(self, parsed):
        """Handle analytics tracking endpoint"""
        query = parse_qs(parsed.query)
        ts = query.get('ts', [int(time.time() * 1000)])[0]
        
        response = {
            'status': 'ok',
            'ts': ts,
            'received_at': datetime.now().isoformat(),
            'message': 'Tracked by ScriptGuard demo server'
        }
        
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())
        
        print(f"[TRACK] {datetime.now().isoformat()} - Analytics ping received")
    
    def handle_miner_payload(self):
        """Handle miner payload endpoint"""
        # Return a deterministic payload
        payload = "miner-payload-" + "x" * 100  # 100 characters
        
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(payload.encode())
        
        print(f"[MINER] {datetime.now().isoformat()} - Miner payload sent")
    
    def end_headers(self):
        """Add CORS headers to all responses"""
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()
    
    def log_message(self, format, *args):
        """Custom log format"""
        print(f"[SERVER] {datetime.now().isoformat()} - {format % args}")

def main():
    print(f"Starting ScriptGuard demo server on http://localhost:{PORT}")
    print(f"Serving files from: {__file__}")
    print("Available endpoints:")
    print("  GET /fake/track          - Returns JSON confirmation")
    print("  GET /fake/miner_payload  - Returns miner payload")
    print("")
    print("Open http://localhost:8000/news_demo.html to test the extension")
    print("Press Ctrl+C to stop the server")
    
    with socketserver.TCPServer(("", PORT), DemoHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

if __name__ == "__main__":
    main()