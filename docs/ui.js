/**
 * UI-only helpers: drag/drop, labels, progress bar, list badges, empty state.
 * Does not modify Swagger/Postman parsing or comparison (see app.js).
 */
(function () {
  "use strict";

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

  var listObserver = new MutationObserver(function () {
    renderListBadges();
  });

  function renderListBadges() {
    var el = document.getElementById("list-content");
    if (!el) return;
    listObserver.disconnect();
    try {
      var raw = "";
      if (el.querySelector(".list-badge")) {
        raw = Array.prototype.slice
          .call(el.querySelectorAll(".list-badge"))
          .map(function (s) {
            return s.textContent;
          })
          .join("\n");
      } else {
        raw = el.textContent;
      }
      if (!raw || !raw.trim()) {
        el.innerHTML = "";
        return;
      }
      var tab = getActiveTabName();
      var badgeClass = tabToBadgeClass(tab);
      var lines = raw.split("\n").filter(function (line) {
        return line.length > 0;
      });
      el.innerHTML = lines
        .map(function (line) {
          return (
            '<span class="' +
            badgeClass +
            '">' +
            escapeHtml(line) +
            "</span>"
          );
        })
        .join("");
    } finally {
      listObserver.observe(el, {
        characterData: true,
        childList: true,
        subtree: true,
      });
    }
  }

  function wireListObserver() {
    var el = document.getElementById("list-content");
    if (!el) return;
    listObserver.observe(el, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

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
          renderListBadges();
        });
      });
    });
    setListSectionTitle();
  }

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
    coverageObserver.observe(cov, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    syncProgressBar();
  }

  function userHasStartedInputs() {
    var cf = document.getElementById("collection-file");
    var sf = document.getElementById("swagger-file");
    var url = document.getElementById("swagger-url");
    var hasColl = cf && cf.files && cf.files.length;
    var hasS = sf && sf.files && sf.files.length;
    var hasUrl = url && (url.value || "").trim().length > 0;
    return !!(hasColl || hasS || hasUrl);
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
    resultsObserver.observe(results, {
      attributes: true,
      attributeFilter: ["class"],
    });
    syncEmptyStateAndReportButton();
  }

  function setFileNameLabel(inputId, labelId) {
    var input = document.getElementById(inputId);
    var label = document.getElementById(labelId);
    if (!input || !label) return;
    var f = input.files && input.files[0];
    label.textContent = f ? f.name : "";
  }

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  /** Same rules as app.js openApiUrlLooksLikeJson for non-empty URLs. */
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
    var hasSwaggerFile =
      swaggerFile && swaggerFile.files && swaggerFile.files.length;
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
    if (collFile) {
      collFile.addEventListener("change", syncCoverageInputPanels);
    }
    var swaggerFile = document.getElementById("swagger-file");
    if (swaggerFile) {
      swaggerFile.addEventListener("change", syncCoverageInputPanels);
    }
    syncCoverageInputPanels();
  }

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
      var blob = new Blob([md], {
        type: "text/markdown;charset=utf-8",
      });
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
      form.addEventListener(
        "submit",
        function () {
          showLinks(false);
        },
        true
      );
    }
    var results = document.getElementById("results");
    if (results) {
      new MutationObserver(function () {
        if (results.classList.contains("hidden")) {
          showLinks(false);
        }
      }).observe(results, { attributes: true, attributeFilter: ["class"] });
    }
  }

  function wireDropZone(zoneId, inputId, labelId) {
    var zone = document.getElementById(zoneId);
    var input = document.getElementById(inputId);
    if (!zone || !input) return;

    ["dragenter", "dragover", "dragleave", "drop"].forEach(function (ev) {
      zone.addEventListener(ev, preventDefaults, false);
    });

    zone.addEventListener("dragenter", function () {
      zone.classList.add("is-dragover");
    });
    zone.addEventListener("dragleave", function () {
      zone.classList.remove("is-dragover");
    });
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
      } catch (err) {
        /* Safari / older: DataTransfer may be limited */
      }
      setFileNameLabel(inputId, labelId);
      syncCoverageInputPanels();
    });

    input.addEventListener("change", function () {
      setFileNameLabel(inputId, labelId);
      syncCoverageInputPanels();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    wireDropZone("swagger-drop-zone", "swagger-file", "swagger-file-name");
    wireDropZone(
      "collection-drop-zone",
      "collection-file",
      "collection-file-name"
    );
    setFileNameLabel("swagger-file", "swagger-file-name");
    setFileNameLabel("collection-file", "collection-file-name");

    wireCoverageInputPanels();
    wireDownloadReport();
    wireDashboardLink();
    wireListObserver();
    wireTabTitleSync();
    wireCoverageObserver();
    wireResultsObserver();
  });
})();
