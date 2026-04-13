(function () {
  "use strict";

  var DEFAULT = {
    totalSwagger: 282,
    totalPostman: 386,
    covered: 113,
    missing: 169,
    coveragePct: 40.07,
    generatedAt: null,
    rows: null,
  };

  var pieChart = null;
  var barChart = null;

  function loadPayload() {
    try {
      var raw =
        localStorage.getItem("testlens-dashboard") ||
        sessionStorage.getItem("testlens-dashboard");
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function mergeData() {
    var saved = loadPayload();
    var d = {
      totalSwagger: DEFAULT.totalSwagger,
      totalPostman: DEFAULT.totalPostman,
      covered: DEFAULT.covered,
      missing: DEFAULT.missing,
      coveragePct: DEFAULT.coveragePct,
      generatedAt: null,
      rows: [],
    };
    if (saved) {
      if (typeof saved.totalSwagger === "number") d.totalSwagger = saved.totalSwagger;
      if (typeof saved.totalPostman === "number") d.totalPostman = saved.totalPostman;
      if (typeof saved.covered === "number") d.covered = saved.covered;
      if (typeof saved.missing === "number") d.missing = saved.missing;
      if (typeof saved.coveragePct === "number") d.coveragePct = saved.coveragePct;
      if (saved.generatedAt) d.generatedAt = saved.generatedAt;
      if (Array.isArray(saved.rows) && saved.rows.length) d.rows = saved.rows;
    }
    return d;
  }

  function formatPct(n) {
    return (Math.round(n * 100) / 100).toFixed(2) + "%";
  }

  function renderMeta(d) {
    var el = document.getElementById("report-meta");
    if (!el) return;
    if (d.generatedAt) {
      try {
        el.textContent =
          "Generated " + new Date(d.generatedAt).toLocaleString();
      } catch (e) {
        el.textContent = "";
      }
    } else {
      el.textContent =
        "No saved run — summary numbers are placeholders. Run Compare on the main TestLens page, then reopen this report.";
    }
  }

  function renderInsights(el, d) {
    el.innerHTML = "";
    var pct = d.coveragePct;
    function add(text, cls) {
      var li = document.createElement("li");
      li.textContent = text;
      if (cls) li.className = cls;
      el.appendChild(li);
    }
    if (pct < 50) {
      add(
        "Coverage is low (" + formatPct(pct) + "). Improvement needed.",
        "danger"
      );
    } else if (pct < 80) {
      add(
        "Coverage is moderate (" + formatPct(pct) + "). Consider adding more collection requests.",
        "warn"
      );
    } else {
      add(
        "Coverage is strong (" + formatPct(pct) + ") between Swagger and Postman."
      );
    }
    add(d.missing + " APIs missing from Postman.", d.missing > 0 ? "danger" : "");
    if (d.totalPostman > d.totalSwagger) {
      add(
        "Postman includes more requests (" +
          d.totalPostman +
          ") than Swagger operations (" +
          d.totalSwagger +
          "); some may be extras.",
        "warn"
      );
    }
  }

  function renderTable(tbody, rows) {
    tbody.innerHTML = "";
    if (!rows || !rows.length) {
      var tr0 = document.createElement("tr");
      tr0.className = "row-placeholder";
      var td0 = document.createElement("td");
      td0.colSpan = 3;
      td0.textContent =
        "No operations loaded. Run Compare on the main TestLens page first, then open Chart PDF report again so your real Swagger paths appear here (saved in this browser).";
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
      return;
    }
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.className = r.status === "covered" ? "row-covered" : "row-missing";
      var td1 = document.createElement("td");
      td1.textContent = r.method;
      var td2 = document.createElement("td");
      td2.className = "mono";
      td2.textContent = r.path;
      var td3 = document.createElement("td");
      var b = document.createElement("span");
      b.className =
        "badge " +
        (r.status === "covered" ? "badge-covered" : "badge-missing");
      b.textContent = r.status === "covered" ? "Covered" : "Missing";
      td3.appendChild(b);
      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tbody.appendChild(tr);
    });
  }

  var chartOpts = {
    animation: false,
    responsive: true,
    maintainAspectRatio: false,
  };

  function buildCharts(d) {
    var Chart = window.Chart;
    if (!Chart) return;
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";

    var pieCtx = document.getElementById("chart-pie");
    if (pieCtx) {
      if (pieChart) pieChart.destroy();
      pieChart = new Chart(pieCtx, {
        type: "doughnut",
        data: {
          labels: ["Covered", "Missing"],
          datasets: [
            {
              data: [d.covered, d.missing],
              backgroundColor: ["#16a34a", "#dc2626"],
              borderWidth: 2,
              borderColor: "#ffffff",
            },
          ],
        },
        options: Object.assign({}, chartOpts, {
          plugins: {
            legend: {
              position: "bottom",
              labels: { padding: 12, font: { size: 11 } },
            },
          },
          cutout: "55%",
        }),
      });
    }

    var barCtx = document.getElementById("chart-bar");
    if (barCtx) {
      if (barChart) barChart.destroy();
      barChart = new Chart(barCtx, {
        type: "bar",
        data: {
          labels: ["Swagger APIs", "Postman APIs"],
          datasets: [
            {
              label: "Count",
              data: [d.totalSwagger, d.totalPostman],
              backgroundColor: ["#4f46e5", "#0891b2"],
              borderRadius: 6,
            },
          ],
        },
        options: Object.assign({}, chartOpts, {
          plugins: { legend: { display: false } },
          scales: {
            x: {
              ticks: { font: { size: 11 } },
              grid: { display: false },
            },
            y: {
              beginAtZero: true,
              ticks: { font: { size: 10 } },
              grid: { color: "rgba(0,0,0,0.06)" },
            },
          },
        }),
      });
    }
  }

  /**
   * Tall screenshot → multi-page A4 PDF (portrait, mm).
   * Slices the canvas into one image per page (all drawn at y=0). Using a single
   * huge image with negative Y offsets breaks many PDF viewers (streaks/tearing
   * when scrolling).
   */
  function addCanvasToPdf(canvas, fileName) {
    var root = window.jspdf;
    var JsPDF = root && (root.jsPDF || (root.default && root.default.jsPDF));
    if (!JsPDF) throw new Error("jsPDF not loaded");

    var pdf = new JsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
    });

    var pageW = pdf.internal.pageSize.getWidth();
    var pageH = pdf.internal.pageSize.getHeight();

    var cw = canvas.width;
    var ch = canvas.height;
    if (cw < 1 || ch < 1) throw new Error("Empty canvas");

    var imgHeightMm = (ch / cw) * pageW;
    var idealSlicePx = (pageH / imgHeightMm) * ch;
    var slice = document.createElement("canvas");
    slice.width = cw;
    var sctx = slice.getContext("2d");

    var yPx = 0;
    var first = true;
    while (yPx < ch) {
      var remaining = ch - yPx;
      var h = Math.min(
        remaining,
        Math.max(1, Math.floor(idealSlicePx))
      );
      slice.height = h;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, cw, h);
      sctx.drawImage(canvas, 0, yPx, cw, h, 0, 0, cw, h);

      var sliceHmm = (h / cw) * pageW;
      var imgData = slice.toDataURL("image/png", 1.0);

      if (!first) pdf.addPage();
      first = false;
      pdf.addImage(imgData, "PNG", 0, 0, pageW, sliceHmm);
      yPx += h;
    }

    pdf.save(fileName);
  }

  function runPdfExport() {
    var btn = document.getElementById("btn-download-pdf");
    var status = document.getElementById("pdf-status");
    var capture = document.getElementById("report-capture");

    if (!capture || !window.html2canvas) {
      alert("html2canvas failed to load.");
      return;
    }

    btn.disabled = true;
    if (status) status.textContent = "Preparing chart snapshot and PDF…";

    window.scrollTo(0, 0);

    var done = function (msg) {
      btn.disabled = false;
      if (status) status.textContent = msg || "";
    };

    document.fonts.ready
      .then(function () {
        return new Promise(function (r) {
          window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () {
              window.setTimeout(r, 200);
            });
          });
        });
      })
      .then(function () {
        var w = Math.max(1, capture.scrollWidth);
        var h = Math.max(1, capture.scrollHeight);
        var maxDim = 8192;
        var scale = 2;
        if (w * scale > maxDim) scale = maxDim / w;
        if (h * scale > maxDim) scale = Math.min(scale, maxDim / h);
        return html2canvas(capture, {
          scale: scale,
          useCORS: true,
          allowTaint: false,
          backgroundColor: "#ffffff",
          logging: false,
          foreignObjectRendering: false,
          windowWidth: capture.scrollWidth,
          windowHeight: capture.scrollHeight,
        });
      })
      .then(function (canvas) {
        var day = new Date().toISOString().slice(0, 10);
        addCanvasToPdf(canvas, "testlens-coverage-report-" + day + ".pdf");
        done("PDF downloaded.");
        window.setTimeout(function () {
          done("");
        }, 4000);
      })
      .catch(function (err) {
        console.error(err);
        done("");
        alert(
          "Could not create PDF: " + (err && err.message ? err.message : err)
        );
      });
  }

  function init() {
    var d = mergeData();

    document.getElementById("val-total").textContent = String(d.totalSwagger);
    document.getElementById("val-covered").textContent = String(d.covered);
    document.getElementById("val-missing").textContent = String(d.missing);
    document.getElementById("val-coverage").textContent = formatPct(d.coveragePct);

    renderMeta(d);
    renderInsights(document.getElementById("insights-list"), d);
    renderTable(document.getElementById("table-body"), d.rows);
    buildCharts(d);

    document
      .getElementById("btn-download-pdf")
      .addEventListener("click", runPdfExport);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
