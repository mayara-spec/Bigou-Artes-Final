// Netlify Serverless Function: logo-proxy
// Mirrors the Vite dev plugin /logo-proxy so production behaves identically.
// Netlify redirects /logo-proxy?url=... → /.netlify/functions/logo-proxy?url=...

export default async (request) => {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");

    // ── Validate input ──────────────────────────────────────────────────────────
    if (!targetUrl) {
        return new Response("Missing ?url= parameter", { status: 400 });
    }

    if (!targetUrl.startsWith("http")) {
        return new Response("Invalid URL: must start with http", { status: 400 });
    }

    try {
        // ── Fetch upstream (follows redirects automatically) ─────────────────────
        const upstream = await fetch(targetUrl, {
            method: "GET",
            redirect: "follow",
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept:
                    "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
                "Cache-Control": "no-cache",
            },
        });

        if (!upstream.ok) {
            return new Response(`Upstream error: ${upstream.status}`, {
                status: upstream.status,
            });
        }

        const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
        const body = await upstream.arrayBuffer();
        const size = body.byteLength;

        // ── Validate: must be an image with real content ────────────────────────
        const isImage =
            contentType.startsWith("image/") ||
            (contentType === "application/octet-stream" && size > 512);

        if (!isImage || size < 200) {
            return new Response(
                JSON.stringify({
                    error: "NOT_IMAGE",
                    rawUrl: targetUrl,
                    finalUrl: upstream.url,
                    contentType,
                    size,
                }),
                {
                    status: 422,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        // ── Success: return the image ───────────────────────────────────────────
        return new Response(body, {
            status: 200,
            headers: {
                "Content-Type":
                    contentType === "application/octet-stream"
                        ? "image/png"
                        : contentType,
                "Content-Length": String(size),
                "Cache-Control": "public, max-age=86400",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Expose-Headers": "Content-Type, Content-Length",
            },
        });
    } catch (err) {
        return new Response(`Proxy fetch failed: ${err.message}`, { status: 502 });
    }
};
