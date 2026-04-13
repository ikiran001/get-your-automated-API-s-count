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
 * Paths match by structure: literal segments must match; {any} matches any param name in that slot.
 */

const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
]);

function normalizePath(path) {
  if (!path) return "";
  let p = path.replace(/\{\{([^}]+)\}\}/g, "{$1}");
  p = p.replace("{hosting_account_id}", "{hosting_id}");
  return p;
}

/** True if URL looks like a JSON OpenAPI endpoint (path ends with .json or ?format=json). */
function openApiUrlLooksLikeJson(urlTrim) {
  if (!urlTrim) return false;
  try {
    const u = new URL(urlTrim);
    const path = u.pathname.toLowerCase();
    if (path.endsWith(".json")) return true;
    const fmt = u.searchParams.get("format");
    if (fmt && String(fmt).toLowerCase() === "json") return true;
    return false;
  } catch {
    return false;
  }
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

  if (urlObj && Array.isArray(urlObj.path) && urlObj.path.length) {
    return "/" + urlObj.path.join("/");
  }

  if (rawUrl) {
    let safe = rawUrl;
    if (host) safe = safe.replace(/\{\{HOST\}\}/g, host);
    if (halHost) safe = safe.replace(/\{\{HAL_HOST\}\}/g, halHost);
    try {
      const base = "http://__postman_placeholder__";
      const u = new URL(safe, base);
      return u.pathname || "";
    } catch {
      return "";
    }
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

  function walkItems(items) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item.request) {
        totalRequests += 1;
        const method = (item.request.method || "").toUpperCase();
        const path = normalizePath(
          parseRequestUrl(item.request, host, halHost)
        );
        if (method && path) endpoints.push([method, path]);
      }
      if (item.item) walkItems(item.item);
    }
  }

  if (collection.item) walkItems(collection.item);
  return { endpoints, totalRequests };
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (e) {
        reject(new Error("Invalid JSON in file: " + file.name));
      }
    };
    reader.onerror = () => reject(new Error("Could not read " + file.name));
    reader.readAsText(file, "UTF-8");
  });
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
      "Reliable fix: open your OpenAPI link in a new tab → Save As → use “Upload OpenAPI JSON”. " +
      "Also push the latest site from GitHub, hard-refresh (Ctrl+Shift+R or Cmd+Shift+R), and try turning off ad blockers for this page."
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

async function fetchOpenApiJsonDirect(trimmed) {
  const res = await fetch(trimmed, FETCH_DIRECT_INIT);
  if (!res.ok) throw new Error(`HTTP ${res.status} loading OpenAPI document.`);

  const ct = (res.headers.get("Content-Type") || "").toLowerCase();
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (!ct.includes("json")) {
      throw new Error(
        "Response was not valid JSON. The server may require auth, or you can upload the OpenAPI file instead."
      );
    }
    throw new Error("Invalid JSON in OpenAPI response.");
  }
}

/**
 * When the spec host omits CORS headers, fetch via a public relay (third party requests your URL).
 * Order: CodeTabs (handles large specs better), then allorigins.
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

async function fetchOpenApiJsonViaCorsProxyIo(trimmed) {
  const proxyUrl = "https://corsproxy.io/?" + encodeURIComponent(trimmed);
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
 * @param {{ allowCorsRelay?: boolean }} [options] — default allows relays when direct fetch fails (CORS/network).
 * @returns {{ json: object, viaProxy: boolean }}
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
    if (!isBrowserCorsOrNetworkError(directErr)) {
      throw directErr;
    }
    if (!allowCorsRelay) {
      throw directErr;
    }
    const relays = [
      fetchOpenApiJsonViaCodetabs,
      fetchOpenApiJsonViaAllOriginsGet,
      fetchOpenApiJsonViaAllOriginsRaw,
      fetchOpenApiJsonViaCorsProxyIo,
    ];
    for (const relay of relays) {
      try {
        const json = await relay(trimmed);
        return { json, viaProxy: true };
      } catch {
        /* try next relay */
      }
    }
    throw new Error(
      "OpenAPI URL failed: direct request and all public CORS relays failed from " +
        window.location.origin +
        ". Upload the JSON file, or ask the API team to send Access-Control-Allow-Origin for this origin."
    );
  }
}

/** Path segments: literals, or null for `{param}`. */
function pathStructureTokens(path) {
  let p = normalizePath(path || "").trim();
  if (!p) return [];
  if (!p.startsWith("/")) p = "/" + p;
  return p.split("/").filter(Boolean).map((seg) =>
    seg.startsWith("{") && seg.endsWith("}") && seg.length > 2 ? null : seg
  );
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
  const { endpoints: postmanEndpoints, totalRequests } = extractPostmanRequests(
    collection,
    host,
    halHost
  );

  const canonicalOps = swaggerEndpoints.map(([m, p]) => ({ method: m, path: p }));

  const postmanPairs = postmanEndpoints.map(([m, p]) => [
    m,
    normalizePath(p),
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
  };
}

function formatEndpointList(pairs) {
  return pairs.map(([m, p]) => `${m} ${p}`).join("\n");
}

function validateOpenApiDocument(openapi) {
  if (!openapi || typeof openapi !== "object") {
    return "That file is not a JSON object. Export the spec as OpenAPI JSON.";
  }
  const hasVersion =
    typeof openapi.openapi === "string" || typeof openapi.swagger === "string";
  if (!openapi.paths || typeof openapi.paths !== "object") {
    if (!hasVersion) {
      return "This JSON has no `paths` section. Use an OpenAPI 2.x or 3.x file (it should include `openapi` or `swagger` plus `paths`).";
    }
    return "This JSON has no `paths` object. Check that you loaded the full OpenAPI spec.";
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
};

let lastLists = null;
let activeTabName = "automated";

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
  if (!lastLists) return;
  const map = {
    automated: formatEndpointList(lastLists.matchedRequests),
    missing: formatEndpointList(lastLists.missingApis),
    unmatched: formatEndpointList(lastLists.unmatchedRequests),
  };
  els.listContent.textContent = map[name] || "";
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
    showError("Please choose your Postman collection JSON file.");
    return;
  }

  const swaggerF = els.swaggerFile.files;
  const urlTrim = els.swaggerUrl.value.trim();
  if (!swaggerF || !swaggerF.length) {
    if (!urlTrim) {
      showError("Provide an OpenAPI JSON file or a spec URL.");
      return;
    }
    if (!openApiUrlLooksLikeJson(urlTrim)) {
      showError(
        "OpenAPI URL must end with .json (e.g. .../openapi.json) or use ?format=json. Or upload a spec file."
      );
      return;
    }
  }

  const allowRelay = els.allowCorsRelay ? els.allowCorsRelay.checked : true;

  els.runBtn.disabled = true;
  setCompareButtonLoading(true);
  try {
    setCompareStatus("Reading your Postman file…");
    const collection = await readJsonFile(collFiles[0]);
    let openapi = null;

    if (swaggerF && swaggerF.length) {
      setCompareStatus("Reading your OpenAPI file…");
      openapi = await readJsonFile(swaggerF[0]);
    } else {
      setCompareStatus("Loading OpenAPI from the URL…");
      let viaProxy = false;
      try {
        const loaded = await fetchOpenApiJson(els.swaggerUrl.value, {
          allowCorsRelay: allowRelay,
        });
        openapi = loaded.json;
        viaProxy = loaded.viaProxy;
      } catch (fetchErr) {
        showError(formatOpenApiLoadError(fetchErr));
        return;
      }
      if (viaProxy && els.openapiLoadNotice) {
        els.openapiLoadNotice.textContent =
          "OpenAPI was loaded through a public CORS relay because the API did not allow a direct browser request. For private specs, download the file and use Upload instead.";
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
    setActiveTab("automated");
    els.results.classList.remove("hidden");
    animateCoverageTo(r.coveragePct);

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
