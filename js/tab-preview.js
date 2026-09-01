(() => {
  "use strict";

  const { $ } = OC.util;
  const { formatDateTime } = OC.util;
  const { escapeHtml, safeText, getLatestRpmAttempt } = OC;

  function paperField(label, value) {
    return `<div class="paper-field"><small>${label}</small><strong>${escapeHtml(safeText(value))}</strong></div>`;
  }

  function emptyOrder() {
    return {
      date: "", mechanic: "", machine: "", articulo: "", lote: "", fromNe: "", toNe: "", shift: "",
      startTime: "", endTime: "", supervisor: "", status: "", observations: "",
      productionControl: "", rpmMechanic: "", metersMinute: "", assistantDT: "",
      rpmMeasured: "", rpmValidationAttempts: [], laboratoryReceipts: [],
      signatures: { SUPERVISOR: [], MECANICO: [], PCP: [], LABORATORIO: [] },
      code: "", updatedAt: ""
    };
  }

  function renderPreview(order) {
    $("previewEmptyBanner")?.classList.toggle("hidden", !!order);
    const data = order || emptyOrder();

    $("previewGeneral").innerHTML = [
      paperField("Fecha", data.date),
      paperField("Mecánico", data.mechanic),
      paperField("Máquina", data.machine),
      paperField("Artículo", data.articulo),
      paperField("Lote", data.lote),
      paperField("De Ne", data.fromNe),
      paperField("A Ne", data.toNe),
      paperField("Turno", data.shift)
    ].join("");

    $("previewTimes").innerHTML = [
      paperField("Empezó el cambio", data.startTime),
      paperField("Terminó el cambio", data.endTime),
      paperField("Jefe de turno", data.supervisor),
      paperField("Revisión", OC.ORDER_STATUS_META[data.status]?.label || data.status)
    ].join("");

    $("previewObservation").textContent = safeText(data.observations);

    const metrics = [
      ["Control de producción", data.productionControl],
      ["RPM Cil. Frontal", data.rpmMechanic],
      ["Mts / Min", data.metersMinute],
      ["Asistente D.T.", data.assistantDT]
    ];
    $("previewMetrics").innerHTML = metrics.map(([label, val]) => `
      <div class="paper-metric"><small>${label}</small><strong>${escapeHtml(safeText(val))}</strong></div>
    `).join("");

    const latest = getLatestRpmAttempt(data);
    const lastReceipt = data.laboratoryReceipts[data.laboratoryReceipts.length - 1];
    $("previewValidation").innerHTML = [
      paperField("RPM medida", data.rpmMeasured),
      paperField("Decisión RPM", latest?.decision || ""),
      paperField("Laboratorio", lastReceipt ? `Recibido ${formatDateTime(lastReceipt.timestamp)}` : "Pendiente")
    ].join("");

    const sigLabels = {
      SUPERVISOR: "Supervisor de Turno",
      MECANICO: "Mecánico",
      PCP: "PCP Hilandería",
      LABORATORIO: "Laboratorio"
    };
    $("previewSignatures").innerHTML = Object.entries(sigLabels).map(([key, label]) => {
      const list = data.signatures[key] || [];
      const s = list[list.length - 1];
      return `
        <div class="paper-sign">
          <strong>${escapeHtml(s?.name || "Pendiente de firma")}</strong>
          <small>${label}</small>
          <small>${s ? formatDateTime(s.timestamp) : "Sin fecha"}</small>
        </div>`;
    }).join("");

    $("previewFooter").innerHTML = order
      ? `<span>${escapeHtml(data.code)} · ${escapeHtml(OC.ORDER_STATUS_META[data.status]?.label || data.status)}</span>
         <span>Última actualización: ${formatDateTime(data.updatedAt)}</span>`
      : `<span>Sin orden abierta</span><span>—</span>`;
  }

  function init() {
    $("previewEditBtn").addEventListener("click", () => OC.setTab("fill"));
  }

  OC.tabPreview = { init, renderPreview };
})();
