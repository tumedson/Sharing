#!/usr/bin/env bash
# ============================================================
# Moments by Edson — VPS setup & deploy script
# Runs ON the server as root (Ubuntu/Debian)
# ============================================================
set -e

REPO="https://github.com/tumedson/Sharing.git"
APP_DIR="/var/www/sharing"
APP_PORT=3000

echo ""
echo "==> Updating package lists..."
apt-get update -q

# ── Node.js 20 ──────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "==> Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "==> Node.js already installed: $(node -v)"
fi

# ── PM2 ─────────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  echo "==> Installing PM2..."
  npm install -g pm2
else
  echo "==> PM2 already installed: $(pm2 -v)"
fi

# ── Nginx ────────────────────────────────────────────────────
if ! command -v nginx &>/dev/null; then
  echo "==> Installing nginx..."
  apt-get install -y nginx
fi

# ── Clone / update repo ──────────────────────────────────────
if [ -d "$APP_DIR/.git" ]; then
  echo "==> Pulling latest code..."
  cd "$APP_DIR"
  git pull origin main
else
  echo "==> Cloning repo..."
  mkdir -p "$APP_DIR"
  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
fi

# ── Install dependencies ─────────────────────────────────────
echo "==> Installing npm dependencies..."
cd "$APP_DIR"
npm install --omit=dev

# ── Create .env if it doesn't exist ─────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
  echo "==> Creating blank .env — fill in your credentials!"
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
fi

# ── nginx config ─────────────────────────────────────────────
echo "==> Configuring nginx..."
cat > /etc/nginx/sites-available/sharing <<NGINX
server {
    listen 80;
    server_name _;

    client_max_body_size 500M;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/sharing /etc/nginx/sites-enabled/sharing
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── Start / restart app with PM2 ─────────────────────────────
echo "==> Starting app with PM2..."
cd "$APP_DIR"
pm2 describe sharing &>/dev/null && pm2 restart sharing || pm2 start server.js --name sharing --env production
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

echo ""
echo "============================================================"
echo " Done! App is running on port ${APP_PORT}"
echo " Served via nginx at http://82.25.109.82"
echo ""
echo " NEXT: Edit /var/www/sharing/.env with your credentials:"
echo "   nano /var/www/sharing/.env"
echo " Then restart: pm2 restart sharing"
echo "============================================================"
