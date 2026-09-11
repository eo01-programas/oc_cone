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
    machineNumberSelect: "section1_general",
    orderShift: "section1_general",
    articulo: "section1_general",
    lote: "section1_general",
    composicion: "section1_general",
    fromNe: "section1_general",
    toNe: "section1_general",
    supervisorName: "section1_general",
    articuloLoteSale: "section1_general",
    startTime: "section2_times",
    endTime: "section2_times",
    mechanicSelect: "section2_times",
    observations: "section2_times",
    productionControl: "section3_parameters",
    rpmMechanic: "section3_parameters",
    assistantDT: "section3_parameters",
    // PCP debe poder editar la RPM declarada (además de RPM medida y
    // Mts/Min, que ya podía) — antes era un "espejo" de solo lectura
    // fijo en el HTML; ver setDeclaredMirrorFromOrder()/updateRpmDifference().
    rpmDeclaredMirror: "section4_rpm_validation",
    rpmMeasured: "section4_rpm_validation",
    metersMinute: "section4_rpm_validation"
  };
  const SELECT_FIELD_IDS = new Set(["machineSelect", "machineNumberSelect", "orderShift", "mechanicSelect", "supervisorName"]);
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
    // Los combobox propios (Máquina/N°-Maq/Supervisor/Artículo/Lote/
    // Composición/A Ne) leen .disabled/.readOnly del elemento oculto
    // recién actualizado arriba — hay que decirles que se refresquen.
    OC.combobox.refreshAll();
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
    const machineParts = resolveMachineParts(order.machine);
    $("machineSelect").value = machineParts.tipo;
    populateMachineNumberOptions(machineParts.tipo, machineParts.numero);
    $("orderShift").value = order.shift || state.session.shift || "Mañana";
    $("articulo").value = order.articulo || "";
    $("lote").value = order.lote || "";
    $("composicion").value = order.composicion || "";
    $("articuloLoteSale").value = order.articuloLoteSale || "";
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

    // Los combobox propios no se enteran de las asignaciones .value de
    // arriba por su cuenta (van directo al elemento oculto) — se les
    // pide que reflejen el valor recién cargado.
    OC.combobox.refreshAll();

    syncVisualStatus();
    setDeclaredMirrorFromOrder(order);
    updateRpmDifference();
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
    const machineTipo = $("machineSelect").value;
    const machineNumero = $("machineNumberSelect").value;
    order.machine = machineNumero ? `${machineTipo} ${machineNumero}` : machineTipo;
    order.shift = $("orderShift").value;
    order.articulo = $("articulo").value.trim();
    order.lote = $("lote").value.trim();
    order.composicion = $("composicion").value.trim();
    order.articuloLoteSale = $("articuloLoteSale").value.trim();
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
  // SUPERVISOR — Guardar/Firmar/Enviar (acción atómica delegada)
  // ------------------------------------------------------------
  // El Supervisor firma (si esta orden todavía no tiene firma suya) y
  // completa el tramo mecánico con una firma delegada -- el Supervisor
  // actúa en nombre del Mecánico -- en una sola llamada atómica al
  // backend (signAndDelegateSupervisor_ en code.gs, con lock). La orden
  // salta directo a PENDIENTE_VALIDACION_RPM sin pasar por
  // PENDIENTE_MECANICO/EN_REGULACION ni esperar al Mecánico presencial.
  // Este mismo botón también sirve para "migrar" en caliente una orden
  // que ya estaba en PENDIENTE_MECANICO o EN_REGULACION antes de este
  // cambio (ver renderActionVisibility en login.js) -- el backend detecta
  // solo si ya tiene firma de Supervisor y no la duplica.
  //
  // Al ser atómica ya no existe el estado intermedio "firmó pero no se
  // envió" que tenía la versión anterior (dos llamadas encadenadas): o
  // se completa todo, o no cambia nada y el mismo botón sirve para
  // reintentar.
  async function saveSignAndSendSupervisor() {
    const order = collectFormIntoOrder({ addEditHistory: true });
    if (!order) return;
    if (!canSign(order, "SUPERVISOR")) {
      alert("Se alcanzó el máximo de 5 firmas de Supervisor para esta orden.");
      return;
    }

    const btn = $("supervisorSignBtn");
    const previousText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Guardando y firmando...";

    try {
      const updated = await dataAdapter.signAndDelegateSupervisor(order);
      replaceOrder(updated);
      loadOrderToForm(updated);
      setTab("registry");
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
      setTab("registry");
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
      setTab("registry");
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
  // Fija el valor inicial de "RPM declarada" que ve PCP al abrir una orden
  // (última corrección del Mecánico si existe, si no lo que se declaró al
  // firmar). Se llama solo al cargar la orden (loadOrderToForm) -- a
  // partir de ahí el campo es editable por PCP (ver FIELD_SECTIONS) y no
  // se debe volver a pisar con este valor derivado en cada tecleo.
  function setDeclaredMirrorFromOrder(order) {
    const declared = order ? getCurrentDeclaredRpm(order) : $("rpmMechanic").value;
    $("rpmDeclaredMirror").value = declared || "";
  }

  // Recalcula la diferencia RPM declarada vs. medida leyendo el valor
  // ACTUAL de rpmDeclaredMirror (el default recién cargado, o lo que PCP
  // haya editado) -- a diferencia de antes, ya no reescribe ese campo.
  function updateRpmDifference() {
    const result = calculateRpmComparison($("rpmDeclaredMirror").value, $("rpmMeasured").value);
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
    // Lee lo que hay en pantalla, no el valor derivado de la orden --
    // PCP puede haber editado "RPM declarada" (ver setDeclaredMirrorFromOrder).
    const declared = $("rpmDeclaredMirror").value;

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
      setTab("registry");
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
    // Se puede rechazar sin RPM/m·s registrados (igual que el backend, que
    // solo exige el motivo para una RECHAZADA). El único requisito lo pide
    // confirmReject(): el motivo.
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
    const declared = $("rpmDeclaredMirror").value;
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
      setTab("registry");
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

  // Laboratorio dentro de la OC (recepción, aprobar/rechazar limpieza,
  // corrección del Mecánico) ya no tiene acción interactiva -- Fase 2 de
  // Control de Paros retiró esas 3 acciones del backend (código muerto,
  // ninguna orden nueva vuelve a pasar por PENDIENTE_LABORATORIO). La
  // tarjeta "5. Laboratorio" (solo lectura) también se quitó del Llenado --
  // el indicador de la barra de flujo ya alcanza (ver renderFlow).

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
      // Fase 1 de Control de Paros: al aprobar RPM la orden salta directo a
      // Pendiente de Cierre, sin pasar por Laboratorio dentro de la OC (ver
      // validateRpm_ en code.gs). La confirmación de Laboratorio/limpieza
      // ahora vive en Control de Paros (sello 2), así que ya no son
      // requisitos "duros" de este checklist.
      { label: "Firma del Mecánico", ok: order.signatures.MECANICO.length > 0 },
      { label: "Firma del validador RPM", ok: order.signatures.PCP.length > 0 || order.signatures.SUPERVISOR.length > 0 },
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

      if (s.key === "lab") {
        // Laboratorio ya no vive en el ESTADO de la OC (Fase 1/2 de Control
        // de Paros): se colorea por el sello real en TRANS_PAROS, no por
        // posición -- si no, se pinta verde solo por avanzar la OC, aunque
        // Laboratorio no haya validado nada todavía.
        const paro = state.paros.find(p => p.orderId === order.id);
        if (paro) {
          cls = paro.seals[2].hora ? "complete" : (paro.seals[1].hora ? "active" : "pending");
        } else if (i < currentIndex || (i === currentIndex && isFinal)) {
          cls = "complete"; // sin Paro (orden previa a Fase 1): criterio posicional de siempre
        } else if (i === currentIndex) {
          cls = rejectedLab ? "rejected" : "active";
        }
      } else if (i < currentIndex || (i === currentIndex && isFinal)) {
        cls = "complete";
      } else if (i === currentIndex) {
        cls = (rejectedNow && s.key === "mecanico") ? "rejected" : "active";
      }

      return `
        <div class="flow-step ${cls}">
          <strong>${s.label}</strong>
          <small>${s.help}</small>
        </div>`;
    }).join("");
  }

  // El detalle cronológico completo ya vive en el tab "Histórico"
  // (js/tab-history.js) -- redundante mostrarlo también aquí.

  function renderSignatures(order) {
    const profiles = [
      ["SUPERVISOR", "Supervisor"],
      ["MECANICO", "Mecánico"],
      ["LABORATORIO", "Laboratorio"],
      ["PCP", "PCP Hilandería"]
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

  // El listado visual del checklist de cierre (#closeChecklist) se quitó
  // por redundante -- getCloseChecklist() sigue viva, la usan
  // closeOrderNormal() y openForceClose() para validar antes de cerrar.

  // ============================================================
  // INICIALIZACIÓN DE LA PESTAÑA
  // ============================================================
  // Máquina / N°-Maq: casillas encadenadas. Si TABLA_MAQUINAS trae datos reales
  // (tipo + numero por fila), se usan esos; si no, se degrada a la lista fija
  // MACHINES, intentando separar el numero al final del texto (ej. "Mechera 1").
  function parseMachineFallback(value) {
    const str = String(value || "").trim();
    const match = str.match(/^(.*?)\s+(\d+)$/);
    if (match) return { tipo: match[1].trim(), numero: match[2] };
    return { tipo: str, numero: "" };
  }

  function getMachineTypes() {
    const seen = new Set();
    const types = [];
    const source = state.catalogs.maquinas.length
      ? state.catalogs.maquinas.map((item) => item.tipo)
      : MACHINES.map((m) => parseMachineFallback(m).tipo);
    source.forEach((tipo) => {
      if (tipo && !seen.has(tipo)) { seen.add(tipo); types.push(tipo); }
    });
    return types;
  }

  function getMachineNumbers(tipo) {
    if (state.catalogs.maquinas.length) {
      return state.catalogs.maquinas
        .filter((item) => item.tipo === tipo && item.numero)
        .map((item) => item.numero);
    }
    return MACHINES
      .map((m) => parseMachineFallback(m))
      .filter((p) => p.tipo === tipo && p.numero)
      .map((p) => p.numero);
  }

  function resolveMachineParts(fullValue) {
    const value = String(fullValue || "").trim();
    if (!value) return { tipo: "", numero: "" };
    const found = state.catalogs.maquinas.find((item) => item.maquina.toUpperCase() === value.toUpperCase());
    if (found) return { tipo: found.tipo, numero: found.numero };
    return parseMachineFallback(value);
  }

  function populateMachineNumberOptions(tipo, selectedNumero) {
    const numbers = getMachineNumbers(tipo);
    const sel = $("machineNumberSelect");
    sel.innerHTML =
      `<option value="">Seleccione...</option>` +
      numbers.map((n) => `<option>${escapeHtml(n)}</option>`).join("");
    sel.value = numbers.includes(String(selectedNumero || "")) ? selectedNumero : "";
    // Cubre tanto la carga inicial de una orden como la cascada en vivo
    // cuando cambia Máquina (ver listener de "change" en init(), abajo).
    OC.combobox.refreshAll();
  }

  // Datalist de sugerencias para un <input list="..."> — a diferencia de un
  // <select>, el input conserva su propio texto libre; no hay valor
  // "seleccionado" que preservar aquí, solo las opciones sugeridas.
  function populateDatalist(datalistId, items) {
    const el = $(datalistId);
    if (!el) return;
    el.innerHTML = (items || []).map((v) => `<option value="${escapeHtml(v)}"></option>`).join("");
  }

  function populateCatalogs() {
    $("machineSelect").innerHTML =
      `<option value="">Seleccione una máquina...</option>` +
      getMachineTypes().map((tipo) => `<option>${escapeHtml(tipo)}</option>`).join("");

    populateMachineNumberOptions($("machineSelect").value, $("machineNumberSelect").value);

    $("supervisorName").innerHTML =
      `<option value="">Seleccione...</option>` +
      state.catalogs.supervisores.map((name) => `<option>${escapeHtml(name)}</option>`).join("");

    // Sugerencias desde el catálogo de GESTION_OC (misma Spreadsheet, hoja
    // CATALOGO). Los campos siguen siendo texto libre — esto solo sugiere.
    populateDatalist("materialOptions", state.catalogs.materiales);
    populateDatalist("loteOptions", state.catalogs.lotes);
    populateDatalist("tituloOptions", state.catalogs.titulos);
    populateDatalist("composicionOptions", state.catalogs.composiciones);
  }

  function init() {
    OC.combobox.init();
    populateCatalogs();

    $("machineSelect").addEventListener("change", () => {
      populateMachineNumberOptions($("machineSelect").value, "");
    });

    $$("[data-now-target]").forEach(btn => {
      btn.addEventListener("click", () => {
        $(btn.dataset.nowTarget).value = timeHHMM();
        collectFormIntoOrder();
        OC.renderAll();
      });
    });

    ["rpmMechanic", "rpmMeasured", "rpmDeclaredMirror"].forEach(id => {
      $(id).addEventListener("input", () => {
        updateRpmDifference();
        collectFormIntoOrder();
        renderFlow(getCurrentOrder());
      });
    });

    $("supervisorSignBtn").addEventListener("click", saveSignAndSendSupervisor);
    $("sendToMechanicBtn").addEventListener("click", sendToMechanic);
    $("startRegulationBtn").addEventListener("click", startRegulation);
    $("mechanicSignBtn").addEventListener("click", signAndSaveMechanic);
    $("saveCorrectionBtn").addEventListener("click", saveMechanicCorrection);

    $("approveRpmBtn").addEventListener("click", approveRpm);
    $("rejectRpmBtn").addEventListener("click", openRejectModal);
    $("confirmRejectBtn").addEventListener("click", confirmReject);

    $("closeOrderBtn").addEventListener("click", closeOrderNormal);
    $("forceCloseBtn").addEventListener("click", openForceClose);
    $("confirmForceCloseBtn").addEventListener("click", confirmForceClose);

    // Auto-sincronización de formulario al salir de campos.
    // (Reemplazo definitivo por bloqueo + lápiz + firma pendiente: próxima sub-etapa.)
    $$("#orderForm input, #orderForm select, #orderForm textarea").forEach(el => {
      el.addEventListener("change", () => {
        collectFormIntoOrder();
        updateRpmDifference();
        OC.renderAll();
      });
    });
  }

  OC.tabFill = {
    init, loadOrderToForm, collectFormIntoOrder, startNewOrder,
    populateCatalogs, applyFieldPermissions,
    renderOrderBadge, syncVisualStatus, renderFlow, renderSignatures,
    renderRpmAttempts, renderMechanicCorrections
  };
})();
