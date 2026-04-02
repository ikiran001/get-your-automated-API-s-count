/**
 * Client-side API coverage: OpenAPI/Swagger paths vs Postman collection.
 * Mirrors api_coverage.py behavior.
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
  if (err.name === "TypeError") return true;
  const m = String(err.message || "");
  return /Failed to fetch|NetworkError|Load failed|network|aborted/i.test(m);
}

async function fetchOpenApiJsonDirect(trimmed) {
  const res = await fetch(trimmed, { mode: "cors" });
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
  const res = await fetch(proxyUrl, { mode: "cors" });
  if (!res.ok) throw new Error(`CORS relay HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("CORS relay returned data that is not valid JSON.");
  }
}

async function fetchOpenApiJsonViaAllOrigins(trimmed) {
  const proxyUrl =
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(trimmed);
  const res = await fetch(proxyUrl, { mode: "cors" });
  if (!res.ok) throw new Error(`CORS relay HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("CORS relay returned data that is not valid JSON.");
  }
}

/**
 * @returns {{ json: object, viaProxy: boolean }}
 */
async function fetchOpenApiJson(url) {
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
    try {
      const json = await fetchOpenApiJsonViaCodetabs(trimmed);
      return { json, viaProxy: true };
    } catch {
      /* try next relay */
    }
    try {
      const json = await fetchOpenApiJsonViaAllOrigins(trimmed);
      return { json, viaProxy: true };
    } catch {
      throw new Error(
        "Your browser blocked this URL (CORS), and public CORS relays could not load it either. " +
          "Fix: use “Upload OpenAPI JSON” (open the URL in a new tab and save the file), or ask the API team to send " +
          "Access-Control-Allow-Origin so GitHub Pages can fetch the spec directly."
      );
    }
  }
}

function endpointKey(m, p) {
  return m + " " + normalizePath(p);
}

function runAnalysis(openapi, collection, options) {
  const { host, halHost, excludeDeprecated } = options;

  const swaggerEndpoints = extractSwaggerPaths(openapi, excludeDeprecated);
  const { endpoints: postmanEndpoints, totalRequests } = extractPostmanRequests(
    collection,
    host,
    halHost
  );

  const swaggerSet = new Set(
    swaggerEndpoints.map(([m, p]) => endpointKey(m, p))
  );
  const postmanPairs = postmanEndpoints.map(([m, p]) => [
    m,
    normalizePath(p),
  ]);

  const coveredUnique = new Set();
  for (const [m, p] of postmanPairs) {
    const k = endpointKey(m, p);
    if (swaggerSet.has(k)) coveredUnique.add(k);
  }

  const missing = [];
  for (const k of swaggerSet) {
    if (!coveredUnique.has(k)) {
      const [method, ...rest] = k.split(" ");
      missing.push([method, rest.join(" ")]);
    }
  }

  const matchedRequests = postmanPairs.filter(([m, p]) =>
    swaggerSet.has(endpointKey(m, p))
  );
  const unmatchedRequests = postmanPairs.filter(
    ([m, p]) => !swaggerSet.has(endpointKey(m, p))
  );

  const totalApis = swaggerSet.size;
  const uniqueAutomated = coveredUnique.size;
  const remaining = missing.length;
  const coveragePct = totalApis ? (uniqueAutomated / totalApis) * 100 : 0;
  const remainingPct = totalApis ? (remaining / totalApis) * 100 : 0;

  return {
    totalApis,
    postmanRequestsTotal: totalRequests,
    matchedRequestCount: matchedRequests.length,
    unmatchedCount: unmatchedRequests.length,
    uniqueAutomated,
    remaining,
    coveragePct,
    remainingPct,
    automatedApis: Array.from(coveredUnique).map((k) => {
      const [method, ...pathParts] = k.split(" ");
      return [method, pathParts.join(" ")];
    }),
    matchedRequests,
    unmatchedRequests,
    missingApis: missing,
  };
}

function formatEndpointList(pairs) {
  return pairs.map(([m, p]) => `${m} ${p}`).join("\n");
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
};

let lastLists = null;

function showError(msg) {
  els.error.textContent = msg;
  els.error.classList.remove("hidden");
}

function clearError() {
  els.error.textContent = "";
  els.error.classList.add("hidden");
}

function setActiveTab(name) {
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

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
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

  els.runBtn.disabled = true;
  try {
    const collection = await readJsonFile(collFiles[0]);
    let openapi = null;

    const swaggerF = els.swaggerFile.files;
    if (swaggerF && swaggerF.length) {
      openapi = await readJsonFile(swaggerF[0]);
    } else {
      let viaProxy = false;
      try {
        const loaded = await fetchOpenApiJson(els.swaggerUrl.value);
        openapi = loaded.json;
        viaProxy = loaded.viaProxy;
      } catch (fetchErr) {
        const msg =
          fetchErr.message ||
          "Could not load OpenAPI from URL. Upload the JSON file or use a URL that allows browser access (CORS).";
        showError(msg);
        return;
      }
      if (viaProxy && els.openapiLoadNotice) {
        els.openapiLoadNotice.textContent =
          "OpenAPI was loaded through a public CORS relay because the API did not allow a direct browser request. For private specs, download the file and use Upload instead.";
        els.openapiLoadNotice.classList.remove("hidden");
      }
    }

    if (!openapi.paths || typeof openapi.paths !== "object") {
      showError(
        "OpenAPI document has no paths object. Use a JSON OpenAPI 2.x/3.x spec."
      );
      return;
    }

    const options = {
      host: els.host.value.trim(),
      halHost: els.halHost.value.trim(),
      excludeDeprecated: els.excludeDeprecated.checked,
    };

    const r = runAnalysis(openapi, collection, options);

    els.mTotalApis.textContent = r.totalApis;
    els.mPostmanTotal.textContent = r.postmanRequestsTotal;
    els.mMatched.textContent = r.matchedRequestCount;
    els.mUnmatched.textContent = r.unmatchedCount;
    els.mUniqueAuto.textContent = r.uniqueAutomated;
    els.mMissing.textContent = r.remaining;
    els.mCoverage.textContent = r.coveragePct.toFixed(2) + "%";
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
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    els.runBtn.disabled = false;
  }
});
