#!/usr/bin/env bash
# ==============================================================================
# Trade Journal Linux / macOS Launcher
# Usage: ./journal.sh [command]
# ==============================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if ! command -v node >/dev/null 2>&1; then
    echo "❌ Node.js belum terinstall. Silakan install Node.js 22+ terlebih dahulu."
    exit 1
fi

node journal.js "$@"
