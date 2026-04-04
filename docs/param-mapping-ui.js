/**
 * Path parameter mapping UI only — builds rows and exposes read API for future use.
 * Does not modify comparison or parsing (see app.js).
 *
 * TODO: Use these mappings in comparison logic for advanced matching
 */
(function () {
  "use strict";

  var rowsContainer;
  var templateEl;
  var dupWarningEl;

  function normalizeParamToken(s) {
    return String(s || "")
      .trim()
      .replace(/^\{+/, "")
      .replace(/\}+$/, "");
  }

  function getPathParameterMappings() {
    var out = {};
    if (!rowsContainer) return out;
    var rows = rowsContainer.querySelectorAll(".param-mapping-row");
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var swEl = row.querySelector(".param-mapping-swagger");
      var pmEl = row.querySelector(".param-mapping-postman");
      if (!swEl || !pmEl) continue;
      var sw = normalizeParamToken(swEl.value);
      var pm = normalizeParamToken(pmEl.value);
      if (sw && pm) out[sw] = pm;
    }
    return out;
  }

  function updateDuplicateWarning() {
    if (!dupWarningEl || !rowsContainer) return;
    var seen = Object.create(null);
    var dup = false;
    var dupKey = "";
    var rows = rowsContainer.querySelectorAll(".param-mapping-row");
    for (var i = 0; i < rows.length; i++) {
      var swEl = rows[i].querySelector(".param-mapping-swagger");
      if (!swEl) continue;
      var sw = normalizeParamToken(swEl.value);
      if (!sw) continue;
      if (seen[sw]) {
        dup = true;
        dupKey = sw;
        break;
      }
      seen[sw] = true;
    }
    if (dup) {
      dupWarningEl.textContent =
        'Duplicate Swagger parameter "' +
        dupKey +
        '" appears in more than one row. Only one mapping per Swagger name is used when this is wired in.';
      dupWarningEl.classList.remove("hidden");
    } else {
      dupWarningEl.textContent = "";
      dupWarningEl.classList.add("hidden");
    }
  }

  function addRow() {
    if (!templateEl || !rowsContainer) return;
    var node = templateEl.content.cloneNode(true);
    rowsContainer.appendChild(node);
    updateDuplicateWarning();
  }

  function removeRow(row) {
    if (!row || !rowsContainer) return;
    row.remove();
    updateDuplicateWarning();
  }

  function init() {
    rowsContainer = document.getElementById("param-mapping-rows");
    templateEl = document.getElementById("param-mapping-row-template");
    dupWarningEl = document.getElementById("param-mapping-dup-warning");
    var addBtn = document.getElementById("param-mapping-add");

    if (!rowsContainer || !templateEl) return;

    window.getPathParameterMappings = getPathParameterMappings;

    addRow();

    if (addBtn) {
      addBtn.addEventListener("click", function () {
        addRow();
      });
    }

    rowsContainer.addEventListener("click", function (e) {
      var btn = e.target.closest(".param-mapping-remove");
      if (!btn) return;
      var row = e.target.closest(".param-mapping-row");
      if (row) removeRow(row);
    });

    rowsContainer.addEventListener("input", function () {
      updateDuplicateWarning();
    });
    rowsContainer.addEventListener("change", function () {
      updateDuplicateWarning();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
