#!/bin/bash
# Start local HTTP server for Question Webapp
# Usage: ./start-server.sh [port]

PORT=${1:-8080}

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║       Question Webapp Server         ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  Starting server on port $PORT..."
echo ""
echo "  Open in browser:"
echo "  → http://localhost:$PORT"
echo ""
echo "  Press Ctrl+C to stop the server"
echo ""

# Change to app directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/app" || exit 1

# Try Python 3 first, then Python
if command -v python3 &> /dev/null; then
    python3 -m http.server "$PORT"
elif command -v python &> /dev/null; then
    python -m http.server "$PORT"
else
    echo "  ERROR: Python is not installed or not in PATH"
    echo "  Please install Python from https://python.org"
    exit 1
fi
