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
    if (!saved) {
      return {
        totalSwagger: DEFAULT.totalSwagger,
        totalPostman: DEFAULT.totalPostman,
        covered: DEFAULT.covered,
        missing: DEFAULT.missing,
        coveragePct: DEFAULT.coveragePct,
        generatedAt: null,
        rows: [],
      };
    }
    return {
      totalSwagger:
        typeof saved.totalSwagger === "number"
          ? saved.totalSwagger
          : DEFAULT.totalSwagger,
      totalPostman:
        typeof saved.totalPostman === "number"
          ? saved.totalPostman
          : DEFAULT.totalPostman,
      covered:
        typeof saved.covered === "number" ? saved.covered : DEFAULT.covered,
      missing:
        typeof saved.missing === "number" ? saved.missing : DEFAULT.missing,
      coveragePct:
        typeof saved.coveragePct === "number"
          ? saved.coveragePct
          : DEFAULT.coveragePct,
      generatedAt: saved.generatedAt || null,
      rows: Array.isArray(saved.rows) ? saved.rows : [],
    };
  }

  function formatPct(n) {
    return (Math.round(n * 100) / 100).toFixed(2) + "%";
  }

  function renderInsights(el, d) {
    el.innerHTML = "";
    var pct = d.coveragePct;
    var items = [];

    if (pct < 50) {
      items.push({
        text:
          "Coverage is low (" +
          formatPct(pct) +
          "). Improvement needed.",
        kind: "danger",
      });
    } else if (pct < 80) {
      items.push({
        text:
          "Coverage is moderate (" +
          formatPct(pct) +
          "). Room to add more operations to the collection.",
        kind: "warn",
      });
    } else {
      items.push({
        text:
          "Strong alignment (" +
          formatPct(pct) +
          ") between Swagger and the Postman collection.",
        kind: "",
      });
    }

    items.push({
      text: d.missing + " APIs missing from Postman.",
      kind: d.missing > 0 ? "danger" : "",
    });

    if (d.totalPostman > d.totalSwagger) {
      items.push({
        text:
          "Postman has " +
          (d.totalPostman - d.totalSwagger) +
          " more request(s) than Swagger operations — some may be extras or duplicates.",
        kind: "warn",
      });
    }

    items.forEach(function (item) {
      var li = document.createElement("li");
      li.className = "insights__item" + (item.kind ? " insights__item--" + item.kind : "");
      li.textContent = item.text;
      el.appendChild(li);
    });
  }

  function renderTable(tbody, rows, filter) {
    tbody.innerHTML = "";
    if (!rows || !rows.length) {
      var trp = document.createElement("tr");
      trp.className = "row-placeholder";
      var tdp = document.createElement("td");
      tdp.colSpan = 3;
      tdp.textContent =
        "No operations loaded. Run Compare on the main TestLens page, then reopen this dashboard.";
      trp.appendChild(tdp);
      tbody.appendChild(trp);
      return;
    }
    rows.forEach(function (r) {
      if (filter === "covered" && r.status !== "covered") return;
      if (filter === "missing" && r.status !== "missing") return;

      var tr = document.createElement("tr");
      tr.className = r.status === "covered" ? "row-covered" : "row-missing";

      var tdM = document.createElement("td");
      tdM.className = "cell-method";
      tdM.textContent = r.method;

      var tdP = document.createElement("td");
      tdP.className = "cell-path";
      tdP.textContent = r.path;

      var tdS = document.createElement("td");
      var badge = document.createElement("span");
      badge.className =
        "badge " +
        (r.status === "covered" ? "badge--covered" : "badge--missing");
      badge.textContent = r.status === "covered" ? "Covered" : "Missing";
      tdS.appendChild(badge);

      tr.appendChild(tdM);
      tr.appendChild(tdP);
      tr.appendChild(tdS);
      tbody.appendChild(tr);
    });
  }

  var pieChart = null;
  var barChart = null;

  function buildCharts(d) {
    var Chart = window.Chart;
    if (!Chart) return;
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
    Chart.defaults.color = "#94a3b8";

    var green = "#22c55e";
    var red = "#ef4444";
    var indigo = "#6366f1";
    var cyan = "#22d3ee";

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
              backgroundColor: [green, red],
              borderWidth: 0,
              hoverOffset: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: { color: "#94a3b8", padding: 16, font: { family: "Inter" } },
            },
          },
          cutout: "62%",
        },
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
              backgroundColor: [indigo, cyan],
              borderRadius: 8,
              borderSkipped: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
          },
          scales: {
            x: {
              ticks: { color: "#94a3b8", font: { family: "Inter", size: 11 } },
              grid: { display: false },
            },
            y: {
              beginAtZero: true,
              ticks: { color: "#94a3b8", font: { family: "Inter" } },
              grid: { color: "rgba(148,163,184,0.1)" },
            },
          },
        },
      });
    }

    var fill = document.getElementById("progress-fill");
    var bar = document.getElementById("progress-bar");
    var lbl = document.getElementById("progress-label");
    if (fill && bar && lbl) {
      var p = Math.min(100, Math.max(0, d.coveragePct));
      bar.setAttribute("aria-valuenow", String(Math.round(p)));
      lbl.textContent = formatPct(d.coveragePct);
      requestAnimationFrame(function () {
        fill.style.width = p + "%";
      });
    }
  }

  function init() {
    var d = mergeData();

    document.getElementById("card-total").textContent = String(d.totalSwagger);
    document.getElementById("card-covered").textContent = String(d.covered);
    document.getElementById("card-missing").textContent = String(d.missing);
    document.getElementById("card-coverage").textContent = formatPct(d.coveragePct);

    var meta = document.getElementById("report-meta");
    if (meta) {
      if (d.generatedAt) {
        try {
          meta.textContent =
            "Data from TestLens run · " +
            new Date(d.generatedAt).toLocaleString();
        } catch (e) {
          meta.textContent = "";
        }
      } else {
        meta.textContent =
          "No saved run — cards show sample totals only. Run Compare on the main page, then refresh.";
      }
    }

    renderInsights(document.getElementById("insights-list"), d);

    var tbody = document.getElementById("table-body");
    var foot = document.getElementById("table-footnote");
    var currentFilter = "all";

    function applyFilter(f) {
      currentFilter = f;
      renderTable(tbody, d.rows, f);
      var visible = tbody.querySelectorAll("tr").length;
      if (foot) {
        foot.textContent =
          "Showing " +
          visible +
          " row(s)" +
          (f !== "all" ? " (" + f + " filter)" : "") +
          ".";
      }
    }

    document.querySelectorAll(".filter-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".filter-btn").forEach(function (b) {
          b.classList.remove("active");
        });
        btn.classList.add("active");
        applyFilter(btn.getAttribute("data-filter") || "all");
      });
    });

    applyFilter("all");
    buildCharts(d);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
