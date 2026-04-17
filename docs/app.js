/**
 * TestLens — runs in the browser. It compares two JSON files.
 *
 * Plain English:
 * - File 1 is your API description (OpenAPI / Swagger). It lists paths like "GET /users".
 * - File 2 is your Postman collection. It lists the requests you automated.
 * - We check: for each path in the API file, is there a Postman request with the same method and path?
 * - Then we show numbers (how many match, how many are missing) and three lists you can read or copy.
 *
 * If you use a URL for the API file and the browser cannot load it (CORS), we try a few public relay sites.
 * For private or internal APIs, downloading the JSON and using "Upload" is safer and more reliable.
 *
 * The math here is meant to match api_coverage.py in this project.
 * Paths are auto-normalized (decode, strip leading {{env}}, collapse slashes, trim trailing /)
 * then matched by structure: literals must match; {any} matches any param name in that slot.
 */

const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
]);

/** Same keys as api_coverage.py PATH_PARAM_ALIASES — extend either side for parity. */
const PATH_PARAM_ALIASES = Object.freeze({
  brand_type: "api_brand",
  hosting_account_id: "hosting_id",
  account_id: "account_id",
});

function pathWithoutQueryOrFragment(s) {
  if (!s) return "";
  return String(s).split("#")[0].split("?")[0];
}

/** True if `//` + this authority is a real network host (not a path like `//cpanel/v1`). */
function looksLikeNetworkAuthority(authority) {
  if (!authority) return false;
  const hostPart = authority.split(":")[0];
  if (/^localhost$/i.test(hostPart)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostPart)) return true;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(hostPart);
}

function extractPathOnly(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^[a-z][a-z+.-]*:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      return pathWithoutQueryOrFragment(u.pathname || "/");
    } catch {
      return "";
    }
  }
  // `//cpanel/v1` is almost always a doubled slash path, not host "cpanel".
  if (s.startsWith("//")) {
    const authority = s.slice(2).split("/")[0];
    if (looksLikeNetworkAuthority(authority)) {
      try {
        const u = new URL("https:" + s);
        return pathWithoutQueryOrFragment(u.pathname || "/");
      } catch {
        /* fall through */
      }
    }
    return pathWithoutQueryOrFragment(s.replace(/^\/+/, "/"));
  }
  return pathWithoutQueryOrFragment(s);
}

function applyPathParamAliases(path, aliases) {
  return path.replace(/\{([^}]*)\}/g, (m, name) => {
    const n = String(name || "").trim();
    if (!n) return m;
    const canon = Object.prototype.hasOwnProperty.call(aliases, n) ? aliases[n] : n;
    return `{${canon}}`;
  });
}

/**
 * Canonical path for OpenAPI keys and Postman paths (kept in sync with api_coverage.normalize_path).
 * @param {string} path
 * @param {Record<string, string>} [paramAliases] optional overrides merged into PATH_PARAM_ALIASES
 */
function normalizePath(path, paramAliases) {
  if (path == null) return "";
  const merged = { ...PATH_PARAM_ALIASES, ...(paramAliases || {}) };
  let p;
  try {
    p = extractPathOnly(path);
  } catch {
    return "";
  }
  if (!p) return "";
  p = p.replace(/\\/g, "/");
  p = safeDecodeURIPath(p);
  p = stripPostmanLeadingBaseNoise(p);
  p = p.replace(/\{\{([^}]+)\}\}/g, "{$1}");
  p = applyPathParamAliases(p, merged);
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  const head = p.split("?", 1)[0];
  if (!/^[a-z][a-z+.-]*:\/\//i.test(p) && p && !p.startsWith("/") && !head.includes("://")) {
    p = "/" + p;
  }
  return p;
}

/** Decode pathname when URL() percent-encodes `{{var}}` etc. */
function safeDecodeURIPath(pathname) {
  if (!pathname || !pathname.includes("%")) return pathname || "";
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/**
 * Postman "raw" URLs often prefix the path with env vars: `{{HOST}} addon_add/...`,
 * `{{HOST}}addon_add/...`, or other names like `{{BASE_URL}}/v1/...`. If those stay in
 * the string, URL() encodes them into the first path segment and coverage becomes 0.
 * Strip any leading `{{...}}` (optional leading /) when followed by space, `/`, or
 * glued to the next path segment — same rules for HOST, HAL_HOST, and generic vars.
 */
function stripPostmanLeadingBaseNoise(s) {
  let t = String(s || "").trim();
  if (!t) return t;
  const optSlash = "\\/?";
  const seg = String.raw`\{\{[^}]+\}\}`;
  let prev;
  do {
    prev = t;
    t = t.replace(new RegExp(`^${optSlash}${seg}\\s+`, "g"), "");
  } while (t !== prev);
  let prev2;
  do {
    prev2 = t;
    t = t
      .replace(new RegExp(`^${optSlash}${seg}(?=/)`, "g"), "")
      .replace(new RegExp(`^${optSlash}${seg}(?=[^/\\s?#])`, "g"), "");
  } while (t !== prev2);
  if (!/^[a-z][a-z+.-]*:\/\//i.test(t) && t && !t.startsWith("/") && !t.includes("://")) {
    t = "/" + t;
  }
  return t;
}

/** True if URL looks like a JSON/YAML OpenAPI endpoint. */
function openApiUrlLooksLikeJson(urlTrim) {
  if (!urlTrim) return false;
  try {
    const u = new URL(urlTrim);
    const path = u.pathname.toLowerCase();
    if (path.endsWith(".json") || path.endsWith(".yaml") || path.endsWith(".yml")) return true;
    const fmt = u.searchParams.get("format");
    if (fmt && String(fmt).toLowerCase() === "json") return true;
    return false;
  } catch {
    return false;
  }
}

/** Postman v2.1 path[] entries can be strings or { type, value } objects. */
function postmanPathSegmentToString(seg) {
  if (typeof seg === "string") return seg;
  if (seg && typeof seg === "object" && typeof seg.value === "string") return seg.value;
  if (seg == null || seg === "") return "";
  return String(seg);
}

function parseRequestUrl(request, host, halHost) {
  const urlField = request.url;
  let rawUrl = "";
  let urlObj = null;

  if (typeof urlField === "string") {
    rawUrl = urlField;
  } else if (urlField && typeof urlField === "object") {
    urlObj = urlField;
    rawUrl = urlField.raw || "";
  }

  // Postman stores both `raw` and split `host`/`path`. `path` alone often drops
  // leading segments (e.g. `v1` lives under `host` as ["{{HOST}}","v1"]).
  // Prefer non-empty `raw` — it matches what Postman shows and yields the full pathname.
  if (String(rawUrl || "").trim()) {
    let safe = String(rawUrl).trim();
    safe = stripPostmanLeadingBaseNoise(safe);
    if (host) safe = safe.replace(/\{\{HOST\}\}/gi, host);
    if (halHost) safe = safe.replace(/\{\{HAL_HOST\}\}/gi, halHost);
    try {
      const base = "http://__postman_placeholder__";
      const u = new URL(safe, base);
      const pn = safeDecodeURIPath(u.pathname || "");
      if (pn) return pn;
    } catch {
      /* fall through to path string / array */
    }
  }

  if (urlObj && typeof urlObj.path === "string" && urlObj.path.trim()) {
    let p = stripPostmanLeadingBaseNoise(urlObj.path.trim().replace(/\\/g, "/"));
    if (!p.startsWith("/")) p = "/" + p;
    return p;
  }

  if (urlObj && Array.isArray(urlObj.path) && urlObj.path.length) {
    const segments = urlObj.path
      .map(postmanPathSegmentToString)
      .map((s) => String(s || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
      .filter((s) => s !== "");
    let i = 0;
    while (i < segments.length) {
      const a = segments[i];
      if (/^\{\{HOST\}\}$/i.test(a) || /^\{\{HAL_HOST\}\}$/i.test(a)) {
        i += 1;
        continue;
      }
      if (/^\{\{[^}]+\}\}$/.test(a)) {
        i += 1;
        continue;
      }
      break;
    }
    const rest = segments.slice(i);
    let joined = "/" + rest.join("/");
    joined = stripPostmanLeadingBaseNoise(joined);
    if (!joined.startsWith("/")) joined = "/" + joined;
    return joined;
  }

  return "";
}

function extractSwaggerPaths(swaggerJson, excludeDeprecated) {
  const paths = swaggerJson.paths || {};
  const out = [];
  for (const [path, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== "object") continue;
    for (const method of Object.keys(methods)) {
      const upper = method.toUpperCase();
      if (!HTTP_METHODS.has(upper)) continue;
      const op = methods[method] || {};
      if (excludeDeprecated && op.deprecated === true) continue;
      out.push([upper, path]);
    }
  }
  return out;
}

function extractPostmanRequests(collection, host, halHost) {
  const endpoints = [];
  let totalRequests = 0;

  function walkItems(items, folderPath) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item.request) {
        totalRequests += 1;
        const method = (item.request.method || "").toUpperCase();
        const path = normalizePath(
          parseRequestUrl(item.request, host, halHost)
        );
        if (method && path) endpoints.push([method, path, folderPath || ""]);
      }
      if (item.item) {
        const childFolder = folderPath
          ? folderPath + " › " + (item.name || "")
          : (item.name || "");
        walkItems(item.item, childFolder);
      }
    }
  }

  if (collection.item) walkItems(collection.item, "");
  return { endpoints, totalRequests };
}

/* ── Postman v1 ────────────────────────────────────────────────────────── */

function extractPostmanV1Requests(collection) {
  const endpoints = [];
  let totalRequests = 0;

  // Build request-id → folder name map
  const folderMap = {};
  if (Array.isArray(collection.folders)) {
    for (const folder of collection.folders) {
      const fname = folder.name || "";
      if (Array.isArray(folder.order)) {
        for (const rid of folder.order) folderMap[rid] = fname;
      }
    }
  }

  const requests = Array.isArray(collection.requests) ? collection.requests : [];
  for (const req of requests) {
    totalRequests++;
    const method = (req.method || "").toUpperCase();
    const rawUrl = (req.url || "").replace(/\{\{[^}]+\}\}/g, "placeholder");
    try {
      const u = new URL(rawUrl);
      const path = normalizePath(u.pathname);
      if (method && path && HTTP_METHODS.has(method)) {
        endpoints.push([method, path, folderMap[req.id] || ""]);
      }
    } catch { /* skip invalid URLs */ }
  }
  return { endpoints, totalRequests };
}

/* ── Insomnia v4 ───────────────────────────────────────────────────────── */

function extractInsomniaRequests(parsed) {
  const endpoints = [];
  let totalRequests = 0;
  const resources = parsed.resources || [];

  // Build folder-id → name map
  const folderNames = {};
  for (const r of resources) {
    if (r._type === "request_group") folderNames[r._id] = r.name || "";
  }

  for (const r of resources) {
    if (r._type !== "request") continue;
    totalRequests++;
    const method = (r.method || "").toUpperCase();
    // Replace leading {{var}} (base URL template) with a real scheme+host so
    // the URL parses correctly; replace remaining {{...}} with "placeholder".
    const rawUrl = (r.url || "")
      .replace(/^\{\{[^}]+\}\}/, "https://testlens.invalid")
      .replace(/\{\{[^}]+\}\}/g, "placeholder");
    try {
      const u = new URL(rawUrl);
      const path = normalizePath(u.pathname);
      if (method && path && HTTP_METHODS.has(method)) {
        endpoints.push([method, path, folderNames[r.parentId] || ""]);
      }
    } catch { /* skip unparseable URLs */ }
  }
  return { endpoints, totalRequests };
}

/* ── Bruno (JSON export) ───────────────────────────────────────────────── */

function extractBrunoRequests(parsed) {
  const endpoints = [];
  let totalRequests = 0;

  function walkItems(items, folderPath) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item.type === "http" || item.type === "graphql") {
        totalRequests++;
        const req = item.request || {};
        const method = (req.method || "").toUpperCase();
        const rawUrl = (req.url || "").replace(/\{\{[^}]+\}\}/g, "placeholder");
        try {
          const u = new URL(rawUrl);
          const path = normalizePath(u.pathname);
          if (method && path && HTTP_METHODS.has(method)) {
            endpoints.push([method, path, folderPath || ""]);
          }
        } catch { /* skip */ }
      }
      if (item.type === "folder" && Array.isArray(item.items)) {
        const childFolder = folderPath
          ? folderPath + " › " + (item.name || "")
          : (item.name || "");
        walkItems(item.items, childFolder);
      }
    }
  }

  walkItems(parsed.items, "");
  return { endpoints, totalRequests };
}

/* ── HAR (HTTP Archive) ────────────────────────────────────────────────── */

function extractHARRequests(parsed) {
  const endpoints = [];
  let totalRequests = 0;
  const entries = (parsed.log && parsed.log.entries) || [];

  for (const entry of entries) {
    const req = entry.request;
    if (!req) continue;
    totalRequests++;
    const method = (req.method || "").toUpperCase();
    if (!HTTP_METHODS.has(method)) continue;
    try {
      const u = new URL(req.url || "");
      const path = normalizePath(u.pathname);
      if (path) endpoints.push([method, path, ""]);
    } catch { /* skip */ }
  }
  return { endpoints, totalRequests };
}

/**
 * Auto-detect collection format and extract [method, path, folder] triples.
 * Supports Postman v1 / v2 / v2.1, Insomnia v4, Bruno JSON, HAR.
 */
function detectAndExtractRequests(collection, host, halHost) {
  if (!collection || typeof collection !== "object") {
    throw new Error("Collection is empty or not a valid JSON object.");
  }

  // Postman API / some tools wrap as { collection: { info, item } }
  if (
    !collection.info &&
    collection.collection &&
    typeof collection.collection === "object" &&
    collection.collection.info &&
    Array.isArray(collection.collection.item)
  ) {
    collection = collection.collection;
  }

  // Postman v2 / v2.1  — has info.schema + item array
  if (collection.info && Array.isArray(collection.item)) {
    return extractPostmanRequests(collection, host, halHost);
  }

  // Postman v1 — flat requests array, no info.schema
  if (Array.isArray(collection.requests) && !collection.info) {
    return extractPostmanV1Requests(collection);
  }

  // Insomnia v4 — _type: "export" + resources array
  if (collection._type === "export" && Array.isArray(collection.resources)) {
    return extractInsomniaRequests(collection);
  }

  // Bruno JSON export — version field + items array with type:"http"/"folder"
  if (
    collection.version &&
    Array.isArray(collection.items) &&
    collection.items.some((i) => i.type === "http" || i.type === "folder" || i.type === "graphql")
  ) {
    return extractBrunoRequests(collection);
  }

  // HAR — log.entries
  if (collection.log && Array.isArray(collection.log.entries)) {
    return extractHARRequests(collection);
  }

  throw new Error(
    "Could not detect the collection format. " +
    "Supported: Postman v1, v2, v2.1 · Insomnia v4 (JSON export) · Bruno (JSON export) · HAR (.har). " +
    "Make sure you exported a collection — not an environment, globals, or partial file."
  );
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(
      `Could not read "${file.name}". The file may be empty or locked.`
    ));
    reader.readAsText(file, "UTF-8");
  });
}

/**
 * Read an OpenAPI spec file — JSON or YAML.
 * Requires js-yaml on window for .yaml/.yml files.
 */
async function readSpecFile(file) {
  const text = await readFileAsText(file);
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".yaml") || name.endsWith(".yml")) {
    if (!window.jsyaml) {
      throw new Error(
        "YAML parser (js-yaml) is not loaded. Please hard-refresh the page (Ctrl+Shift+R / Cmd+Shift+R) and try again."
      );
    }
    try {
      return window.jsyaml.load(text);
    } catch (e) {
      throw new Error(`YAML parse error in "${file.name}": ${e.message || e}`);
    }
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      `"${file.name}" is not valid JSON. ` +
      "Make sure you exported the OpenAPI spec correctly (JSON or YAML format)."
    );
  }
}

/**
 * Read a collection file — all supported formats are JSON (Postman, Insomnia, Bruno, HAR).
 */
async function readCollectionFile(file) {
  const text = await readFileAsText(file);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      `"${file.name}" is not valid JSON. ` +
      "Supported formats: Postman v1/v2/v2.1, Insomnia v4 (JSON export), Bruno (JSON export), or HAR (.har). " +
      "Make sure you exported correctly."
    );
  }
}

function isBrowserCorsOrNetworkError(err) {
  if (!err) return false;
  const n = err.name || "";
  if (n === "TypeError" || n === "NetworkError" || n === "SecurityError") return true;
  const m = String(err.message || "");
  return /Failed to fetch|NetworkError|Load failed|network|aborted|CORS|cross-origin|blocked/i.test(
    m
  );
}

/** After direct fetch fails, try first-party / public proxies (not invalid JSON shape errors). */
function shouldRetryOpenApiWithProxies(directErr) {
  if (isBrowserCorsOrNetworkError(directErr)) return true;
  const m = String(directErr && directErr.message ? directErr.message : "");
  return /HTTP \d{3} loading OpenAPI/i.test(m);
}

/**
 * Proxy bases to try: form/saved value first, then default local ports on localhost.
 * Fixes: passing "" from the form used to skip localStorage; users often forget to paste the proxy URL.
 */
function buildOpenApiProxyAttemptsList(options) {
  const explicit =
    options && typeof options.openApiProxyBase === "string"
      ? options.openApiProxyBase.trim()
      : "";
  const stored = getStoredOpenApiProxyBase().trim();
  const seen = new Set();
  const out = [];
  function add(base) {
    const b = base.trim().replace(/\/+$/, "");
    if (!b) return;
    const key = b.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(b);
  }
  if (explicit) add(explicit);
  else if (stored) add(stored);

  let host = "";
  try {
    host = String(window.location.hostname || "");
  } catch {
    host = "";
  }
  if (host === "localhost" || host === "127.0.0.1") {
    add("http://localhost:8787");
    add("http://127.0.0.1:8787");
  }
  return out;
}

/** User-visible message when URL load fails (never leave bare “Failed to fetch”). */
function formatOpenApiLoadError(err) {
  const m = String(err && err.message ? err.message : err || "");
  const n = err && err.name ? String(err.name) : "";
  if (
    /failed to fetch/i.test(m) ||
    /networkerror/i.test(n) ||
    /load failed/i.test(m)
  ) {
    return (
      "Could not load the OpenAPI URL from this page (browser blocked cross-origin access, a relay failed, or an extension blocked the request). " +
      "Reliable fix: open your spec link in a new tab, wait for the JSON to appear, then Save As (Cmd+S / Ctrl+S) and upload that file in “Upload OpenAPI JSON” (recommended over URL). " +
      "Or run npm run dev locally. Hard-refresh this page and try turning off ad blockers."
    );
  }
  return m || "Could not load OpenAPI.";
}

const FETCH_DIRECT_INIT = { mode: "cors", credentials: "omit" };
const FETCH_PROXY_INIT = {
  mode: "cors",
  credentials: "omit",
  referrerPolicy: "no-referrer",
};

/** Reject proxy “success” bodies like corsproxy.io `{"error":"Free usage…"}`. */
function jsonLooksLikeOpenApiDoc(parsed) {
  return (
    parsed &&
    typeof parsed === "object" &&
    (typeof parsed.paths === "object" ||
      typeof parsed.openapi === "string" ||
      typeof parsed.swagger === "string")
  );
}

const OPENAPI_PROXY_STORAGE_KEY = "testlens-openapi-proxy-base";

function getStoredOpenApiProxyBase() {
  try {
    return (localStorage.getItem(OPENAPI_PROXY_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

/** @returns {string} full proxy URL including ?url= or &url= */
function buildOpenApiProxyFetchUrl(proxyBase, targetUrl) {
  const b = proxyBase.trim().replace(/\/+$/, "");
  if (!b) return "";
  const sep = b.includes("?") ? "&" : "?";
  return b + sep + "url=" + encodeURIComponent(targetUrl);
}

/**
 * First-party proxy (local Node script or your Worker). Same contract: ?url=encoded spec URL.
 * @returns {Promise<object>}
 */
/**
 * Same-origin proxy from `npm run dev` (tools/dev-server.mjs).
 * Avoids CORS entirely: the page and proxy share one origin.
 */
async function fetchOpenApiJsonViaSameOriginProxy(trimmed) {
  const origin = window.location.origin.replace(/\/$/, "");
  const url =
    origin +
    "/__testlens_openapi_proxy?url=" +
    encodeURIComponent(trimmed);
  const res = await fetch(url, FETCH_PROXY_INIT);
  if (!res.ok) {
    throw new Error(`Dev server proxy HTTP ${res.status}`);
  }
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Dev server proxy returned non-JSON.");
  }
  if (!jsonLooksLikeOpenApiDoc(parsed)) {
    throw new Error("Dev server proxy returned non-OpenAPI JSON.");
  }
  return parsed;
}

async function fetchOpenApiJsonViaConfiguredProxy(trimmed, proxyBase) {
  const proxyUrl = buildOpenApiProxyFetchUrl(proxyBase, trimmed);
  if (!proxyUrl) throw new Error("Invalid CORS proxy base URL.");
  const res = await fetch(proxyUrl, FETCH_PROXY_INIT);
  if (!res.ok) {
    throw new Error(`CORS proxy returned HTTP ${res.status}.`);
  }
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("CORS proxy returned non-JSON.");
  }
  if (!jsonLooksLikeOpenApiDoc(parsed)) {
    throw new Error(
      "CORS proxy returned JSON that is not an OpenAPI document."
    );
  }
  return parsed;
}

async function fetchOpenApiJsonDirect(trimmed) {
  const res = await fetch(trimmed, FETCH_DIRECT_INIT);
  if (!res.ok) throw new Error(`HTTP ${res.status} loading OpenAPI document.`);

  const ct = (res.headers.get("Content-Type") || "").toLowerCase();
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (!ct.includes("json")) {
      throw new Error(
        "Response was not valid JSON. The server may require auth, or you can upload the OpenAPI file instead."
      );
    }
    throw new Error("Invalid JSON in OpenAPI response.");
  }
  if (!jsonLooksLikeOpenApiDoc(parsed)) {
    throw new Error(
      "URL returned JSON that is not an OpenAPI document (missing paths / version fields)."
    );
  }
  return parsed;
}

/**
 * When the spec host omits CORS headers, fetch via a public relay (third party requests your URL).
 * Order: CodeTabs (often works for production URLs), then allorigins.
 * corsproxy.io is omitted: free tier blocks non-dev origins and returns JSON `{ "error": "…" }`.
 */
async function fetchOpenApiJsonViaCodetabs(trimmed) {
  const proxyUrl =
    "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(trimmed);
  const res = await fetch(proxyUrl, FETCH_PROXY_INIT);
  if (!res.ok) throw new Error(`CORS relay HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("CORS relay returned data that is not valid JSON.");
  }
}

async function fetchOpenApiJsonViaAllOriginsGet(trimmed) {
  const proxyUrl =
    "https://api.allorigins.win/get?url=" + encodeURIComponent(trimmed);
  const res = await fetch(proxyUrl, FETCH_PROXY_INIT);
  if (!res.ok) throw new Error(`CORS relay HTTP ${res.status}`);
  const wrap = await res.json();
  const code = wrap && wrap.status && wrap.status.http_code;
  if (code && code !== 200) throw new Error(`OpenAPI origin returned HTTP ${code}`);
  const text = wrap && wrap.contents;
  if (typeof text !== "string") throw new Error("CORS relay returned an empty body.");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("CORS relay returned data that is not valid JSON.");
  }
}

async function fetchOpenApiJsonViaAllOriginsRaw(trimmed) {
  const proxyUrl =
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(trimmed);
  const res = await fetch(proxyUrl, FETCH_PROXY_INIT);
  if (!res.ok) throw new Error(`CORS relay HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("CORS relay returned data that is not valid JSON.");
  }
}

/**
 * @param {{ allowCorsRelay?: boolean, openApiProxyBase?: string }} [options]
 * @returns {{ json: object, viaProxy: boolean, proxyKind?: 'user'|'public' }}
 */
async function fetchOpenApiJson(url, options = {}) {
  const allowCorsRelay = options.allowCorsRelay !== false;
  const trimmed = url.replace(/\u00a0/g, " ").trim();
  if (!trimmed) {
    throw new Error("Enter a Swagger/OpenAPI URL or upload a JSON file.");
  }

  try {
    const json = await fetchOpenApiJsonDirect(trimmed);
    return { json, viaProxy: false };
  } catch (directErr) {
    if (!shouldRetryOpenApiWithProxies(directErr)) {
      throw directErr;
    }

    let host = "";
    try {
      host = String(window.location.hostname || "");
    } catch {
      host = "";
    }
    if (host === "localhost" || host === "127.0.0.1") {
      try {
        const json = await fetchOpenApiJsonViaSameOriginProxy(trimmed);
        return { json, viaProxy: true, proxyKind: "user" };
      } catch {
        /* e.g. python http.server — no /__testlens_openapi_proxy */
      }
    }

    const proxyBases = buildOpenApiProxyAttemptsList(options);
    for (const base of proxyBases) {
      try {
        const json = await fetchOpenApiJsonViaConfiguredProxy(trimmed, base);
        return { json, viaProxy: true, proxyKind: "user" };
      } catch {
        /* try next base */
      }
    }

    if (!allowCorsRelay) {
      if (proxyBases.length) {
        throw new Error(
          "Could not load the spec through your CORS proxy. Run npm run openapi-proxy in the project root (port 8787), or upload the OpenAPI JSON file."
        );
      }
      throw directErr;
    }
    const relays = [
      fetchOpenApiJsonViaCodetabs,
      fetchOpenApiJsonViaAllOriginsGet,
      fetchOpenApiJsonViaAllOriginsRaw,
    ];
    for (const relay of relays) {
      try {
        const json = await relay(trimmed);
        if (!jsonLooksLikeOpenApiDoc(json)) {
          continue;
        }
        return { json, viaProxy: true, proxyKind: "public" };
      } catch {
        /* try next relay */
      }
    }
    throw new Error(
      "OpenAPI URL failed: the browser could not load the spec from " +
        window.location.origin +
        ". Easiest fix: open the spec URL in a new tab, save the JSON (Save As), and upload it above (file beats URL). On localhost you can also run npm run dev or npm run openapi-proxy. On GitHub Pages, upload the file or use your own proxy (README)."
    );
  }
}

/** Path segments: literals, or null for `{param}` / Postman `:param`. */
function pathStructureTokens(path) {
  let p = normalizePath(path || "").trim();
  if (!p) return [];
  if (!p.startsWith("/")) p = "/" + p;
  return p.split("/").filter(Boolean).map((seg) => {
    if (seg.startsWith("{") && seg.endsWith("}") && seg.length > 2) return null;
    if (seg.startsWith(":") && seg.length > 1) return null;
    return seg;
  });
}

/**
 * Spec path vs Postman path: literals must match; `{a}` matches `{b}` or a concrete segment.
 */
function swaggerPostmanPathsMatch(swaggerPath, postmanPath) {
  const s = pathStructureTokens(swaggerPath);
  const p = pathStructureTokens(postmanPath);
  if (s.length !== p.length) return false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === null || p[i] === null) continue;
    if (s[i] !== p[i]) return false;
  }
  return true;
}

function postmanMatchesSwaggerOperation(
  pm,
  pp,
  swaggerMethod,
  swaggerPath,
  prefixes
) {
  if (String(pm || "").toUpperCase() !== String(swaggerMethod || "").toUpperCase()) {
    return false;
  }
  for (const prefix of prefixes) {
    const joined = joinServerPathPrefixAndPath(prefix, swaggerPath);
    if (swaggerPostmanPathsMatch(joined, pp)) return true;
  }
  return false;
}

/**
 * Path prefixes from OpenAPI servers (3.x) and Swagger 2 basePath.
 * Always includes "" so paths in `paths` match Postman the same as before.
 */
function getServerPathPrefixes(openapi) {
  const out = new Set([""]);
  if (!openapi || typeof openapi !== "object") return Array.from(out);
  if (Array.isArray(openapi.servers)) {
    for (const s of openapi.servers) {
      if (!s || typeof s.url !== "string") continue;
      const raw = s.url.trim();
      if (!raw) continue;
      try {
        const parsed = new URL(raw, "https://placeholder.local/");
        let pathname = parsed.pathname || "";
        if (pathname.length > 1 && pathname.endsWith("/")) {
          pathname = pathname.slice(0, -1);
        }
        if (pathname === "/") pathname = "";
        out.add(pathname);
      } catch {
        /* ignore bad server url */
      }
    }
  }
  if (typeof openapi.basePath === "string" && openapi.basePath.trim()) {
    let bp = openapi.basePath.trim();
    if (!bp.startsWith("/")) bp = "/" + bp;
    if (bp.length > 1 && bp.endsWith("/")) bp = bp.slice(0, -1);
    if (bp !== "/") out.add(bp);
  }
  return Array.from(out);
}

/** Join OpenAPI server path prefix and a paths-key (e.g. /v1 + /users → /v1/users). */
function joinServerPathPrefixAndPath(prefix, path) {
  const raw = (path || "").trim();
  const pathPart = raw.startsWith("/") ? raw : "/" + raw;
  let pre = (prefix || "").trim().replace(/\/+$/, "");
  if (!pre || pre === "/") return pathPart;
  if (!pre.startsWith("/")) pre = "/" + pre;
  return pre + pathPart;
}

/** For PDF / exports: human-readable spec source (no effect on coverage math). */
function deriveReportBaseUrl(openapi, urlTrim) {
  const t = (urlTrim || "").trim();
  if (t) return t;
  if (openapi.servers && openapi.servers[0] && openapi.servers[0].url) {
    return String(openapi.servers[0].url);
  }
  if (openapi.host) {
    const scheme =
      openapi.schemes && openapi.schemes.length ? openapi.schemes[0] : "https";
    return scheme + "://" + openapi.host + (openapi.basePath || "");
  }
  return "Uploaded OpenAPI file (no URL)";
}

function runAnalysis(openapi, collection, options) {
  const { host, halHost, excludeDeprecated } = options;

  const swaggerEndpoints = extractSwaggerPaths(openapi, excludeDeprecated);
  const prefixes = getServerPathPrefixes(openapi);
  const { endpoints: postmanEndpoints, totalRequests } = detectAndExtractRequests(
    collection,
    host,
    halHost
  );

  const canonicalOps = swaggerEndpoints.map(([m, p]) => ({
    method: m,
    path: normalizePath(p),
  }));

  const postmanPairs = postmanEndpoints.map(([m, p, folder]) => [
    m,
    normalizePath(p),
    folder || "",
  ]);

  const coveredCanonical = new Set();
  for (let i = 0; i < canonicalOps.length; i++) {
    const op = canonicalOps[i];
    for (const [m, p] of postmanPairs) {
      if (postmanMatchesSwaggerOperation(m, p, op.method, op.path, prefixes)) {
        coveredCanonical.add(i);
        break;
      }
    }
  }

  const missing = [];
  for (let i = 0; i < canonicalOps.length; i++) {
    if (!coveredCanonical.has(i)) {
      missing.push([canonicalOps[i].method, canonicalOps[i].path]);
    }
  }

  const matchedRequests = postmanPairs.filter(([m, p]) =>
    canonicalOps.some((op) =>
      postmanMatchesSwaggerOperation(m, p, op.method, op.path, prefixes)
    )
  );
  const unmatchedRequests = postmanPairs.filter(
    ([m, p]) =>
      !canonicalOps.some((op) =>
        postmanMatchesSwaggerOperation(m, p, op.method, op.path, prefixes)
      )
  );

  const totalApis = canonicalOps.length;
  const uniqueAutomated = coveredCanonical.size;
  const remaining = missing.length;
  const coveragePct = totalApis ? (uniqueAutomated / totalApis) * 100 : 0;
  const remainingPct = totalApis ? (remaining / totalApis) * 100 : 0;

  const automatedApis = [];
  for (const i of coveredCanonical) {
    automatedApis.push([canonicalOps[i].method, canonicalOps[i].path]);
  }

  // Compute per-folder stats (collection folders with zero coverage)
  const folderStats = {};
  for (const [, , folder] of postmanPairs) {
    const key = folder || "";
    if (!key) continue;
    if (!folderStats[key]) folderStats[key] = { total: 0, covered: 0 };
    folderStats[key].total++;
  }
  for (const [, , folder] of matchedRequests) {
    const key = folder || "";
    if (key && folderStats[key]) folderStats[key].covered++;
  }
  const untestedFolders = Object.entries(folderStats)
    .filter(([, s]) => s.covered === 0 && s.total > 0)
    .map(([name, s]) => ({ name, total: s.total }));

  return {
    totalApis,
    postmanRequestsTotal: totalRequests,
    matchedRequestCount: matchedRequests.length,
    unmatchedCount: unmatchedRequests.length,
    uniqueAutomated,
    remaining,
    coveragePct,
    remainingPct,
    automatedApis,
    matchedRequests,
    unmatchedRequests,
    missingApis: missing,
    untestedFolders,
  };
}

function formatEndpointList(pairs) {
  return pairs.map(([m, p]) => `${m} ${p}`).join("\n");
}

function validateOpenApiDocument(openapi) {
  if (!openapi || typeof openapi !== "object") {
    return "That file is not a JSON object. Export the spec as OpenAPI JSON.";
  }
  // Detect if user uploaded a Postman collection in the OpenAPI slot
  if (openapi.info && openapi.item && Array.isArray(openapi.item)) {
    return "This looks like a Postman collection, not an OpenAPI spec. " +
      "Please upload your OpenAPI / Swagger JSON in the left panel, " +
      "and your Postman collection in the right panel.";
  }
  const hasVersion =
    typeof openapi.openapi === "string" || typeof openapi.swagger === "string";
  if (!openapi.paths || typeof openapi.paths !== "object") {
    if (!hasVersion) {
      return "This JSON has no `paths` section. Use an OpenAPI 2.x or 3.x file " +
        "(it must include `openapi` or `swagger` plus `paths`). " +
        "If this is a Postman environment or globals file, export the Collection instead.";
    }
    return "This JSON has an `openapi` version field but no `paths` object. " +
      "Make sure you exported the full OpenAPI spec, not just the info or components section.";
  }
  return null;
}

const els = {
  form: document.getElementById("coverage-form"),
  swaggerUrl: document.getElementById("swagger-url"),
  swaggerFile: document.getElementById("swagger-file"),
  collectionFile: document.getElementById("collection-file"),
  host: document.getElementById("host"),
  halHost: document.getElementById("hal-host"),
  excludeDeprecated: document.getElementById("exclude-deprecated"),
  error: document.getElementById("error-banner"),
  results: document.getElementById("results"),
  runBtn: document.getElementById("run-btn"),

  mTotalApis: document.getElementById("m-total-apis"),
  mPostmanTotal: document.getElementById("m-postman-total"),
  mMatched: document.getElementById("m-matched"),
  mUnmatched: document.getElementById("m-unmatched"),
  mUniqueAuto: document.getElementById("m-unique-auto"),
  mMissing: document.getElementById("m-missing"),
  mCoverage: document.getElementById("m-coverage"),
  mRemainingPct: document.getElementById("m-remaining-pct"),

  tabBtns: document.querySelectorAll("[data-tab]"),
  listContent: document.getElementById("list-content"),

  tTotalApis: document.getElementById("t-total-apis"),
  tPostman: document.getElementById("t-postman"),
  tMatched: document.getElementById("t-matched"),
  tUnmatched: document.getElementById("t-unmatched"),
  tMissing: document.getElementById("t-missing"),
  openapiLoadNotice: document.getElementById("openapi-load-notice"),
  compareStatus: document.getElementById("compare-status"),
  allowCorsRelay: document.getElementById("allow-cors-relay"),
  copyListBtn: document.getElementById("copy-list-btn"),
  openapiProxyBase: document.getElementById("openapi-cors-proxy-base"),
};

let lastLists = null;
let lastResult = null;
let activeTabName = "automated";
const ORIG_TITLE = document.title;

function setCompareStatus(msg) {
  const el = els.compareStatus;
  if (!el) return;
  if (!msg) {
    el.textContent = "";
    el.classList.add("hidden");
    el.setAttribute("aria-hidden", "true");
    return;
  }
  el.textContent = msg;
  el.classList.remove("hidden");
  el.setAttribute("aria-hidden", "false");
}

function plainTextForActiveTab() {
  if (!lastLists) return "";
  const map = {
    automated: formatEndpointList(lastLists.matchedRequests),
    missing: formatEndpointList(lastLists.missingApis),
    unmatched: formatEndpointList(lastLists.unmatchedRequests),
  };
  return map[activeTabName] || "";
}

function showError(msg) {
  els.error.textContent = msg;
  els.error.classList.remove("hidden");
}

function clearError() {
  els.error.textContent = "";
  els.error.classList.add("hidden");
}

function setCompareButtonLoading(loading) {
  const btn = els.runBtn;
  if (!btn) return;
  const label = btn.querySelector(".run-btn-label");
  const pending = btn.querySelector(".run-btn-loading");
  if (!label || !pending) return;
  if (loading) {
    label.classList.add("hidden");
    pending.classList.remove("hidden");
    pending.classList.add("flex");
    btn.setAttribute("aria-busy", "true");
  } else {
    label.classList.remove("hidden");
    pending.classList.add("hidden");
    pending.classList.remove("flex");
    btn.removeAttribute("aria-busy");
  }
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Count-up coverage % and progress bar width; heat colors follow via ui.js observer. */
function animateCoverageTo(targetPct) {
  const cov = els.mCoverage;
  const label = document.getElementById("coverage-progress-label");
  const fill = document.getElementById("coverage-progress-fill");
  if (!cov || typeof targetPct !== "number" || Number.isNaN(targetPct)) return;
  const end = Math.max(0, Math.min(100, targetPct));
  if (prefersReducedMotion()) {
    cov.textContent = end.toFixed(2) + "%";
    if (fill) fill.style.width = end + "%";
    if (label) label.textContent = cov.textContent.trim();
    return;
  }
  cov.textContent = "0.00%";
  if (fill) fill.style.width = "0%";
  if (label) label.textContent = "0%";
  const start = performance.now();
  const duration = 950;
  function tick(now) {
    const u = Math.min(1, (now - start) / duration);
    const v = end * easeOutCubic(u);
    cov.textContent = v.toFixed(2) + "%";
    if (fill) fill.style.width = v + "%";
    if (label) label.textContent = v.toFixed(2) + "%";
    if (u < 1) requestAnimationFrame(tick);
    else {
      cov.textContent = end.toFixed(2) + "%";
      if (fill) fill.style.width = end + "%";
      if (label) label.textContent = end.toFixed(2) + "%";
    }
  }
  requestAnimationFrame(tick);
}

function setActiveTab(name) {
  activeTabName = name || "automated";
  els.tabBtns.forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-tab") === name);
  });
  // Clear search on tab switch
  const searchInput = document.getElementById("list-search");
  if (searchInput) searchInput.value = "";
  const countEl = document.getElementById("list-search-count");
  if (countEl) countEl.textContent = "";
  if (!lastLists) return;
  const pairsMap = {
    automated: lastLists.matchedRequests,
    missing: lastLists.missingApis,
    unmatched: lastLists.unmatchedRequests,
  };
  const pairs = pairsMap[name] || [];
  if (typeof window.TL_renderListFull === "function") {
    window.TL_renderListFull(pairs, name);
  } else {
    els.listContent.textContent = formatEndpointList(pairs);
  }
}

els.tabBtns.forEach((b) => {
  b.addEventListener("click", () => setActiveTab(b.getAttribute("data-tab")));
});

if (els.copyListBtn) {
  els.copyListBtn.addEventListener("click", async () => {
    const text = plainTextForActiveTab();
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      const prev = els.copyListBtn.textContent;
      els.copyListBtn.textContent = "Copied";
      setTimeout(() => {
        els.copyListBtn.textContent = prev;
      }, 1600);
    } catch {
      showError("Could not copy to the clipboard.");
    }
  });
}

/* ── #62 Keyboard shortcut: Ctrl+Enter / Cmd+Enter ──────────────────── */
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === "Enter")) {
    e.preventDefault();
    if (els.runBtn && !els.runBtn.disabled) {
      els.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }
  }
});

/* ── #63 Clear all button ────────────────────────────────────────────── */
const clearAllBtn = document.getElementById("clear-all-btn");
if (clearAllBtn) {
  clearAllBtn.addEventListener("click", () => {
    // Reset file inputs
    if (els.swaggerFile) { els.swaggerFile.value = ""; els.swaggerFile.dispatchEvent(new Event("change", { bubbles: true })); }
    if (els.collectionFile) { els.collectionFile.value = ""; els.collectionFile.dispatchEvent(new Event("change", { bubbles: true })); }
    // Reset URL input
    if (els.swaggerUrl) els.swaggerUrl.value = "";
    // Hide results
    if (els.results) els.results.classList.add("hidden");
    lastLists = null;
    lastResult = null;
    clearError();
    setCompareStatus("");
    // Reset title
    document.title = ORIG_TITLE;
    // Hide trend
    const trendEl = document.getElementById("coverage-trend");
    if (trendEl) { trendEl.textContent = ""; trendEl.className = "mt-1 hidden text-xs font-semibold"; }
    // Hide untested folders
    const uf = document.getElementById("untested-folders-section");
    if (uf) uf.classList.add("hidden");
    // Clear URL hash
    if (history.replaceState) history.replaceState(null, "", window.location.pathname + window.location.search);
    // Notify ui.js
    window.dispatchEvent(new CustomEvent("testlens-cleared"));
  });
}

/* ── #71 Shareable link: read hash on load ───────────────────────────── */
(function readSharedHash() {
  try {
    const hash = window.location.hash.slice(1);
    if (!hash.startsWith("r=")) return;
    const parts = hash.slice(2).split(":");
    if (parts.length < 4) return;
    const [pct, total, covered, missing] = parts.map(Number);
    if (isNaN(pct) || isNaN(total)) return;
    const banner = document.getElementById("shared-result-banner");
    if (banner) {
      banner.querySelector("strong").textContent =
        `Shared result: ${pct.toFixed(1)}% coverage — ${covered}/${total} covered, ${missing} missing.`;
      banner.classList.remove("hidden");
    }
    const dismiss = document.getElementById("dismiss-shared-banner");
    if (dismiss) dismiss.addEventListener("click", () => banner.classList.add("hidden"));
  } catch { /* ignore */ }
})();

/* ── #72 JSON export ─────────────────────────────────────────────────── */
const dlJsonBtn = document.getElementById("download-json-btn");
if (dlJsonBtn) {
  dlJsonBtn.addEventListener("click", () => {
    if (!lastResult) return;
    const data = {
      generatedAt: new Date().toISOString(),
      totalApis: lastResult.totalApis,
      covered: lastResult.uniqueAutomated,
      missing: lastResult.remaining,
      coveragePct: parseFloat(lastResult.coveragePct.toFixed(2)),
      collectionRequestsTotal: lastResult.postmanRequestsTotal,
      matchedRequests: lastResult.matchedRequests.map(([m, p, f]) => ({ method: m, path: p, folder: f || null })),
      missingApis: lastResult.missingApis.map(([m, p]) => ({ method: m, path: p })),
      extraRequests: lastResult.unmatchedRequests.map(([m, p, f]) => ({ method: m, path: p, folder: f || null })),
      untestedFolders: lastResult.untestedFolders,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `testlens-coverage-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

/* ── #74 Copy summary button ─────────────────────────────────────────── */
const copySummaryBtn = document.getElementById("copy-summary-btn");
if (copySummaryBtn) {
  copySummaryBtn.addEventListener("click", async () => {
    if (!lastResult) return;
    const r = lastResult;
    const text = [
      `Coverage: ${r.coveragePct.toFixed(2)}%`,
      `Total APIs: ${r.totalApis}`,
      `Covered: ${r.uniqueAutomated}`,
      `Missing: ${r.remaining}`,
      `Extra (not in spec): ${r.unmatchedCount}`,
      `Collection requests: ${r.postmanRequestsTotal}`,
    ].join(" | ");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.cssText = "position:fixed;left:-9999px"; document.body.appendChild(ta);
        ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
      }
      const orig = copySummaryBtn.textContent;
      copySummaryBtn.textContent = "Copied ✓";
      setTimeout(() => { copySummaryBtn.textContent = orig; }, 1600);
    } catch { showError("Could not copy to clipboard."); }
  });
}

/* ── #71 Share link button ───────────────────────────────────────────── */
const shareLinkBtn = document.getElementById("share-link-btn");
if (shareLinkBtn) {
  shareLinkBtn.addEventListener("click", async () => {
    if (!lastResult) return;
    const r = lastResult;
    const hash = `#r=${r.coveragePct.toFixed(2)}:${r.totalApis}:${r.uniqueAutomated}:${r.remaining}`;
    const url = window.location.origin + window.location.pathname + hash;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url; ta.style.cssText = "position:fixed;left:-9999px"; document.body.appendChild(ta);
        ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
      }
      if (history.replaceState) history.replaceState(null, "", hash);
      const orig = shareLinkBtn.textContent;
      shareLinkBtn.textContent = "Link copied ✓";
      setTimeout(() => { shareLinkBtn.textContent = orig; }, 2000);
    } catch { showError("Could not copy share link."); }
  });
}

/* ── #73 Slack/Teams webhook ─────────────────────────────────────────── */
const WEBHOOK_STORAGE_KEY = "testlens-webhook-url";
const webhookInput = document.getElementById("webhook-url");
if (webhookInput) {
  try { const saved = localStorage.getItem(WEBHOOK_STORAGE_KEY); if (saved) webhookInput.value = saved; } catch {}
  webhookInput.addEventListener("change", () => {
    try {
      const v = webhookInput.value.trim();
      if (v) localStorage.setItem(WEBHOOK_STORAGE_KEY, v); else localStorage.removeItem(WEBHOOK_STORAGE_KEY);
    } catch {}
  });
}

async function sendWebhookNotification(r) {
  const input = document.getElementById("webhook-url");
  const statusEl = document.getElementById("webhook-status");
  const url = (input && input.value.trim()) || "";
  if (!url) return;
  const payload = {
    text: `TestLens Coverage Report: *${r.coveragePct.toFixed(2)}%* — ${r.uniqueAutomated}/${r.totalApis} APIs covered, ${r.remaining} missing, ${r.unmatchedCount} extra.`,
  };
  if (statusEl) { statusEl.textContent = "Sending…"; statusEl.className = "min-h-[1rem] text-xs text-[#6b7280]"; }
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (statusEl) { statusEl.textContent = "✓ Notification sent!"; statusEl.className = "min-h-[1rem] text-xs webhook-success"; }
  } catch (err) {
    if (statusEl) { statusEl.textContent = `⚠ Could not send: ${err.message || "network error"}. Check CORS / webhook URL.`; statusEl.className = "min-h-[1rem] text-xs webhook-error"; }
  }
}

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  setCompareStatus("");
  els.results.classList.add("hidden");
  lastLists = null;
  if (els.openapiLoadNotice) {
    els.openapiLoadNotice.textContent = "";
    els.openapiLoadNotice.classList.add("hidden");
  }

  const collFiles = els.collectionFile.files;
  if (!collFiles || !collFiles.length) {
    showError(
      "Please upload a collection file — Postman v1/v2/v2.1, Insomnia v4, Bruno (JSON), or HAR."
    );
    return;
  }

  const swaggerF = els.swaggerFile.files;
  const urlTrim = els.swaggerUrl.value.trim();
  if (!swaggerF || !swaggerF.length) {
    if (!urlTrim) {
      showError("Provide an OpenAPI / Swagger spec file (JSON or YAML) or paste a spec URL.");
      return;
    }
    if (!openApiUrlLooksLikeJson(urlTrim)) {
      showError(
        "OpenAPI URL must end with .json, .yaml, or .yml (e.g. .../openapi.json) or use ?format=json. Or upload a spec file."
      );
      return;
    }
  }

  const allowRelay = els.allowCorsRelay ? els.allowCorsRelay.checked : true;

  els.runBtn.disabled = true;
  setCompareButtonLoading(true);
  try {
    setCompareStatus("Reading your collection file…");
    const collection = await readCollectionFile(collFiles[0]);
    // Detect if an OpenAPI spec was mistakenly uploaded as the collection
    if (
      collection &&
      typeof collection === "object" &&
      (typeof collection.openapi === "string" ||
        typeof collection.swagger === "string" ||
        (collection.paths &&
          typeof collection.paths === "object" &&
          !collection.item &&
          !collection.requests &&
          !collection.resources))
    ) {
      showError(
        "The file in the collection slot looks like an OpenAPI spec, not a collection. " +
        "Please upload your Postman / Insomnia / Bruno / HAR collection in the right panel, " +
        "and your OpenAPI / Swagger spec in the left panel."
      );
      return;
    }
    let openapi = null;

    if (swaggerF && swaggerF.length) {
      if (urlTrim) {
        setCompareStatus(
          "Reading uploaded OpenAPI file (pasted URL ignored when a file is selected)…"
        );
      } else {
        setCompareStatus("Reading your OpenAPI spec file…");
      }
      openapi = await readSpecFile(swaggerF[0]);
    } else {
      setCompareStatus("Loading OpenAPI from the URL…");
      let viaProxy = false;
      let proxyKind = null;
      try {
        const proxyInput = els.openapiProxyBase
          ? els.openapiProxyBase.value.trim()
          : "";
        const loaded = await fetchOpenApiJson(els.swaggerUrl.value, {
          allowCorsRelay: allowRelay,
          openApiProxyBase: proxyInput,
        });
        openapi = loaded.json;
        viaProxy = loaded.viaProxy;
        proxyKind = loaded.proxyKind || null;
      } catch (fetchErr) {
        els.results.classList.add("hidden");
        lastLists = null;
        showError(formatOpenApiLoadError(fetchErr));
        return;
      }
      if (viaProxy && els.openapiLoadNotice) {
        if (proxyKind === "user") {
          els.openapiLoadNotice.textContent =
            "OpenAPI was loaded through your CORS proxy (the spec server does not allow direct browser access). For private specs you can still use file upload.";
        } else {
          els.openapiLoadNotice.textContent =
            "OpenAPI was loaded through a public relay because the API did not allow a direct browser request. For private specs, download the file and use Upload instead. In DevTools → Network you may see several relay requests; failed or error responses are normal until one returns the real spec. For reliable access, use your own proxy: npm run openapi-proxy and set CORS proxy to http://localhost:8787.";
        }
        els.openapiLoadNotice.classList.remove("hidden");
      }
    }

    const specError = validateOpenApiDocument(openapi);
    if (specError) {
      showError(specError);
      return;
    }

    setCompareStatus("Comparing OpenAPI to Postman…");

    // Postman URL variables ({{HOST}} / {{HAL_HOST}}) inputs removed from UI; default empty.
    const options = {
      host: els.host ? els.host.value.trim() : "",
      halHost: els.halHost ? els.halHost.value.trim() : "",
      excludeDeprecated: els.excludeDeprecated.checked,
    };

    const r = runAnalysis(openapi, collection, options);
    const urlTrimForReport = els.swaggerUrl.value.trim();

    els.mTotalApis.textContent = r.totalApis;
    els.mPostmanTotal.textContent = r.postmanRequestsTotal;
    els.mMatched.textContent = r.matchedRequestCount;
    els.mUnmatched.textContent = r.unmatchedCount;
    els.mUniqueAuto.textContent = r.uniqueAutomated;
    els.mMissing.textContent = r.remaining;
    els.mCoverage.textContent = "0.00%";
    els.mRemainingPct.textContent = r.remainingPct.toFixed(2) + "%";

    els.tTotalApis.textContent = String(r.totalApis);
    els.tPostman.textContent = String(r.postmanRequestsTotal);
    els.tMatched.textContent = String(r.matchedRequestCount);
    els.tUnmatched.textContent = String(r.unmatchedCount);
    els.tMissing.textContent = String(r.remaining);

    lastLists = {
      matchedRequests: r.matchedRequests,
      missingApis: r.missingApis,
      unmatchedRequests: r.unmatchedRequests,
    };
    lastResult = r;
    setActiveTab("automated");
    els.results.classList.remove("hidden");
    animateCoverageTo(r.coveragePct);

    // #64 — Update browser tab title
    document.title = `${r.coveragePct.toFixed(0)}% — TestLens`;

    // #70 — Coverage trend vs last run in history
    try {
      const hist = JSON.parse(localStorage.getItem("testlens-run-history") || "[]");
      const trendEl = document.getElementById("coverage-trend");
      if (trendEl && hist.length >= 1) {
        const prev = hist[0].coveragePct; // hist[0] is the run we just saved (current)
        // Use hist[1] as the truly previous run
        const prevRun = hist[1];
        if (prevRun) {
          const delta = r.coveragePct - prevRun.coveragePct;
          const sign = delta > 0.05 ? "↑" : delta < -0.05 ? "↓" : "→";
          const cls = delta > 0.05 ? "trend-up" : delta < -0.05 ? "trend-down" : "trend-flat";
          trendEl.textContent = `${sign} ${Math.abs(delta).toFixed(1)}% vs last run`;
          trendEl.className = `mt-1 text-xs font-semibold ${cls}`;
          trendEl.classList.remove("hidden");
        }
      }
    } catch { /* ignore */ }

    // #68 — Untested folders
    try {
      const ufSection = document.getElementById("untested-folders-section");
      const ufList = document.getElementById("untested-folders-list");
      if (ufSection && ufList) {
        if (r.untestedFolders && r.untestedFolders.length) {
          ufList.innerHTML = r.untestedFolders.map(f =>
            `<span class="untested-folder-chip">📁 ${f.name} <span class="opacity-60">(${f.total})</span></span>`
          ).join("");
          ufSection.classList.remove("hidden");
        } else {
          ufSection.classList.add("hidden");
        }
      }
    } catch { /* ignore */ }

    // Show new export/share buttons
    ["download-json-btn", "copy-summary-btn", "share-link-btn"].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) { btn.classList.remove("hidden"); btn.disabled = false; }
    });

    requestAnimationFrame(function () {
      var reduce =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      els.results.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "start",
      });
    });

    window.dispatchEvent(
      new CustomEvent("api-coverage-report", {
        detail: {
          generatedAt: new Date().toISOString(),
          totalApis: r.totalApis,
          postmanRequestsTotal: r.postmanRequestsTotal,
          matchedRequestCount: r.matchedRequestCount,
          unmatchedCount: r.unmatchedCount,
          uniqueAutomated: r.uniqueAutomated,
          remaining: r.remaining,
          coveragePct: r.coveragePct,
          remainingPct: r.remainingPct,
          matchedText: formatEndpointList(r.matchedRequests),
          missingText: formatEndpointList(r.missingApis),
          unmatchedText: formatEndpointList(r.unmatchedRequests),
          matchedRequests: r.matchedRequests,
          missingApis: r.missingApis,
          unmatchedRequests: r.unmatchedRequests,
          openapi: openapi,
          excludeDeprecated: options.excludeDeprecated,
          baseUrl: deriveReportBaseUrl(openapi, urlTrimForReport),
        },
      })
    );

    try {
      const dashRows = [
        ...r.automatedApis.map(([method, path]) => ({
          method,
          path,
          status: "covered",
        })),
        ...r.missingApis.map(([method, path]) => ({
          method,
          path,
          status: "missing",
        })),
      ].sort((a, b) => {
        const c = a.path.localeCompare(b.path);
        return c !== 0 ? c : a.method.localeCompare(b.method);
      });
      /* localStorage so Visual dashboard / Chart PDF report tabs can read the same run (sessionStorage is per-tab). */
      localStorage.setItem(
        "testlens-dashboard",
        JSON.stringify({
          totalSwagger: r.totalApis,
          totalPostman: r.postmanRequestsTotal,
          covered: r.uniqueAutomated,
          missing: r.remaining,
          coveragePct: r.coveragePct,
          generatedAt: new Date().toISOString(),
          rows: dashRows,
        })
      );
    } catch {
      /* private mode / quota */
    }

    // Save to run history (last 5 runs)
    try {
      const histKey = "testlens-run-history";
      const hist = JSON.parse(localStorage.getItem(histKey) || "[]");
      hist.unshift({
        id: Date.now(),
        generatedAt: new Date().toISOString(),
        totalApis: r.totalApis,
        covered: r.uniqueAutomated,
        missing: r.remaining,
        coveragePct: r.coveragePct,
      });
      hist.splice(5);
      localStorage.setItem(histKey, JSON.stringify(hist));
      window.dispatchEvent(new CustomEvent("testlens-history-updated"));
    } catch { /* quota / private mode */ }

    // #73 — Slack/Teams webhook notification
    sendWebhookNotification(r);

    const ann = document.getElementById("results-announcer");
    if (ann) {
      ann.textContent = `Comparison complete. ${r.coveragePct.toFixed(
        1
      )}% of Swagger operations appear in the Postman collection. Markdown export, visual dashboard, and chart PDF report are available.`;
    }
    setCompareStatus("");
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    setCompareStatus("");
    setCompareButtonLoading(false);
    els.runBtn.disabled = false;
  }
});

(function hydrateOpenApiProxyField() {
  const el = document.getElementById("openapi-cors-proxy-base");
  if (!el) return;
  try {
    const s = localStorage.getItem(OPENAPI_PROXY_STORAGE_KEY);
    if (s && !el.value) el.value = s;
  } catch {
    /* private mode */
  }
  el.addEventListener("change", function () {
    try {
      const v = el.value.trim();
      if (v) localStorage.setItem(OPENAPI_PROXY_STORAGE_KEY, v);
      else localStorage.removeItem(OPENAPI_PROXY_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  });
})();
