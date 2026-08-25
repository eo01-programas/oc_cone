(() => {
  "use strict";

  const { $, $$, timeHHMM, stamp, isoDate, formatDateTime } = OC.util;
  const {
    state, CONFIG, PROFILE_LABELS, ORDER_STATUS_META, FLOW_STAGES, MAX_CYCLES, MAX_SIGNATURES_PER_PROFILE,
    getCurrentOrder, persist, addHistory, getActorName, safeText, escapeHtml, statusClass,
    getLatestRpmAttempt, getCurrentDeclaredRpm, createBlankOrder, calculateRpmComparison,
    openModal, closeModal, setTab, dataAdapter, canSign, registerSignature, describeApiError
  } = OC;

  const MACHINES = OC.MACHINES;
  const CLOSED_STATUSES = ["CERRADA", "CERRADA_CON_OBSERVACIONES", "CERRADA_MAX_RECHAZOS_RPM", "CERRADA_MAX_FALLOS_LIMPIEZA"];

  // ============================================================
  // PERMISOS POR CAMPO (matriz PROFILE_PERMISSIONS.editableSections / editableFields)
  // ============================================================
  const FIELD_SECTIONS = {
    orderDate: "section1_general",
    machineSelect: "section1_general",
    orderShift: "section1_general",
    fromNe: "section1_general",
    toNe: "section1_general",
    supervisorName: "section1_general",
    startTime: "section2_times",
    endTime: "section2_times",
    mechanicSelect: "section2_times",
    observations: "section2_times",
    productionControl: "section3_parameters",
    rpmMechanic: "section3_parameters",
    metersMinute: "section3_parameters",
    assistantDT: "section3_parameters",
    rpmMeasured: "section4_rpm_validation"
  };
  const SELECT_FIELD_IDS = new Set(["machineSelect", "orderShift", "mechanicSelect", "supervisorName"]);
  // Bloqueado para todos los perfiles sin excepción (incluso los que tienen fullEdit): todavía no se llena.
  const ALWAYS_LOCKED_FIELDS = new Set(["assistantDT"]);

  function isFieldEditable(fieldId) {
    if (ALWAYS_LOCKED_FIELDS.has(fieldId)) return false;
    const permissions = OC.getPermissions();
    if (permissions.fullEdit) return true;
    const section = FIELD_SECTIONS[fieldId];
    if (section && (permissions.editableSections || []).includes(section)) return true;
    if ((permissions.editableFields || []).includes(fieldId)) return true;
    return false;
  }

  function applyFieldPermissions() {
    Object.keys(FIELD_SECTIONS).forEach((fieldId) => {
      const el = $(fieldId);
      if (!el) return;
      const editable = isFieldEditable(fieldId);
      if (SELECT_FIELD_IDS.has(fieldId)) {
        el.disabled = !editable;
      } else {
        el.readOnly = !editable;
      }
    });
  }

  // ============================================================
  // MANEJO DE ERRORES DE BACKEND
  // ============================================================
  async function handleApiError(err, order) {
    console.error("Error de backend:", err);
    if (err && err.code === "VERSION_CONFLICT") {
      const wantsRefresh = confirm(
        "Esta orden fue actualizada por otro usuario.\nActualice la orden antes de continuar.\n\n¿Actualizar la orden ahora?"
      );
      if (wantsRefresh && order && order.id) {
        try {
          const fresh = await dataAdapter.fetchOrder(order.id);
          replaceOrder(fresh);
          loadOrderToForm(fresh);
          return;
        } catch (refreshErr) {
          alert("No se pudo actualizar la orden: " + describeApiError(refreshErr));
          return;
        }
      }
      return;
    }
    alert(describeApiError(err));
  }

  // ============================================================
  // CREACIÓN / CARGA
  // ============================================================
  async function startNewOrder() {
    if (!OC.getPermissions().canCreateOrder) {
      alert("Este perfil no puede crear órdenes.");
      return;
    }

    const btn = $("newOrderBtn");
    const previousText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Creando...";

    try {
      const order = await dataAdapter.createOrder({
        fecha: isoDate(),
        turno: state.session.shift || "Mañana"
      });
      state.orders = [order, ...state.orders.filter((item) => item.id !== order.id)];
      state.currentOrderId = order.id;
      loadOrderToForm(order);
      setTab("fill");
    } catch (err) {
      await handleApiError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = previousText;
    }
  }

  function loadOrderToForm(order) {
    if (!order) return;

    $("orderDate").value = order.date || isoDate();
    $("machineSelect").value = order.machine || "";
    $("orderShift").value = order.shift || state.session.shift || "Mañana";
    $("fromNe").value = order.fromNe || "";
    $("toNe").value = order.toNe || "";
    $("mechanicSelect").value = order.mechanic || "";
    $("startTime").value = order.startTime || "";
    $("endTime").value = order.endTime || "";
    $("supervisorName").value = order.supervisor || "";
    $("observations").value = order.observations || "";
    $("productionControl").value = order.productionControl || "";
    $("rpmMechanic").value = order.rpmMechanic || "";
    $("metersMinute").value = order.metersMinute || "";
    $("assistantDT").value = order.assistantDT || "";
    $("rpmMeasured").value = order.rpmMeasured || "";
    $("correctedRpm").value = "";
    $("correctionNote").value = "";

    syncVisualStatus();
    updateRpmMirrorAndDifference();
    OC.renderAll();
  }

  function collectFormIntoOrder({ addEditHistory = false } = {}) {
    let order = getCurrentOrder();
    if (!order) {
      alert("Cree o abra una orden antes de continuar.");
      return null;
    }

    const before = JSON.stringify(order);

    order.date = $("orderDate").value;
    order.machine = $("machineSelect").value;
    order.shift = $("orderShift").value;
    order.fromNe = $("fromNe").value.trim();
    order.toNe = $("toNe").value.trim();
    order.mechanic = $("mechanicSelect").value;
    order.startTime = $("startTime").value;
    order.endTime = $("endTime").value;
    order.supervisor = $("supervisorName").value.trim();
    order.observations = $("observations").value.trim();
    order.productionControl = $("productionControl").value.trim();
    order.rpmMechanic = $("rpmMechanic").value;
    order.metersMinute = $("metersMinute").value;
    order.assistantDT = $("assistantDT").value.trim();
    order.rpmMeasured = $("rpmMeasured").value;
    order.updatedAt = stamp();

    const after = JSON.stringify(order);
    if (addEditHistory && before !== after) {
      addHistory(order, "Datos actualizados", "Se guardaron cambios en la Orden de Cambio.");
    }

    persist();
    return order;
  }

  function replaceOrder(order) {
    state.orders = [order, ...state.orders.filter((item) => item.id !== order.id)];
    state.currentOrderId = order.id;
    persist();
  }

  // ============================================================
  // SUPERVISOR — Firmar y guardar / Enviar a Mecánico
  // ============================================================
  async function signAndSaveSupervisor() {
    const order = collectFormIntoOrder();
    if (!order) return;
    if (!canSign(order, "SUPERVISOR")) {
      alert("Se alcanzó el máximo de 5 firmas de Supervisor para esta orden.");
      return;
    }

    const btn = $("supervisorSignBtn");
    const previousText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Guardando...";

    try {
      const updated = await dataAdapter.signSupervisor(order);
      replaceOrder(updated);
      loadOrderToForm(updated);
    } catch (err) {
      await handleApiError(err, order);
    } finally {
      btn.disabled = false;
      btn.textContent = previousText;
    }
  }

  async function sendToMechanic() {
    const order = collectFormIntoOrder({ addEditHistory: true });
    if (!order) return;
    if (order.status !== "CREADA") {
      alert("Esta acción solo aplica a una orden recién creada.");
      return;
    }
    if (!order.signatures.SUPERVISOR.length) {
      alert("Debe firmar y guardar antes de enviar a Mecánico.");
      return;
    }

    const btn = $("sendToMechanicBtn");
    const previousText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Enviando...";

    try {
      const updated = await dataAdapter.sendToMechanic(order);
      replaceOrder(updated);
      loadOrderToForm(updated);
    } catch (err) {
      await handleApiError(err, order);
    } finally {
      btn.disabled = false;
      btn.textContent = previousText;
    }
  }

  // ============================================================
  // MECÁNICO — Iniciar regulación / Firmar y guardar (envía a validación RPM)
  // ============================================================
  async function startRegulation() {
    const order = collectFormIntoOrder();
    if (!order) return;
    if (order.status !== "PENDIENTE_MECANICO") {
      alert("Esta orden no está pendiente de asignación a Mecánico.");
      return;
    }
    const btn = $("startRegulationBtn");
    const previousText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Iniciando...";

    try {
      const updated = await dataAdapter.startRegulation(order);
      replaceOrder(updated);
      loadOrderToForm(updated);
    } catch (err) {
      await handleApiError(err, order);
    } finally {
      btn.disabled = false;
      btn.textContent = previousText;
    }
  }

  async function signAndSaveMechanic() {
    const order = collectFormIntoOrder();
    if (!order) return;
    if (order.status !== "EN_REGULACION") {
      alert("La orden debe estar en regulación antes de firmar y enviar a validación RPM.");
      return;
    }
    if (!canSign(order, "MECANICO")) {
      alert("Se alcanzó el máximo de 5 firmas de Mecánico para esta orden.");
      return;
    }
    const btn = $("mechanicSignBtn");
    const previousText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Guardando...";

    try {
      const updated = await dataAdapter.signMechanic(order);
      replaceOrder(updated);
      loadOrderToForm(updated);
    } catch (err) {
      await handleApiError(err, order);
    } finally {
      btn.disabled = false;
      btn.textContent = previousText;
    }
  }

  // ============================================================
  // RPM
  // ============================================================
  function updateRpmMirrorAndDifference() {
    const order = getCurrentOrder();
    const declared = order ? getCurrentDeclaredRpm(order) : $("rpmMechanic").value;
    $("rpmDeclaredMirror").value = declared || "";

    const result = calculateRpmComparison(declared, $("rpmMeasured").value);
    const box = $("rpmDifferenceBox");
    box.classList.remove("ok", "bad");

    if (!result) {
      $("rpmDifferenceValue").textContent = "—";
      $("rpmDifferencePercent").textContent =
        `Tolerancia ±${CONFIG.RPM_TOLERANCE_PERCENT ?? 5}%`;
      return;
    }

    const sign = result.difference > 0 ? "+" : "";
    $("rpmDifferenceValue").textContent = `${sign}${result.difference.toFixed(0)} RPM`;
    $("rpmDifferencePercent").textContent =
      `${result.percent.toFixed(2)}% · Tolerancia ±${result.tolerance}%`;

    box.classList.add(result.withinTolerance ? "ok" : "bad");
  }

  async function approveRpm() {
    const order = collectFormIntoOrder();
    if (!order) return;
    const declared = getCurrentDeclaredRpm(order);

    // Perfil que firma la decisión: PCP normalmente, o SUPERVISOR cuando sustituye a PCP.
    const signProfile = state.session.profile;
    if (!canSign(order, signProfile)) {
      alert(`Se alcanzó el máximo de 5 firmas de ${PROFILE_LABELS[signProfile]} para esta orden.`);
      return;
    }

    const btn = $("approveRpmBtn");
    const previousText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Aprobando...";

    try {
      const updated = await dataAdapter.validateRPM(order, {
        decision: "APROBADA",
        mechanicRpm: Number(declared),
        measuredRpm: Number(order.rpmMeasured),
        reason: ""
      });
      replaceOrder(updated);
      loadOrderToForm(updated);
    } catch (err) {
      await handleApiError(err, order);
    } finally {
      btn.disabled = false;
      btn.textContent = previousText;
    }
  }

  function openRejectModal() {
    const order = collectFormIntoOrder();
    if (!order) return;
    const declared = getCurrentDeclaredRpm(order);
    if (!declared || !order.rpmMeasured) {
      alert("Registre RPM declarada y RPM medida antes de rechazar.");
      return;
    }
    $("rejectReason").value = "";
    openModal("rejectModal");
  }

  async function confirmReject() {
    const reason = $("rejectReason").value.trim();
    if (!reason) {
      alert("El motivo de rechazo es obligatorio.");
      return;
    }

    const order = collectFormIntoOrder();
    if (!order) return;
    const declared = getCurrentDeclaredRpm(order);
    const signProfile = state.session.profile;
    if (!canSign(order, signProfile)) {
      alert(`Se alcanzó el máximo de 5 firmas de ${PROFILE_LABELS[signProfile]} para esta orden.`);
      return;
    }

    const btn = $("confirmRejectBtn");
    const previousText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Rechazando...";

    try {
      const updated = await dataAdapter.validateRPM(order, {
        decision: "RECHAZADA",
        mechanicRpm: Number(declared),
        measuredRpm: Number(order.rpmMeasured),
        reason
      });
      replaceOrder(updated);
      loadOrderToForm(updated);
      closeModal("rejectModal");
    } catch (err) {
      await handleApiError(err, order);
    } finally {
      btn.disabled = false;
      btn.textContent = previousText;
    }
  }

  async function saveMechanicCorrection() {
    const order = collectFormIntoOrder();
    if (!order) return;
    if (order.status !== "RECHAZADA_RPM") {
      alert("Solo se puede registrar una regulación corregida cuando el RPM fue rechazado.");
      return;
    }

    const newDeclaredRpm = $("correctedRpm").value;
    const note = $("correctionNote").value.trim();
    if (!newDeclaredRpm) {
      alert("Ingrese la nueva RPM declarada.");
      return;
    }
    if (!canSign(order, "MECANICO")) {
      alert("Se alcanzó el máximo de 5 firmas de Mecánico para esta orden.");
      return;
    }

    const btn = $("saveCorrectionBtn");
    const previousText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Guardando...";

    try {
      const updated = await dataAdapter.correctMechanicRpm(order, {
        newDeclaredRpm: Number(newDeclaredRpm),
        note
      });
      replaceOrder(updated);
      loadOrderToForm(updated);
    } catch (err) {
      await handleApiError(err, order);
    } finally {
      btn.disabled = false;
      btn.textContent = previousText;
    }
  }

  // ============================================================
  // LABORATORIO — Recepción, ciclo de Limpieza (aprobar/rechazar), corrección del Mecánico
  // ============================================================
  const LAB_RECEIPT_VALID_STATUSES = ["PENDIENTE_LABORATORIO", "LIMPIEZA_CORREGIDA_PENDIENTE_LABORATORIO"];

  async function registerLabReceipt() {
    const order = collectFormIntoOrder();
    if (!order) return;
    if (!LAB_RECEIPT_VALID_STATUSES.includes(order.status)) {
      alert("Esta acción no aplica en el estado actual de la orden.");
      return;
    }
    if (!canSign(order, "LABORATORIO")) {
      alert("Se alcanzó el máximo de 5 firmas de Laboratorio para esta orden.");
      return;
    }

    const btn = $("labReceivedBtn");
    const previousText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Recibiendo...";

    try {
      const updated = await dataAdapter.registerLabReceipt(order);
      replaceOrder(updated);
      loadOrderToForm(updated);
    } catch (err) {
      await handleApiError(err, order);
    } finally {
      btn.disabled = false;
      btn.textContent = previousText;
    }
  }

  async function approveCleaning() {
    const order = collectFormIntoOrder();
    if (!order) return;
    if (order.status !== "LABORATORIO_RECIBIDO") {
      alert("Esta acción solo aplica cuando Laboratorio ya recibió la orden.");
      return;
    }
    if (!canSign(order, "LABORATORIO")) {
      alert("Se alcanzó el máximo de 5 firmas de Laboratorio para esta orden.");
      return;
    }

    const btn = $("approveCleaningBtn");
    const previousText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Aprobando...";

    try {
      const updated = await dataAdapter.validateCleaning(order, { decision: "APROBADA" });
      replaceOrder(updated);
      loadOrderToForm(updated);
    } catch (err) {
      await handleApiError(err, order);
    } finally {
      btn.disabled = false;
      btn.textContent = previousText;
    }
  }

  function openRejectCleaningModal() {
    const order = collectFormIntoOrder();
    if (!order) return;
    if (order.status !== "LABORATORIO_RECIBIDO") {
      alert("Esta acción solo aplica cuando Laboratorio ya recibió la orden.");
      return;
    }
    $("rejectCleaningReason").value = "";
    openModal("rejectCleaningModal");
  }

  async function confirmRejectCleaning() {
    const reason = $("rejectCleaningReason").value.trim();
    if (!reason) {
      alert("El motivo del rechazo de limpieza es obligatorio.");
      return;
    }

    const order = collectFormIntoOrder();
    if (!order) return;
    if (!canSign(order, "LABORATORIO")) {
      alert("Se alcanzó el máximo de 5 firmas de Laboratorio para esta orden.");
      return;
    }

    const btn = $("confirmRejectCleaningBtn");
    const previousText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Rechazando...";

    try {
      const updated = await dataAdapter.validateCleaning(order, { decision: "RECHAZADA", reason });
      replaceOrder(updated);
      loadOrderToForm(updated);
      closeModal("rejectCleaningModal");
    } catch (err) {
      await handleApiError(err, order);
    } finally {
      btn.disabled = false;
      btn.textContent = previousText;
    }
  }

  async function mechanicCleaningCorrected() {
    const order = collectFormIntoOrder();
    if (!order) return;
    if (order.status !== "LIMPIEZA_RECHAZADA") {
      alert("Solo se puede confirmar la corrección cuando la limpieza fue rechazada.");
      return;
    }
    if (!canSign(order, "MECANICO")) {
      alert("Se alcanzó el máximo de 5 firmas de Mecánico para esta orden.");
      return;
    }

    const btn = $("cleaningCorrectedBtn");
    const previousText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Corrigiendo...";

    try {
      const updated = await dataAdapter.markCleaningCorrected(order);
      replaceOrder(updated);
      loadOrderToForm(updated);
    } catch (err) {
      await handleApiError(err, order);
    } finally {
      btn.disabled = false;
      btn.textContent = previousText;
    }
  }

  // ============================================================
  // CIERRE
  // ============================================================
  function getCloseChecklist(order) {
    const latest = getLatestRpmAttempt(order);
    return [
      { label: "Máquina seleccionada", ok: !!order.machine },
      { label: "Mecánico seleccionado", ok: !!order.mechanic },
      { label: "Hora de inicio registrada", ok: !!order.startTime },
      { label: "Hora de término registrada", ok: !!order.endTime },
      { label: "RPM mecánico registrada", ok: !!order.rpmMechanic },
      { label: "Validación RPM aprobada", ok: !!latest && latest.decision === "APROBADA", soft: true },
      { label: "Laboratorio confirmó recibido", ok: order.laboratoryReceipts.length > 0 },
      { label: "Limpieza aprobada", ok: order.cleaningAttempts.length > 0 && order.cleaningAttempts[order.cleaningAttempts.length - 1].decision === "APROBADA" },
      { label: "Firma del Mecánico", ok: order.signatures.MECANICO.length > 0 },
      { label: "Firma del validador RPM", ok: order.signatures.PCP.length > 0 || order.signatures.SUPERVISOR.length > 0 },
      { label: "Firma de Laboratorio", ok: order.signatures.LABORATORIO.length > 0 },
      { label: "Firma del Supervisor", ok: order.signatures.SUPERVISOR.length > 0 }
    ];
  }

  async function closeOrderNormal() {
    const order = collectFormIntoOrder();
    if (!order) return;
    const checklist = getCloseChecklist(order);
    const hardMissing = checklist.filter(x => !x.ok && !x.soft);
    const softMissing = checklist.filter(x => !x.ok && x.soft);

    if (hardMissing.length) {
      alert(
        "La orden tiene campos pendientes:\n" +
        hardMissing.map(x => "• " + x.label).join("\n") +
        "\n\nUse 'Forzar cierre' si corresponde."
      );
      return;
    }

    let irregular = false;
    if (softMissing.length) {
      const proceed = confirm(
        "Atención, antes de cerrar:\n" +
        softMissing.map(x => "• " + x.label).join("\n") +
        "\n\n¿Desea cerrar la orden de todas formas? Quedará registrado como cierre irregular."
      );
      if (!proceed) return;
      irregular = true;
    }

    const btn = $("closeOrderBtn");
    const previousText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Cerrando...";

    try {
      const updated = await dataAdapter.closeOrder(order, {
        forced: false,
        irregular,
        note: irregular ? "Cierre normal con observaciones: " + softMissing.map(x => x.label).join(", ") + "." : ""
      });
      replaceOrder(updated);
      loadOrderToForm(updated);
    } catch (err) {
      await handleApiError(err, order);
    } finally {
      btn.disabled = false;
      btn.textContent = previousText;
    }
  }

  function openForceClose() {
    const order = collectFormIntoOrder();
    if (!order) return;
    const missing = getCloseChecklist(order).filter(x => !x.ok);
    $("forceCloseMissing").innerHTML = missing.length
      ? `<strong>Registros pendientes:</strong><br>${missing.map(x => "• " + escapeHtml(x.label)).join("<br>")}`
      : "No se detectan pendientes. Puede utilizar el cierre normal.";

    $("forceCloseNote").value = "";
    openModal("forceCloseModal");
  }

  async function confirmForceClose() {
    const note = $("forceCloseNote").value.trim();
    if (!note) {
      alert("La aclaración es obligatoria para el cierre forzado.");
      return;
    }

    const order = collectFormIntoOrder();
    if (!order) return;

    const btn = $("confirmForceCloseBtn");
    const previousText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Cerrando...";

    try {
      const updated = await dataAdapter.closeOrder(order, { forced: true, note });
      replaceOrder(updated);
      loadOrderToForm(updated);
      closeModal("forceCloseModal");
    } catch (err) {
      await handleApiError(err, order);
    } finally {
      btn.disabled = false;
      btn.textContent = previousText;
    }
  }

  // ============================================================
  // RENDER (pestaña Llenado)
  // ============================================================
  function renderOrderBadge(order) {
    const el = $("orderBadge");
    if (!order) {
      el.textContent = "Sin orden activa";
      el.className = "status-badge status-neutral";
      return;
    }
    const meta = ORDER_STATUS_META[order.status];
    el.textContent = `${order.code} · ${meta ? meta.label : order.status}`;
    el.className = `status-badge ${statusClass(order.status)}`;
  }

  function syncVisualStatus() {
    const order = getCurrentOrder();
    $("visualStatus").value = order ? (ORDER_STATUS_META[order.status]?.label || order.status) : "Sin orden";
  }

  function renderFlow(order) {
    const el = $("flowSteps");
    if (!order) {
      el.innerHTML = FLOW_STAGES.map(s => `
        <div class="flow-step">
          <strong>${s.label}</strong>
          <small>${s.help}</small>
        </div>`).join("");
      return;
    }

    const isFinal = CLOSED_STATUSES.includes(order.status);
    const currentIndex = FLOW_STAGES.findIndex(s => s.statuses.includes(order.status));
    const rejectedNow = ["RECHAZADA_RPM", "PENDIENTE_REVALIDACION_RPM"].includes(order.status);
    const rejectedLab = ["LIMPIEZA_RECHAZADA", "LIMPIEZA_CORREGIDA_PENDIENTE_LABORATORIO"].includes(order.status);

    el.innerHTML = FLOW_STAGES.map((s, i) => {
      let cls = "pending";
      if (i < currentIndex || (i === currentIndex && isFinal)) cls = "complete";
      else if (i === currentIndex) {
        cls = ((rejectedNow && s.key === "mecanico") || (rejectedLab && s.key === "lab")) ? "rejected" : "active";
      }

      return `
        <div class="flow-step ${cls}">
          <strong>${s.label}</strong>
          <small>${s.help}</small>
        </div>`;
    }).join("");
  }

  function renderHistory(order) {
    const el = $("historyTimeline");
    if (!order || !order.history.length) {
      el.innerHTML = `<div class="timeline-empty">Aún no hay eventos registrados.</div>`;
      return;
    }
    el.innerHTML = order.history.map(ev => `
      <div class="timeline-item">
        <div class="timeline-time">${formatDateTime(ev.timestamp)}</div>
        <div class="timeline-content">
          <strong>${escapeHtml(ev.action)} · ${escapeHtml(ev.profileLabel || "")}</strong>
          <p>${escapeHtml(ev.detail || "")}</p>
          ${ev.changes && ev.changes.length ? `
            <ul class="timeline-changes">
              ${ev.changes.map(c => `<li>${escapeHtml(c.field)}: <em>${escapeHtml(safeText(c.before))}</em> → <strong>${escapeHtml(safeText(c.after))}</strong></li>`).join("")}
            </ul>` : ""}
        </div>
      </div>
    `).join("");
  }

  function renderSignatures(order) {
    const profiles = [
      ["SUPERVISOR", "Supervisor"],
      ["MECANICO", "Mecánico"],
      ["PCP", "PCP Hilandería"],
      ["LABORATORIO", "Laboratorio"]
    ];
    $("signaturesGrid").innerHTML = profiles.map(([key, label]) => {
      const list = order?.signatures?.[key] || [];
      const last = list[list.length - 1];
      return `
        <div class="signature-card ${last ? "signed" : ""}">
          <strong>${label}</strong>
          <small>${last ? escapeHtml(last.name) : "Pendiente"}</small>
          <small>${last ? formatDateTime(last.timestamp) : "Sin firma"}</small>
          ${last ? `<small class="muted">${escapeHtml(last.code)} · ${list.length}/${MAX_SIGNATURES_PER_PROFILE}</small>` : ""}
        </div>`;
    }).join("");
  }

  function renderLab(order) {
    const el = $("labReceiptInfo");
    if (!order || !order.laboratoryReceipts.length) {
      el.textContent = "Pendiente de recepción.";
      return;
    }
    const last = order.laboratoryReceipts[order.laboratoryReceipts.length - 1];
    el.textContent = `Recibido por ${last.receivedBy} · ${formatDateTime(last.timestamp)}`;
  }

  function renderRpmAttempts(order) {
    const el = $("rpmAttemptsList");
    if (!el) return;
    if (!order || !order.rpmValidationAttempts.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = order.rpmValidationAttempts.map(a => `
      <div class="rpm-attempt-item ${a.decision === "APROBADA" ? "approved" : "rejected"}">
        <strong>Intento ${a.attempt} · ${escapeHtml(a.decision)}</strong>
        <div>RPM declarada: ${safeText(a.mechanicRpm)} · RPM medida: ${safeText(a.measuredRpm)} ·
          Diferencia: ${a.difference > 0 ? "+" : ""}${a.difference.toFixed(0)} (${a.differencePercent.toFixed(2)}%)</div>
        ${a.reason ? `<div>Motivo: ${escapeHtml(a.reason)}</div>` : ""}
        <small class="muted">${escapeHtml(a.validator)} · ${formatDateTime(a.timestamp)}</small>
      </div>
    `).join("");
  }

  function renderCleaningAttempts(order) {
    const el = $("cleaningAttemptsList");
    if (!el) return;
    if (!order || !order.cleaningAttempts.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = order.cleaningAttempts.map(c => `
      <div class="rpm-attempt-item ${c.decision === "APROBADA" ? "approved" : "rejected"}">
        <strong>Limpieza · intento ${c.attempt} · ${escapeHtml(c.decision)}</strong>
        ${c.reason ? `<div>Motivo: ${escapeHtml(c.reason)}</div>` : ""}
        <small class="muted">${escapeHtml(c.validator)} · ${formatDateTime(c.timestamp)}</small>
      </div>
    `).join("");
  }

  function renderMechanicCorrections(order) {
    const el = $("mechanicCorrectionsList");
    if (!el) return;
    if (!order || !order.mechanicCorrections.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = order.mechanicCorrections.map(c => `
      <div class="rpm-attempt-item">
        <strong>Corrección ${c.attempt}</strong>
        <div>Nueva RPM declarada: ${safeText(c.newDeclaredRpm)}</div>
        ${c.note ? `<div>${escapeHtml(c.note)}</div>` : ""}
        <small class="muted">${escapeHtml(c.mechanic)} · ${formatDateTime(c.timestamp)}</small>
      </div>
    `).join("");
  }

  function renderCloseChecklist(order) {
    const el = $("closeChecklist");
    if (!order) {
      el.innerHTML = `<div class="timeline-empty">Cree o seleccione una orden.</div>`;
      return;
    }
    el.innerHTML = getCloseChecklist(order).map(item => `
      <div class="check-item ${item.ok ? "ok" : "missing"}">
        <span class="check-dot"></span>
        <span>${escapeHtml(item.label)}${item.soft && !item.ok ? ` <small class="muted">(se puede forzar el cierre normal con aviso)</small>` : ""}</span>
      </div>
    `).join("");
  }

  // ============================================================
  // INICIALIZACIÓN DE LA PESTAÑA
  // ============================================================
  function populateCatalogs() {
    const machines = state.catalogs.maquinas.length
      ? state.catalogs.maquinas.map((item) => item.maquina)
      : MACHINES;

    $("machineSelect").innerHTML =
      `<option value="">Seleccione una máquina...</option>` +
      machines.map((machine) => `<option>${escapeHtml(machine)}</option>`).join("");

    $("supervisorName").innerHTML =
      `<option value="">Seleccione...</option>` +
      state.catalogs.supervisores.map((name) => `<option>${escapeHtml(name)}</option>`).join("");
  }

  function init() {
    populateCatalogs();

    $$("[data-now-target]").forEach(btn => {
      btn.addEventListener("click", () => {
        $(btn.dataset.nowTarget).value = timeHHMM();
        collectFormIntoOrder();
        OC.renderAll();
      });
    });

    ["rpmMechanic", "rpmMeasured"].forEach(id => {
      $(id).addEventListener("input", () => {
        updateRpmMirrorAndDifference();
        collectFormIntoOrder();
        renderFlow(getCurrentOrder());
      });
    });

    $("supervisorSignBtn").addEventListener("click", signAndSaveSupervisor);
    $("sendToMechanicBtn").addEventListener("click", sendToMechanic);
    $("startRegulationBtn").addEventListener("click", startRegulation);
    $("mechanicSignBtn").addEventListener("click", signAndSaveMechanic);
    $("saveCorrectionBtn").addEventListener("click", saveMechanicCorrection);

    $("approveRpmBtn").addEventListener("click", approveRpm);
    $("rejectRpmBtn").addEventListener("click", openRejectModal);
    $("confirmRejectBtn").addEventListener("click", confirmReject);

    $("labReceivedBtn").addEventListener("click", registerLabReceipt);
    $("approveCleaningBtn").addEventListener("click", approveCleaning);
    $("rejectCleaningBtn").addEventListener("click", openRejectCleaningModal);
    $("confirmRejectCleaningBtn").addEventListener("click", confirmRejectCleaning);
    $("cleaningCorrectedBtn").addEventListener("click", mechanicCleaningCorrected);

    $("closeOrderBtn").addEventListener("click", closeOrderNormal);
    $("forceCloseBtn").addEventListener("click", openForceClose);
    $("confirmForceCloseBtn").addEventListener("click", confirmForceClose);

    // Auto-sincronización de formulario al salir de campos.
    // (Reemplazo definitivo por bloqueo + lápiz + firma pendiente: próxima sub-etapa.)
    $$("#orderForm input, #orderForm select, #orderForm textarea").forEach(el => {
      el.addEventListener("change", () => {
        collectFormIntoOrder();
        updateRpmMirrorAndDifference();
        OC.renderAll();
      });
    });
  }

  OC.tabFill = {
    init, loadOrderToForm, collectFormIntoOrder, startNewOrder,
    populateCatalogs, applyFieldPermissions,
    renderOrderBadge, syncVisualStatus, renderFlow, renderHistory, renderSignatures, renderLab,
    renderRpmAttempts, renderMechanicCorrections, renderCleaningAttempts, renderCloseChecklist
  };
})();
