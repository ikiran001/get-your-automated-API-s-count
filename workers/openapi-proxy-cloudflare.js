/**
 * Cloudflare Worker — optional first-party CORS proxy for TestLens.
 * Deploy with: wrangler deploy (or paste in Workers dashboard).
 *
 * Request:  GET https://your-worker.workers.dev/?url=<encoded-openapi-url>
 * Response: Pass-through body and status from the target URL + CORS headers.
 *
 * Warning: A public open proxy can be abused. Restrict with a secret header,
 * IP allowlist, or deploy only for private use. This template is minimal.
 */
export default {
  async fetch(request) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "Only GET supported" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(request.url);
    const target = url.searchParams.get("url");
    if (!target) {
      return new Response(JSON.stringify({ error: "Missing url= parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
      if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
        throw new Error("invalid protocol");
      }
    } catch {
      return new Response(JSON.stringify({ error: "Invalid url=" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const r = await fetch(targetUrl.toString(), {
        redirect: "follow",
        headers: { Accept: "application/json, */*" },
      });
      const body = await r.arrayBuffer();
      const ct = r.headers.get("content-type") || "application/octet-stream";
      return new Response(body, {
        status: r.status,
        headers: { ...corsHeaders, "Content-Type": ct },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: String(e && e.message ? e.message : e) }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  },
};
