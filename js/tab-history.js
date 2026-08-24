(() => {
  "use strict";

  const { $, formatDateTime } = OC.util;
  const { state, PROFILE_LABELS, ORDER_STATUS_META, escapeHtml, dataAdapter, describeApiError } = OC;

  // Mapea cada ACCION real del historial (tal como la escribe code.gs) a qué significa
  // en términos de "recibió / firmó / envió". No inventa eventos: solo reetiqueta los
  // que ya existen en TRANS_HISTORIAL.
  const ACCION_META = {
    ORDEN_CREADA: { kinds: ["recibe"], label: "Creó la orden" },
    FIRMA_SUPERVISOR: { kinds: ["firma"], label: "Firmó" },
    ENVIADA_A_MECANICO: { kinds: ["envia"], label: "Envió a Mecánico" },
    REGULACION_INICIADA: { kinds: ["recibe"], label: "Recibió e inició regulación" },
    FIRMA_MECANICO: { kinds: ["firma", "envia"], label: "Firmó y envió a validación RPM" },
    RPM_CORREGIDA: { kinds: ["firma", "envia"], label: "Firmó corrección de RPM y reenvió a PCP" },
    RPM_APROBADA: { kinds: ["firma", "envia"], label: "Aprobó RPM y envió a Laboratorio" },
    RPM_RECHAZADA: { kinds: ["firma", "envia"], label: "Rechazó RPM y devolvió a Mecánico" },
    CIERRE_MAX_RECHAZOS_RPM: { kinds: ["firma"], label: "Cerró la orden por máximo de rechazos de RPM" },
    LABO_RECEPCION: { kinds: ["recibe", "firma"], label: "Recibió y firmó" },
    LABO_RECEPCION_CORRECCION: { kinds: ["recibe", "firma"], label: "Recibió la corrección y firmó" },
    LIMPIEZA_APROBADA: { kinds: ["firma", "envia"], label: "Aprobó limpieza y envió a cierre" },
    LIMPIEZA_RECHAZADA: { kinds: ["firma", "envia"], label: "Rechazó limpieza y devolvió a Mecánico" },
    CIERRE_MAX_FALLOS_LIMPIEZA: { kinds: ["firma"], label: "Cerró la orden por máximo de fallos de limpieza" },
    LIMPIEZA_CORREGIDA: { kinds: ["firma", "envia"], label: "Corrigió limpieza y reenvió a Laboratorio" },
    CIERRE_NORMAL: { kinds: ["firma"], label: "Cerró la orden" },
    CIERRE_FORZADO: { kinds: ["firma"], label: "Forzó el cierre" },
    CIERRE_IRREGULAR: { kinds: ["firma"], label: "Cerró con observaciones (irregular)" },
    ORDEN_ELIMINADA: { kinds: ["otro"], label: "Eliminó la orden" }
  };
  const DEFAULT_META = { kinds: ["otro"], label: null };
  const KIND_LABELS = { recibe: "Recibió", firma: "Firmó", envia: "Envió", otro: "Otro" };

  let currentOrder = null;

  function populateOrderSelect() {
    const select = $("historyOrderSelect");
    if (!select) return;
    const previous = select.value;
    select.innerHTML =
      `<option value="">Seleccione una orden...</option>` +
      state.orders.map((o) => `
        <option value="${o.id}">${escapeHtml(o.code)} · ${escapeHtml(ORDER_STATUS_META[o.status]?.label || o.status)}</option>
      `).join("");
    if (previous && state.orders.some((o) => o.id === previous)) select.value = previous;
  }

  function showEmpty(message) {
    $("historyEmpty").textContent = message;
    $("historyEmpty").classList.remove("hidden");
    $("historyBody").innerHTML = "";
  }

  async function loadSelectedOrder() {
    const id = $("historyOrderSelect").value;
    if (!id) {
      currentOrder = null;
      showEmpty("Seleccione una Orden de Cambio para ver el detalle de tiempos.");
      return;
    }
    showEmpty("Cargando...");
    try {
      currentOrder = await dataAdapter.fetchOrder(id);
      renderHistoryTable();
    } catch (err) {
      currentOrder = null;
      showEmpty("No se pudo cargar el historial: " + describeApiError(err));
    }
  }

  function renderHistoryTable() {
    if (!currentOrder) {
      showEmpty("Seleccione una Orden de Cambio para ver el detalle de tiempos.");
      return;
    }

    const profileFilter = $("historyProfileFilter").value;
    const kindFilter = $("historyKindFilter").value;

    const rows = (currentOrder.history || [])
      .slice()
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .filter((ev) => !profileFilter || ev.profile === profileFilter)
      .map((ev) => ({ ev, meta: ACCION_META[ev.action] || DEFAULT_META }))
      .filter(({ meta }) => !kindFilter || meta.kinds.includes(kindFilter));

    if (!rows.length) {
      showEmpty("No hay eventos que coincidan con el filtro para esta orden.");
      return;
    }

    $("historyEmpty").classList.add("hidden");
    $("historyBody").innerHTML = rows.map(({ ev, meta }) => `
      <tr>
        <td>${formatDateTime(ev.timestamp)}</td>
        <td>${escapeHtml(ev.profileLabel || PROFILE_LABELS[ev.profile] || ev.profile || "—")}</td>
        <td>${meta.kinds.map((k) => `<span class="status-badge status-blue small">${KIND_LABELS[k] || k}</span>`).join(" ")}</td>
        <td>${escapeHtml(meta.label || ev.action)}</td>
        <td class="muted">${escapeHtml(ev.detail || "")}</td>
      </tr>
    `).join("");
  }

  function onShow() {
    populateOrderSelect();
  }

  function init() {
    populateOrderSelect();
    $("historyOrderSelect").addEventListener("change", loadSelectedOrder);
    $("historyProfileFilter").addEventListener("change", renderHistoryTable);
    $("historyKindFilter").addEventListener("change", renderHistoryTable);
  }

  OC.tabHistory = { init, onShow, populateOrderSelect };
})();
