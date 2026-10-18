#!/bin/bash
set -e

echo "=== 1. Building React Frontend ==="
cd /home/deploy/crowd-control/frontend
npm install
npm run build
chown -R deploy:deploy /home/deploy/crowd-control

echo "=== 2. Configuring Nginx for survivalofthe.fit ==="
cat << 'EOF' > /etc/nginx/sites-available/survivalofthe.fit
server {
    server_name survivalofthe.fit www.survivalofthe.fit;
    root /home/deploy/crowd-control/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

ln -sf /etc/nginx/sites-available/survivalofthe.fit /etc/nginx/sites-enabled/

echo "=== 3. Obtaining SSL Certificate ==="
certbot --nginx -d survivalofthe.fit -d www.survivalofthe.fit --non-interactive --agree-tos -m admin@survivalofthe.fit

echo "=== 4. Reloading Nginx ==="
nginx -t && systemctl reload nginx

echo "=== Deployment Complete! https://survivalofthe.fit is live! ==="
