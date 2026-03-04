import { defineConfig } from 'vite'

// Custom Vite plugin: /logo-proxy?url=<encoded_url>
// Fetches the image server-side, bypassing CORS and following redirects.
function logoProxyPlugin() {
    return {
        name: 'logo-proxy',
        configureServer(server) {
            server.middlewares.use('/logo-proxy', async (req, res) => {
                try {
                    const urlParam = new URL(req.url, 'http://localhost').searchParams.get('url');
                    if (!urlParam) {
                        res.writeHead(400, { 'Content-Type': 'text/plain' });
                        res.end('Missing ?url= parameter');
                        return;
                    }

                    const targetUrl = decodeURIComponent(urlParam);
                    if (!targetUrl.startsWith('http')) {
                        res.writeHead(400, { 'Content-Type': 'text/plain' });
                        res.end('Invalid URL: must start with http');
                        return;
                    }

                    const r = await fetch(targetUrl, {
                        method: 'GET',
                        redirect: 'follow',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                            'Cache-Control': 'no-cache',
                        },
                    });

                    const contentType = (r.headers.get('content-type') || '').toLowerCase();
                    const ab = await r.arrayBuffer();
                    const nodeBuffer = Buffer.from(ab);
                    const size = nodeBuffer.length;

                    if (!r.ok) {
                        console.warn(`[logo-proxy] Upstream error: ${r.status} for ${targetUrl}`);
                        res.writeHead(r.status, { 'Content-Type': 'text/plain' });
                        res.end(`Upstream error: ${r.status}`);
                        return;
                    }

                    // Validation Rules:
                    // 1. Must be an image OR if octet-stream, must have enough bytes to be an image
                    const isImage = contentType.startsWith('image/') || (contentType === 'application/octet-stream' && size > 512);

                    if (!isImage || size < 200) {
                        let snippet = "";
                        if (contentType.includes("text") || contentType.includes("html") || contentType === "") {
                            try { snippet = nodeBuffer.toString("utf8").slice(0, 120); } catch { }
                        }

                        console.warn("[logo-proxy] NOT_IMAGE", {
                            rawUrl: targetUrl,
                            finalUrl: r.url,
                            status: r.status,
                            contentType,
                            size,
                            snippet,
                        });

                        res.writeHead(422, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            error: "NOT_IMAGE",
                            rawUrl: targetUrl,
                            finalUrl: r.url,
                            contentType,
                            size,
                        }));
                        return;
                    }

                    // Success!
                    res.writeHead(200, {
                        'Content-Type': contentType === 'application/octet-stream' ? 'image/png' : contentType,
                        'Content-Length': size,
                        'Cache-Control': 'public, max-age=86400',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Expose-Headers': 'Content-Type, Content-Length',
                        'ETag': r.headers.get('etag') || '',
                        'Last-Modified': r.headers.get('last-modified') || '',
                    });

                    res.end(nodeBuffer);

                } catch (err) {
                    console.error('[logo-proxy] FAIL', { rawUrl: req.url, err: String(err) });
                    if (!res.headersSent) {
                        res.writeHead(502, { 'Content-Type': 'text/plain' });
                    }
                    res.end(`Proxy fetch failed: ${err.message}`);
                }
            });
        }
    };
}

export default defineConfig({
    base: '/',
    plugins: [logoProxyPlugin()],
})
