#!/bin/sh
# Run the UI Performance Bot (Main class).
# Requires: Java 8+, Maven 3.x. Optional: Node.js + npx for Lighthouse (when UserExperience=true).

set -e
cd "$(dirname "$0")"

if ! command -v mvn >/dev/null 2>&1; then
  echo "Maven (mvn) is not installed or not in PATH."
  echo "Install it (e.g. brew install maven) or run from your IDE."
  exit 1
fi

echo "Compiling and running UI Performance Bot..."
mvn -q test-compile exec:java -Dexec.mainClass="PlaywrightUIPageload.Main"
