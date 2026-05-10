#!/usr/bin/env bash
# ============================================================
# Moments by Edson — deploy latest code to VPS
# Run locally: ./scripts/deploy.sh
# ============================================================
set -e

VPS="root@82.25.109.82"
APP_DIR="/var/www/sharing"
SSH_KEY="$HOME/.ssh/id_ed25519_hostinger"

echo "==> Pushing latest code to GitHub..."
git push origin main

echo "==> Deploying to VPS..."
ssh -i "$SSH_KEY" "$VPS" "
  cd $APP_DIR &&
  git pull origin main &&
  npm install --omit=dev &&
  pm2 restart sharing --update-env &&
  echo 'Deploy complete!'
"

echo ""
echo "Live at http://82.25.109.82"
