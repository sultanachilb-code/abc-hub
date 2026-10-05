#!/bin/sh
# Copies the scanner from the hub into the Loading Gate app (run from the repo root; the GitHub Action does it on every deploy)
set -e
mkdir -p gate-worker/public/icons
cp tools/gate.html gate-worker/public/index.html
cp tools/tools.css tools/jsqr.min.js gate-worker/public/
cp icons/abc-48.png icons/abc-180.png icons/abc-192.png icons/abc-512.png gate-worker/public/icons/
