---
name: pm2-with-nginx
reference: deploy-to-node
level: intermediate
description: 'Deploy a FrontMCP server on bare metal using PM2 for process management and NGINX for TLS termination.'
tags: [deployment, nx, node, pm2, nginx]
features:
  - 'Using PM2 with `-i max` for multi-core clustering and automatic restarts'
  - 'Configuring NGINX as a reverse proxy for TLS termination in front of the FrontMCP server'
  - 'Setting environment variables via `.env` for production configuration'
---

# PM2 Process Manager with NGINX Reverse Proxy

Deploy a FrontMCP server on bare metal using PM2 for process management and NGINX for TLS termination.

## Code

```bash
# Build the server
frontmcp build --target node

# Install PM2 globally
npm install -g pm2

# Start with cluster mode (one instance per CPU core)
pm2 start dist/main.js --name frontmcp-server -i max

# Save the process list for auto-restart on reboot
pm2 save
pm2 startup
```

```nginx
# /etc/nginx/sites-available/mcp.example.com
server {
    listen 443 ssl;
    server_name mcp.example.com;

    ssl_certificate     /etc/ssl/certs/mcp.example.com.pem;
    ssl_certificate_key /etc/ssl/private/mcp.example.com.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# .env
PORT=3000
NODE_ENV=production
HOST=0.0.0.0
REDIS_URL=redis://localhost:6379
LOG_LEVEL=info
```

```bash
# Enable the NGINX site and reload
sudo ln -s /etc/nginx/sites-available/mcp.example.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Verify
curl https://mcp.example.com/health
```

## What This Demonstrates

- Using PM2 with `-i max` for multi-core clustering and automatic restarts
- Configuring NGINX as a reverse proxy for TLS termination in front of the FrontMCP server
- Setting environment variables via `.env` for production configuration

## Related

- See `deploy-to-node` for Docker Compose deployment, resource limits, and the full environment variable reference
