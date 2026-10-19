#!/usr/bin/env bash
# Pull the latest PeerWords and publish it to /var/www/games/words.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
mkdir -p /var/www/games/words
rsync -a --delete --exclude '.git' --exclude '.gitignore' --exclude 'deploy' --exclude 'README.md' \
  --exclude 'tests' --exclude 'package.json' --exclude 'package-lock.json' --exclude 'node_modules' \
  ./ /var/www/games/words/
echo "PeerWords deployed: $(git rev-parse --short HEAD)"
