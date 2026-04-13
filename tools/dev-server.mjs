/**
 * Serves docs/ on PORT (default 8080) and exposes a same-origin OpenAPI fetcher
 * so the browser does not need cross-origin access to the spec URL.
 *
 *   npm run dev
 *   open http://localhost:8080/
 *
 * The app auto-tries GET /__testlens_openapi_proxy?url=... when you run from this server.
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, "..", "docs");
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function isAllowedTarget(t) {
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveStaticPath(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0]);
  if (p === "/" || p === "") p = "/index.html";
  const rel = path.normalize(p).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = path.join(DOCS_ROOT, rel);
  if (!full.startsWith(DOCS_ROOT)) return null;
  return full;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (u.pathname === "/__testlens_openapi_proxy") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    const target = u.searchParams.get("url");
    if (!target || !isAllowedTarget(target)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Missing or invalid url= (http/https only).",
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
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: String(e && e.message ? e.message : e) })
      );
    }
    return;
  }

  const filePath = resolveStaticPath(u.pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const ct = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": ct });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`TestLens dev server → http://localhost:${PORT}/`);
  console.log(
    `OpenAPI proxy (same-origin): http://localhost:${PORT}/__testlens_openapi_proxy?url=...`
  );
});
