import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import https from 'node:https';

function mcpProxyPlugin(): Plugin {
  return {
    name: 'mcp-proxy-plugin',
    configureServer(server) {
      server.middlewares.use('/api/mcp-proxy', async (req, res) => {
        try {
          const reqUrl = new URL(req.url || '/', 'http://localhost');
          const targetUrlStr = reqUrl.searchParams.get('url') || reqUrl.searchParams.get('target');

          if (!targetUrlStr) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing target URL parameter (?url=...)' }));
            return;
          }

          const targetUrl = new URL(targetUrlStr);
          const isHttps = targetUrl.protocol === 'https:';
          const requestModule = isHttps ? https : http;

          // Clone headers and remove host/origin to avoid rejection by upstream
          const forwardHeaders: Record<string, string | string[]> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            const lower = k.toLowerCase();
            if (lower !== 'host' && lower !== 'origin' && lower !== 'referer' && v !== undefined) {
              forwardHeaders[k] = v;
            }
          }
          forwardHeaders['host'] = targetUrl.host;

          const proxyReq = requestModule.request(
            targetUrl,
            {
              method: req.method,
              headers: forwardHeaders,
            },
            (proxyRes) => {
              res.statusCode = proxyRes.statusCode || 200;
              for (const [k, v] of Object.entries(proxyRes.headers)) {
                if (v !== undefined) {
                  res.setHeader(k, v);
                }
              }
              // Ensure CORS headers for browser
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
              res.setHeader('Access-Control-Allow-Headers', '*');
              res.setHeader('Access-Control-Expose-Headers', '*');
              proxyRes.pipe(res);
            }
          );

          proxyReq.on('error', (err) => {
            if (!res.headersSent) {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: `Proxy connection error: ${err.message}` }));
            }
          });

          // Pipe incoming request body to target
          req.pipe(proxyReq);
        } catch (err: any) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Internal proxy error: ${err.message}` }));
          }
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mcpProxyPlugin()],
  server: {
    port: 5173,
    open: false,
  },
});
