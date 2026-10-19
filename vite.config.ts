import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import https from 'node:https';

function mcpProxyPlugin(): Plugin {
  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.end();
        return;
      }

      const reqUrl = new URL(req.url || '/', 'http://localhost');
      let targetUrlStr = reqUrl.searchParams.get('url') || reqUrl.searchParams.get('target');

      if (!targetUrlStr) {
        const rawUrl = req.url || '';
        const match = rawUrl.match(/[?&](?:url|target)=([^&]+.*)$/);
        if (match) {
          targetUrlStr = decodeURIComponent(match[1]);
        }
      }

      if (!targetUrlStr) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing target URL parameter (?url=...)' }));
        return;
      }

      const initialTargetUrl = new URL(targetUrlStr);

      const handleProxyRequest = (
        targetUrl: URL,
        maxRedirects = 5
      ) => {
        if (maxRedirects <= 0) {
          if (!res.headersSent) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Too many redirects in proxy' }));
          }
          return;
        }

        const isHttps = targetUrl.protocol === 'https:';
        const requestModule = isHttps ? https : http;
        const isGetOrHead = req.method === 'GET' || req.method === 'HEAD';

        // Filter out hop-by-hop, browser specific, and signed-URL conflicting headers
        const forwardHeaders: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          const lower = k.toLowerCase();
          if (
            lower === 'host' ||
            lower === 'origin' ||
            lower === 'referer' ||
            lower === 'connection' ||
            lower === 'cookie' ||
            lower.startsWith('sec-') ||
            (isGetOrHead && lower === 'content-length')
          ) {
            continue;
          }
          if (v !== undefined) {
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
            const statusCode = proxyRes.statusCode || 200;

            // Follow redirect automatically (301, 302, 303, 307, 308)
            if (
              [301, 302, 303, 307, 308].includes(statusCode) &&
              proxyRes.headers.location
            ) {
              const nextUrl = new URL(proxyRes.headers.location, targetUrl);
              proxyRes.resume(); // drain response
              handleProxyRequest(nextUrl, maxRedirects - 1);
              return;
            }

            res.statusCode = statusCode;
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

        if (isGetOrHead) {
          proxyReq.end();
        } else {
          req.pipe(proxyReq);
        }
      };

      handleProxyRequest(initialTargetUrl);
    } catch (err: any) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: `Internal proxy error: ${err.message}` }));
      }
    }
  };

  return {
    name: 'mcp-proxy-plugin',
    configureServer(server) {
      server.middlewares.use('/api/mcp-proxy', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/mcp-proxy', handler);
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
