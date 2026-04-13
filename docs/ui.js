/**
 * UI-only helpers: drag/drop, labels, progress bar, list badges, empty state,
 * search/filter, per-row copy, CSV export, run history, global drop zone.
 * Does not modify Swagger/Postman parsing or comparison (see app.js).
 */
(function () {
  "use strict";

  /* ── helpers ─────────────────────────────────────────────────────────── */

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getActiveTabName() {
    var active = document.querySelector("[data-tab].active");
    return active ? active.getAttribute("data-tab") : "automated";
  }

  function tabToBadgeClass(tab) {
    if (tab === "automated") return "list-badge list-badge--green";
    if (tab === "missing") return "list-badge list-badge--red";
    return "list-badge list-badge--yellow";
  }

  /* ── copy helper ─────────────────────────────────────────────────────── */

  function copyText(text, btn) {
    if (!text) return;
    var promise;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      promise = navigator.clipboard.writeText(text);
    } else {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;left:-9999px;top:-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        promise = Promise.resolve();
      } catch (e) { return; }
    }
    if (btn) {
      var orig = btn.innerHTML;
      btn.innerHTML = "✓";
      btn.classList.add("copied");
      (promise || Promise.resolve()).then(function () {
        setTimeout(function () {
          btn.innerHTML = orig;
          btn.classList.remove("copied");
        }, 1400);
      }).catch(function () {});
    }
  }

  /* ── rich list rendering (badges + folder chip + copy button) ─────────── */

  var listObserver = new MutationObserver(function () {
    // Only re-render if content is plain text (no rich markup already set by TL_renderListFull)
    var el = document.getElementById("list-content");
    if (!el) return;
    if (el.querySelector(".list-badge--rich")) return;
    renderListBadges();
  });

  function renderListBadges() {
    var el = document.getElementById("list-content");
    if (!el) return;
    listObserver.disconnect();
    try {
      var raw = el.textContent || "";
      if (!raw.trim()) { el.innerHTML = ""; return; }
      var tab = getActiveTabName();
      var badgeClass = tabToBadgeClass(tab);
      el.innerHTML = raw.split("\n")
        .filter(function (l) { return l.length > 0; })
        .map(function (line) {
          return (
            '<span class="' + badgeClass + '">' + escapeHtml(line) + "</span>"
          );
        }).join("");
    } finally {
      listObserver.observe(el, { characterData: true, childList: true, subtree: true });
    }
  }

  /**
   * Full rich render: called by app.js via window.TL_renderListFull(pairs, tabName).
   * pairs = [[method, path, folder?], ...]
   */
  function renderListFull(pairs, tabName) {
    var el = document.getElementById("list-content");
    if (!el) return;
    listObserver.disconnect();
    try {
      var badgeClass = tabToBadgeClass(tabName || getActiveTabName());
      if (!pairs || !pairs.length) {
        el.innerHTML = '<span class="list-empty-hint">No entries for this category.</span>';
        return;
      }
      el.innerHTML = pairs.map(function (pair) {
        var method = escapeHtml(pair[0] || "");
        var path = escapeHtml(pair[1] || "");
        var folder = pair[2] ? escapeHtml(pair[2]) : "";
        var text = method + " " + path;
        return (
          '<span class="' + badgeClass + ' list-badge--rich">' +
            '<span class="list-badge__text">' + text + "</span>" +
            (folder ? '<span class="list-badge__folder">' + folder + "</span>" : "") +
            '<button type="button" class="list-badge__copy" aria-label="Copy ' + text + '" data-copy="' + escapeHtml(text) + '">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">' +
                '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
                '<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>' +
              "</svg>" +
            "</button>" +
          "</span>"
        );
      }).join("");
      // Wire per-row copy buttons
      el.querySelectorAll(".list-badge__copy").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          copyText(btn.getAttribute("data-copy"), btn);
        });
      });
    } finally {
      listObserver.observe(el, { characterData: true, childList: true, subtree: true });
    }
  }

  // Expose to app.js
  window.TL_renderListFull = renderListFull;

  function wireListObserver() {
    var el = document.getElementById("list-content");
    if (!el) return;
    listObserver.observe(el, { characterData: true, childList: true, subtree: true });
  }

  /* ── tab title sync ──────────────────────────────────────────────────── */

  function setListSectionTitle() {
    var title = document.getElementById("list-section-title");
    if (!title) return;
    var tab = getActiveTabName();
    var map = {
      automated: "Covered APIs",
      missing: "Missing APIs",
      unmatched: "Extra (Not in Swagger)",
    };
    title.textContent = map[tab] || "Details";
  }

  function wireTabTitleSync() {
    document.querySelectorAll("[data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        requestAnimationFrame(function () {
          setListSectionTitle();
          // rich render is triggered by setActiveTab in app.js; no need to re-render here
        });
      });
    });
    setListSectionTitle();
  }

  /* ── search / filter ─────────────────────────────────────────────────── */

  function wireSearchFilter() {
    var input = document.getElementById("list-search");
    var countEl = document.getElementById("list-search-count");
    if (!input) return;
    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      var badges = document.querySelectorAll("#list-content .list-badge");
      var visible = 0;
      badges.forEach(function (badge) {
        var textEl = badge.querySelector(".list-badge__text");
        var text = (textEl ? textEl.textContent : badge.textContent).toLowerCase();
        var show = !q || text.includes(q);
        badge.style.display = show ? "" : "none";
        if (show) visible++;
      });
      if (countEl) {
        countEl.textContent = q
          ? visible + " of " + badges.length + " shown"
          : "";
      }
    });
  }

  /* ── coverage progress bar ───────────────────────────────────────────── */

  function applyCoverageHeat(n) {
    var fill = document.getElementById("coverage-progress-fill");
    var cov = document.getElementById("m-coverage");
    var heatFill = "heat-low";
    if (n >= 70) heatFill = "heat-high";
    else if (n >= 40) heatFill = "heat-mid";
    if (fill) {
      fill.classList.remove("heat-low", "heat-mid", "heat-high");
      fill.classList.add(heatFill);
    }
    if (cov) {
      cov.classList.remove("coverage-heat-mid", "coverage-heat-high");
      if (n >= 70) cov.classList.add("coverage-heat-high");
      else if (n >= 40) cov.classList.add("coverage-heat-mid");
    }
  }

  function syncProgressBar() {
    var cov = document.getElementById("m-coverage");
    var fill = document.getElementById("coverage-progress-fill");
    var label = document.getElementById("coverage-progress-label");
    var bar = document.getElementById("coverage-progress");
    if (!cov || !fill) return;
    var t = cov.textContent.trim().replace("%", "");
    var n = parseFloat(t, 10);
    if (isNaN(n)) n = 0;
    n = Math.max(0, Math.min(100, n));
    fill.style.width = n + "%";
    applyCoverageHeat(n);
    if (label) label.textContent = cov.textContent.trim();
    if (bar) bar.setAttribute("aria-valuenow", String(Math.round(n)));
  }

  var coverageObserver = new MutationObserver(function () {
    syncProgressBar();
  });

  function wireCoverageObserver() {
    var cov = document.getElementById("m-coverage");
    if (!cov) return;
    coverageObserver.observe(cov, { characterData: true, childList: true, subtree: true });
    syncProgressBar();
  }

  /* ── empty state ─────────────────────────────────────────────────────── */

  function userHasStartedInputs() {
    var cf = document.getElementById("collection-file");
    var sf = document.getElementById("swagger-file");
    var url = document.getElementById("swagger-url");
    return !!(
      (cf && cf.files && cf.files.length) ||
      (sf && sf.files && sf.files.length) ||
      (url && (url.value || "").trim().length > 0)
    );
  }

  function syncEmptyState() {
    var results = document.getElementById("results");
    var empty = document.getElementById("empty-state");
    if (!results || !empty) return;
    if (!results.classList.contains("hidden")) {
      empty.classList.add("empty-state-hidden");
      empty.classList.remove("empty-state-visible");
      return;
    }
    if (userHasStartedInputs()) {
      empty.classList.add("empty-state-hidden");
      empty.classList.remove("empty-state-visible");
    } else {
      empty.classList.remove("empty-state-hidden");
      empty.classList.add("empty-state-visible");
    }
  }

  var lastReportDetail = null;

  function resetDownloadReportButton() {
    var btn = document.getElementById("download-report-btn");
    if (!btn) return;
    lastReportDetail = null;
    btn.classList.add("hidden");
    btn.disabled = true;
  }

  function syncEmptyStateAndReportButton() {
    syncEmptyState();
    var results = document.getElementById("results");
    if (!results) return;
    if (results.classList.contains("hidden")) {
      resetDownloadReportButton();
    }
  }

  var resultsObserver = new MutationObserver(function () {
    syncEmptyStateAndReportButton();
  });

  function wireResultsObserver() {
    var results = document.getElementById("results");
    if (!results) return;
    resultsObserver.observe(results, { attributes: true, attributeFilter: ["class"] });
    syncEmptyStateAndReportButton();
  }

  /* ── file labels ─────────────────────────────────────────────────────── */

  function setFileNameLabel(inputId, labelId) {
    var input = document.getElementById(inputId);
    var label = document.getElementById(labelId);
    if (!input || !label) return;
    var f = input.files && input.files[0];
    label.textContent = f ? f.name : "";
  }

  /* ── prevent defaults helper ─────────────────────────────────────────── */

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  /* ── URL validation ──────────────────────────────────────────────────── */

  function openApiUrlLooksLikeJsonUi(urlTrim) {
    if (!urlTrim) return true;
    try {
      var u = new URL(urlTrim);
      var path = u.pathname.toLowerCase();
      if (path.endsWith(".json")) return true;
      var fmt = u.searchParams.get("format");
      if (fmt && String(fmt).toLowerCase() === "json") return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  /* ── input panel state ───────────────────────────────────────────────── */

  function syncCoverageInputPanels() {
    var urlEl = document.getElementById("swagger-url");
    var wrap = document.getElementById("swagger-url-field-wrap");
    var errEl = document.getElementById("swagger-url-error");
    var swaggerPanel = document.getElementById("swagger-source-panel");
    var postmanPanel = document.getElementById("postman-source-panel");
    var swaggerFile = document.getElementById("swagger-file");
    var collFile = document.getElementById("collection-file");
    if (!urlEl || !wrap || !errEl || !swaggerPanel || !postmanPanel) return;

    var urlTrim = (urlEl.value || "").trim();
    var hasSwaggerFile = swaggerFile && swaggerFile.files && swaggerFile.files.length;
    var hasCollection = collFile && collFile.files && collFile.files.length;

    var urlInvalid = urlTrim.length > 0 && !openApiUrlLooksLikeJsonUi(urlTrim);
    if (urlInvalid) {
      wrap.classList.add("swagger-url-invalid");
      urlEl.setAttribute("aria-invalid", "true");
      errEl.textContent =
        "URL must end with .json (e.g. …/openapi.json) or use ?format=json — or clear the field and upload a file.";
      errEl.classList.remove("hidden");
    } else {
      wrap.classList.remove("swagger-url-invalid");
      urlEl.removeAttribute("aria-invalid");
      errEl.textContent = "";
      errEl.classList.add("hidden");
    }

    var swaggerOk =
      hasSwaggerFile ||
      (urlTrim.length > 0 && openApiUrlLooksLikeJsonUi(urlTrim));
    var ready = !!(hasCollection && swaggerOk && !urlInvalid);

    swaggerPanel.classList.toggle("panel-input-ready", ready);
    postmanPanel.classList.toggle("panel-input-ready", ready);

    syncStepHighlight(swaggerOk, hasCollection, urlInvalid, ready);
    syncEmptyState();
  }

  function syncStepHighlight(swaggerOk, hasCollection, urlInvalid, ready) {
    document.querySelectorAll("[data-step-card]").forEach(function (el) {
      el.classList.remove("step-card--active");
    });
    var step = "1";
    if (ready) step = "3";
    else if (swaggerOk && !urlInvalid) step = "2";
    var card = document.querySelector('[data-step-card="' + step + '"]');
    if (card) card.classList.add("step-card--active");
  }

  function wireCoverageInputPanels() {
    var urlEl = document.getElementById("swagger-url");
    var collFile = document.getElementById("collection-file");
    var debounceId = null;
    if (urlEl) {
      urlEl.addEventListener("input", function () {
        if (debounceId) clearTimeout(debounceId);
        debounceId = setTimeout(function () {
          debounceId = null;
          syncCoverageInputPanels();
        }, 200);
      });
      urlEl.addEventListener("blur", function () {
        if (debounceId) clearTimeout(debounceId);
        syncCoverageInputPanels();
      });
    }
    if (collFile) collFile.addEventListener("change", syncCoverageInputPanels);
    var swaggerFile = document.getElementById("swagger-file");
    if (swaggerFile) swaggerFile.addEventListener("change", syncCoverageInputPanels);
    syncCoverageInputPanels();
  }

  /* ── markdown report ─────────────────────────────────────────────────── */

  function buildMarkdownReport(d) {
    var pct = d.coveragePct.toFixed(2);
    var remPct = d.remainingPct.toFixed(2);
    var lines = [
      "# TestLens — API coverage report",
      "",
      "Generated: " + d.generatedAt,
      "",
      "## Summary",
      "",
      "| Metric | Value |",
      "| --- | --- |",
      "| Total APIs (Swagger) | " + d.totalApis + " |",
      "| Postman requests (total) | " + d.postmanRequestsTotal + " |",
      "| Matched to Swagger | " + d.matchedRequestCount + " |",
      "| Postman-only (not in Swagger) | " + d.unmatchedCount + " |",
      "| Covered (unique Swagger ops) | " + d.uniqueAutomated + " |",
      "| Missing from automation | " + d.remaining + " |",
      "| Coverage | " + pct + "% |",
      "| Remaining | " + remPct + "% |",
      "",
      "## Matched requests (Covered APIs)",
      "",
      "```",
      d.matchedText || "(none)",
      "```",
      "",
      "## Missing from automation",
      "",
      "```",
      d.missingText || "(none)",
      "```",
      "",
      "## Postman-only (not in Swagger)",
      "",
      "```",
      d.unmatchedText || "(none)",
      "```",
      "",
    ];
    return lines.join("\n");
  }

  function wireDownloadReport() {
    var btn = document.getElementById("download-report-btn");
    if (!btn) return;
    window.addEventListener("api-coverage-report", function (ev) {
      var d = ev.detail;
      if (!d) return;
      lastReportDetail = d;
      btn.classList.remove("hidden");
      btn.disabled = false;
    });
    btn.addEventListener("click", function () {
      if (!lastReportDetail) return;
      var md = buildMarkdownReport(lastReportDetail);
      var blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      var day = lastReportDetail.generatedAt.slice(0, 10);
      a.href = url;
      a.download = "api-coverage-report-" + day + ".md";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  /* ── CSV export ──────────────────────────────────────────────────────── */

  function buildCsvReport(d) {
    var rows = [["Method", "Path", "Status", "Postman Folder"]];
    (d.matchedRequests || []).forEach(function (pair) {
      rows.push([pair[0] || "", pair[1] || "", "covered", pair[2] || ""]);
    });
    (d.missingApis || []).forEach(function (pair) {
      rows.push([pair[0] || "", pair[1] || "", "missing", pair[2] || ""]);
    });
    (d.unmatchedRequests || []).forEach(function (pair) {
      rows.push([pair[0] || "", pair[1] || "", "extra (not in swagger)", pair[2] || ""]);
    });
    return rows.map(function (row) {
      return row.map(function (cell) {
        var s = String(cell).replace(/"/g, '""');
        return '"' + s + '"';
      }).join(",");
    }).join("\r\n");
  }

  function wireDownloadCsv() {
    var btn = document.getElementById("download-csv-btn");
    if (!btn) return;
    window.addEventListener("api-coverage-report", function (ev) {
      var d = ev.detail;
      if (!d) return;
      btn._lastDetail = d;
      btn.classList.remove("hidden");
      btn.disabled = false;
    });
    // Hide again when results disappear
    var results = document.getElementById("results");
    if (results) {
      new MutationObserver(function () {
        if (results.classList.contains("hidden")) {
          btn.classList.add("hidden");
          btn.disabled = true;
        }
      }).observe(results, { attributes: true, attributeFilter: ["class"] });
    }
    btn.addEventListener("click", function () {
      var d = btn._lastDetail;
      if (!d) return;
      var csv = buildCsvReport(d);
      var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      var day = (d.generatedAt || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = "api-coverage-" + day + ".csv";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  /* ── dashboard link ──────────────────────────────────────────────────── */

  function wireDashboardLink() {
    var links = [
      document.getElementById("open-dashboard-btn"),
      document.getElementById("open-printable-report-btn"),
    ].filter(Boolean);
    if (!links.length) return;

    function showLinks(show) {
      links.forEach(function (link) {
        link.classList.toggle("hidden", !show);
      });
    }

    window.addEventListener("api-coverage-report", function () {
      showLinks(true);
    });
    var form = document.getElementById("coverage-form");
    if (form) {
      form.addEventListener("submit", function () { showLinks(false); }, true);
    }
    var results = document.getElementById("results");
    if (results) {
      new MutationObserver(function () {
        if (results.classList.contains("hidden")) showLinks(false);
      }).observe(results, { attributes: true, attributeFilter: ["class"] });
    }
  }

  /* ── run history ─────────────────────────────────────────────────────── */

  function renderHistory() {
    var container = document.getElementById("run-history-list");
    var section = document.getElementById("run-history-section");
    if (!container) return;
    var history = [];
    try {
      history = JSON.parse(localStorage.getItem("testlens-run-history") || "[]");
    } catch (e) { history = []; }

    if (section) section.classList.toggle("hidden", history.length === 0);
    if (!history.length) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML = history.map(function (run) {
      var date = "";
      try { date = new Date(run.generatedAt).toLocaleString(); } catch (e) {}
      var pct = typeof run.coveragePct === "number" ? run.coveragePct : 0;
      var heat = pct >= 70 ? "heat-high" : pct >= 40 ? "heat-mid" : "heat-low";
      return (
        '<div class="history-run">' +
          '<span class="history-run__date">' + escapeHtml(date) + "</span>" +
          '<span class="history-run__metrics">' +
            '<span class="history-run__pct ' + heat + '">' + pct.toFixed(1) + "%</span>" +
            '<span class="history-run__detail">' +
              run.covered + " covered · " + run.missing + " missing · " + run.totalApis + " total" +
            "</span>" +
          "</span>" +
        "</div>"
      );
    }).join("");
  }

  function wireHistory() {
    renderHistory();
    window.addEventListener("testlens-history-updated", renderHistory);
    var toggle = document.getElementById("history-toggle");
    var panel = document.getElementById("history-panel");
    if (toggle && panel) {
      toggle.addEventListener("click", function () {
        var hidden = panel.classList.toggle("hidden");
        toggle.setAttribute("aria-expanded", String(!hidden));
        if (!hidden) renderHistory();
      });
    }
  }

  /* ── drop toast ──────────────────────────────────────────────────────── */

  var _dropToastTimer = null;

  function showDropToast(msg) {
    var toast = document.getElementById("drop-toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.remove("hidden", "drop-toast--hide");
    toast.classList.add("drop-toast--show");
    if (_dropToastTimer) clearTimeout(_dropToastTimer);
    _dropToastTimer = setTimeout(function () {
      toast.classList.remove("drop-toast--show");
      toast.classList.add("drop-toast--hide");
      setTimeout(function () { toast.classList.add("hidden"); }, 350);
    }, 2600);
  }

  /* ── global drop zone (auto-detect file type) ─────────────────────────── */

  function detectAndAssignFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); } catch (e) {
        showDropToast("⚠ That file doesn't look like valid JSON.");
        return;
      }
      var isOpenApi = !!(
        parsed.paths ||
        typeof parsed.openapi === "string" ||
        typeof parsed.swagger === "string"
      );
      var isPostman = !!(parsed.info && parsed.item && Array.isArray(parsed.item));
      var targetId, labelId, msg;
      if (isOpenApi && !isPostman) {
        targetId = "swagger-file";
        labelId = "swagger-file-name";
        msg = "✓ OpenAPI spec detected — assigned to the left panel";
      } else if (isPostman) {
        targetId = "collection-file";
        labelId = "collection-file-name";
        msg = "✓ Postman collection detected — assigned to the right panel";
      } else {
        showDropToast("⚠ Could not detect file type. Drop it on the correct panel manually.");
        return;
      }
      var input = document.getElementById(targetId);
      if (!input) return;
      try {
        var ndt = new DataTransfer();
        ndt.items.add(file);
        input.files = ndt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) { /* Safari fallback */ }
      setFileNameLabel(targetId, labelId);
      syncCoverageInputPanels();
      showDropToast(msg);
    };
    reader.readAsText(file);
  }

  function wireGlobalDropZone() {
    var form = document.getElementById("coverage-form");
    if (!form) return;
    ["dragenter", "dragover", "dragleave", "drop"].forEach(function (ev) {
      form.addEventListener(ev, preventDefaults, false);
    });
    form.addEventListener("dragover", function () {
      form.classList.add("form-dragover");
    });
    form.addEventListener("dragleave", function (e) {
      if (!form.contains(e.relatedTarget)) {
        form.classList.remove("form-dragover");
      }
    });
    form.addEventListener("drop", function (e) {
      form.classList.remove("form-dragover");
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      // Let individual drop zones handle their own drops
      var tgt = e.target;
      if (
        tgt.closest && (
          tgt.closest("#swagger-drop-zone") ||
          tgt.closest("#collection-drop-zone")
        )
      ) return;
      for (var i = 0; i < files.length; i++) {
        detectAndAssignFile(files[i]);
      }
    });
  }

  /* ── individual drop zones ───────────────────────────────────────────── */

  function wireDropZone(zoneId, inputId, labelId) {
    var zone = document.getElementById(zoneId);
    var input = document.getElementById(inputId);
    if (!zone || !input) return;

    ["dragenter", "dragover", "dragleave", "drop"].forEach(function (ev) {
      zone.addEventListener(ev, preventDefaults, false);
    });
    zone.addEventListener("dragenter", function () { zone.classList.add("is-dragover"); });
    zone.addEventListener("dragleave", function () { zone.classList.remove("is-dragover"); });
    zone.addEventListener("drop", function (e) {
      zone.classList.remove("is-dragover");
      var dt = e.dataTransfer;
      if (!dt || !dt.files || !dt.files.length) return;
      var file = dt.files[0];
      try {
        var ndt = new DataTransfer();
        ndt.items.add(file);
        input.files = ndt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (err) { /* Safari */ }
      setFileNameLabel(inputId, labelId);
      syncCoverageInputPanels();
    });
    input.addEventListener("change", function () {
      setFileNameLabel(inputId, labelId);
      syncCoverageInputPanels();
    });
  }

  /* ── init ────────────────────────────────────────────────────────────── */

  document.addEventListener("DOMContentLoaded", function () {
    wireDropZone("swagger-drop-zone", "swagger-file", "swagger-file-name");
    wireDropZone("collection-drop-zone", "collection-file", "collection-file-name");
    setFileNameLabel("swagger-file", "swagger-file-name");
    setFileNameLabel("collection-file", "collection-file-name");

    wireCoverageInputPanels();
    wireDownloadReport();
    wireDownloadCsv();
    wireDashboardLink();
    wireListObserver();
    wireTabTitleSync();
    wireCoverageObserver();
    wireResultsObserver();
    wireSearchFilter();
    wireHistory();
    wireGlobalDropZone();
  });
})();
