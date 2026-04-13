/**
 * Local CORS proxy for TestLens: fetches any http(s) OpenAPI URL server-side
 * and returns the body with Access-Control-Allow-Origin: *.
 *
 * Usage:
 *   npm run openapi-proxy
 * In the app, set "CORS proxy" to http://localhost:8787 (same host name as the page).
 *
 * Contract: GET /<path>?url=<encoded-target-url>
 */
import http from "http";
import { URL } from "url";

const PORT = Number(process.env.PORT) || 8787;

function isAllowedTarget(t) {
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
  for (const [k, v] of Object.entries(cors)) {
    res.setHeader(k, v);
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(405);
    res.end(JSON.stringify({ error: "Only GET is supported" }));
    return;
  }

  let target;
  try {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    target = u.searchParams.get("url");
  } catch {
    target = null;
  }

  if (!target || !isAllowedTarget(target)) {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(400);
    res.end(
      JSON.stringify({
        error:
          "Missing or invalid url= query parameter (http and https URLs only).",
      })
    );
    return;
  }

  try {
    const r = await fetch(target, {
      redirect: "follow",
      headers: { Accept: "application/json, */*" },
    });
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "application/octet-stream";
    res.writeHead(r.status, { "Content-Type": ct });
    res.end(buf);
  } catch (e) {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(502);
    res.end(JSON.stringify({ error: String(e && e.message ? e.message : e) }));
  }
});

server.listen(PORT, () => {
  console.log(
    `TestLens OpenAPI CORS proxy listening on http://localhost:${PORT}/`
  );
  console.log(
    `Use in the app (CORS proxy field): http://localhost:${PORT}  — must match how you open the app (localhost vs 127.0.0.1).`
  );
});
