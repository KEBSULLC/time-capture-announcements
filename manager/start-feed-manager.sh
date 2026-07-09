#!/usr/bin/env bash
# Launcher for the Announcement Feed Manager (macOS / Linux).
# First run installs dependencies; subsequent runs just start the tool and
# open it in your browser. Ctrl-C (or close the terminal) to stop.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found."
  echo "Install the LTS version from https://nodejs.org/ then run this again."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing dependencies. This can take a minute..."
  npm install
fi

echo "Starting the Feed Manager - a browser tab will open at http://localhost:4318"
echo "Press Ctrl-C to stop."
npm run dev
