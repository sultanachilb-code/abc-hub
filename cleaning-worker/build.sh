#!/bin/sh
# Copies the hub icons into the cleaning app (run from the repo root; the GitHub Action does it on every deploy)
set -e
mkdir -p cleaning-worker/public/icons
cp icons/abc-48.png icons/abc-180.png icons/abc-192.png icons/abc-512.png cleaning-worker/public/icons/
