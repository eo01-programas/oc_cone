window.OC = window.OC || {};

(() => {
  "use strict";

  const CONFIG = window.APP_CONFIG || {};
  const LS_KEY = "ordenCambioFrontendV1";

  // ============================================================
  // DATOS MAESTROS FRONTEND
  // FUTURO: reemplazar por catálogos desde Apps Script / Sheets.
  // ============================================================
  const MACHINES = [
    ...Array.from({ length: 4 }, (_, i) => `Mechera ${i + 1}`),
    ...Array.from({ length: 25 }, (_, i) => `Continua ${i + 1}`),
    "Murata LTD (Conera #3)",
    "Murata QPRO (Conera #4)"
  ];

  const LOGIN_PROFILE_MAP = {
    "JEFE DE PLANTA": "JEFATURA",
    "SUPERVISOR DE TURNO": "SUPERVISOR",
    "PCP HILANDERIA": "PCP",
    "LABORATORIO": "LABORATORIO",
    "MECANICO": "MECANICO"
  };

  const PROFILE_LABELS = {
    JEFATURA: "Jefe de Planta",
    SUPERVISOR: "Supervisor de Turno",
    PCP: "PCP Hilanderia",
    LABORATORIO: "Laboratorio",
    MECANICO: "Mecanico"
  };

  const PROFILE_PERMISSIONS = {
    JEFATURA: {
      canCreateOrder: false,
      fullEdit: false,
      canOverrideEdit: true,
      canViewHistory: true,
      canValidateRPM: false,
      canReceiveLab: false,
      canCloseOrder: false,
      canDeleteOrder: true
    },
    SUPERVISOR: {
      canCreateOrder: true,
      fullEdit: true,
      canOverrideEdit: true,
      canViewHistory: true,
      canValidateRPM: true,
      canAssumePcpValidation: true,
      canReceiveLab: true,
      canCloseOrder: true,
      canForceClose: true,
      canCreateContinuation: true,
      canDeleteOrder: true
    },
    PCP: {
      canCreateOrder: false,
      fullEdit: false,
      canOverrideEdit: true,
      canViewHistory: false,
      canValidateRPM: true,
      editableSections: ["section4_rpm_validation"],
      canDeleteOrder: false
    },
    LABORATORIO: {
      canCreateOrder: false,
      fullEdit: false,
      canOverrideEdit: true,
      canViewHistory: false,
      canReceiveLab: true,
      canValidateCleaning: true,
      canDeleteOrder: false
    },
    MECANICO: {
      canCreateOrder: false,
      fullEdit: false,
      canOverrideEdit: true,
      canViewHistory: false,
      editableSections: ["section1_general", "section2_times", "section3_parameters"],
      canCorrectRPM: true,
      canCorrectCleaning: true,
      canDeleteOrder: false
    }
  };

  // ============================================================
  // MÁQUINA DE ESTADOS (12 estados)
  // Claves sin espacios/acentos: pensadas para Apps Script / Sheets.
  // Son informativos y trazables, NO bloqueantes.
  // ============================================================
  const ORDER_STATUS_META = {
    CREADA: { label: "Creada", color: "blue" },
    PENDIENTE_MECANICO: { label: "Pendiente Mecánico", color: "orange" },
    EN_REGULACION: { label: "En regulación", color: "blue" },
    PENDIENTE_VALIDACION_RPM: { label: "Pendiente validación RPM", color: "yellow" },
    RECHAZADA_RPM: { label: "RPM rechazada", color: "red" },
    PENDIENTE_REVALIDACION_RPM: { label: "Pendiente de revalidación RPM", color: "orange" },
    RPM_APROBADA: { label: "RPM aprobada", color: "green" },
    PENDIENTE_LABORATORIO: { label: "Pendiente Laboratorio", color: "yellow" },
    LABORATORIO_RECIBIDO: { label: "Laboratorio recibido", color: "green" },
    LIMPIEZA_RECHAZADA: { label: "Limpieza rechazada", color: "red" },
    LIMPIEZA_CORREGIDA_PENDIENTE_LABORATORIO: { label: "Limpieza corregida · pendiente Laboratorio", color: "orange" },
    LIMPIEZA_APROBADA: { label: "Limpieza aprobada", color: "green" },
    PENDIENTE_CIERRE: { label: "Pendiente cierre", color: "blue" },
    CERRADA: { label: "Cerrada", color: "green" },
    CERRADA_CON_OBSERVACIONES: { label: "Cerrada con observaciones", color: "orange" },
    CERRADA_MAX_RECHAZOS_RPM: { label: "Cerrada por máximo de rechazos RPM", color: "red" },
    CERRADA_MAX_FALLOS_LIMPIEZA: { label: "Cerrada por máximo de fallos de limpieza", color: "red" }
  };

  ORDER_STATUS_META.ELIMINADA = { label: "Eliminada", color: "red" };

  const STATUS_GROUPS = {
    pendientes: ["PENDIENTE_MECANICO", "PENDIENTE_VALIDACION_RPM", "PENDIENTE_REVALIDACION_RPM", "PENDIENTE_LABORATORIO", "LIMPIEZA_CORREGIDA_PENDIENTE_LABORATORIO", "PENDIENTE_CIERRE"],
    enProceso: ["CREADA", "EN_REGULACION", "RPM_APROBADA", "LABORATORIO_RECIBIDO", "LIMPIEZA_APROBADA"],
    rechazadas: ["RECHAZADA_RPM", "LIMPIEZA_RECHAZADA"],
    completadas: ["CERRADA", "CERRADA_CON_OBSERVACIONES", "CERRADA_MAX_RECHAZOS_RPM", "CERRADA_MAX_FALLOS_LIMPIEZA"]
  };

  // Flujo visual: estados agrupados en 5 grandes etapas.
  const FLOW_STAGES = [
    { key: "creacion", label: "Creación", help: "Supervisor", statuses: ["CREADA", "PENDIENTE_MECANICO"] },
    { key: "mecanico", label: "Mecánico", help: "Mecánico", statuses: ["EN_REGULACION", "RECHAZADA_RPM", "PENDIENTE_REVALIDACION_RPM"] },
    { key: "rpm", label: "Validación RPM", help: "PCP / Supervisor", statuses: ["PENDIENTE_VALIDACION_RPM", "RPM_APROBADA"] },
    { key: "lab", label: "Laboratorio", help: "Recibido / Limpieza", statuses: ["PENDIENTE_LABORATORIO", "LABORATORIO_RECIBIDO", "LIMPIEZA_RECHAZADA", "LIMPIEZA_CORREGIDA_PENDIENTE_LABORATORIO", "LIMPIEZA_APROBADA"] },
    { key: "cierre", label: "Cierre", help: "Supervisor", statuses: ["PENDIENTE_CIERRE", "CERRADA", "CERRADA_CON_OBSERVACIONES", "CERRADA_MAX_RECHAZOS_RPM", "CERRADA_MAX_FALLOS_LIMPIEZA"] }
  ];

  const MAX_CYCLES = 5;
  const MAX_SIGNATURES_PER_PROFILE = 5;
  const SIGNATURE_PROFILE_CODE = { SUPERVISOR: "SUPER", MECANICO: "MECA", PCP: "PCP", LABORATORIO: "LABO" };

  const state = {
    session: { profile: "", usuario: "", rol: "", shift: "Mañana" },
    loginProfiles: [],
    catalogs: { supervisores: [], maquinas: [] },
    orders: [],
    currentOrderId: null,
    activeTab: "fill"
  };

  // ============================================================
  // ADAPTADOR DE DATOS
  // HOY: mock frontend. FUTURO: reemplazar por fetch() a Apps Script.
  // ============================================================
  function normalizeOrderShape(o) {
    const sig = o.signatures || {};
    const asArray = (v) => Array.isArray(v) ? v : [];
    return {
      ...o,
      rpmValidationAttempts: asArray(o.rpmValidationAttempts),
      mechanicCorrections: asArray(o.mechanicCorrections),
      laboratoryReceipts: asArray(o.laboratoryReceipts),
      cleaningAttempts: asArray(o.cleaningAttempts),
      rpmCycleCount: Number(o.rpmCycleCount) || 0,
      cleaningCycleCount: Number(o.cleaningCycleCount) || 0,
      signatures: {
        SUPERVISOR: asArray(sig.SUPERVISOR),
        MECANICO: asArray(sig.MECANICO),
        PCP: asArray(sig.PCP),
        LABORATORIO: asArray(sig.LABORATORIO)
      },
      status: ORDER_STATUS_META[o.status] ? o.status : "CREADA"
    };
  }

  function mapBackendSignature(row, index) {
    const code = row[`FIRMA_${index}_CODIGO`];
    if (!code) return null;
    return {
      code,
      name: row[`FIRMA_${index}_USUARIO`] || "",
      tipo: index === 1 ? "EMISION" : "EDICION",
      timestamp: row[`FIRMA_${index}_FECHA_HORA`] || ""
    };
  }

  function mapBackendHistory(rows = []) {
    return rows.map((row) => ({
      id: row.EVENT_ID || uid(),
      orderId: row.ORDER_ID || "",
      timestamp: row.TIMESTAMP || "",
      profile: row.PERFIL || "",
      profileLabel: PROFILE_LABELS[row.PERFIL] || row.PERFIL || "",
      user: row.USUARIO || "",
      action: row.ACCION || "",
      section: row.SECCION || "",
      changes: safeJsonParse(row.CAMBIOS_JSON, []),
      previousStatus: row.ESTADO_ANTERIOR || "",
      newStatus: row.ESTADO_NUEVO || "",
      detail: row.DETALLE || ""
    })).reverse();
  }

  function mapBackendRpmAttempt(row) {
    return {
      attempt: Number(row.INTENTO_RPM) || 0,
      mechanicRpm: Number(row.RPM_DECLARADA) || 0,
      measuredRpm: Number(row.RPM_MEDIDA) || 0,
      difference: Number(row.DIFERENCIA_RPM) || 0,
      differencePercent: Number(row.DIFERENCIA_PCT) || 0,
      tolerancePercent: Number(row.TOLERANCIA_PCT) || 0,
      withinTolerance: String(row.DENTRO_TOLERANCIA).toLowerCase() === "true",
      decision: row.DECISION || "",
      reason: row.MOTIVO || "",
      validator: row.VALIDADOR || "",
      validatorProfile: row.PERFIL_VALIDADOR || "PCP",
      timestamp: row.FECHA_HORA_EVENTO || row.FIRMA_FECHA_HORA || ""
    };
  }

  function mapBackendLabReceipt(row) {
    const type = String(row.TIPO_EVENTO || "");
    return {
      receivedBy: row.RECIBIDO_POR || row.FIRMA_USUARIO || "",
      profile: row.PERFIL_RESPONSABLE || "LABORATORIO",
      timestamp: row.FECHA_HORA_EVENTO || row.FIRMA_FECHA_HORA || "",
      corrected: type === "RECEPCION_CORRECCION",
      signatureCode: row.FIRMA_CODIGO || ""
    };
  }

  function mapBackendMechanicCorrections(rows = []) {
    return rows
      .filter((row) => String(row.ACCION || "") === "RPM_CORREGIDA")
      .map((row, index) => {
        const changes = safeJsonParse(row.CAMBIOS_JSON, []);
        const rpmChange = (changes || []).find((c) => c.field === "RPM_CIL_FRONTAL");
        return {
          attempt: index + 1,
          newDeclaredRpm: Number(rpmChange?.after) || 0,
          note: row.DETALLE || "",
          mechanic: row.USUARIO || "",
          timestamp: row.TIMESTAMP || ""
        };
      });
  }

  function mapBackendCleaningAttempt(row, index) {
    return {
      attempt: index + 1,
      decision: row.DECISION || (String(row.TIPO_EVENTO || "").includes("APROBADA") ? "APROBADA" : "RECHAZADA"),
      reason: row.MOTIVO || "",
      validator: row.RECIBIDO_POR || row.FIRMA_USUARIO || "",
      timestamp: row.FECHA_HORA_EVENTO || row.FIRMA_FECHA_HORA || "",
      signatureCode: row.FIRMA_CODIGO || ""
    };
  }

  function mapBackendOrder(data) {
    const master = data?.master || data || {};
    const supervisor = data?.supervisor || {};
    const mechanic = data?.mecanico || {};
    const signatures = { SUPERVISOR: [], MECANICO: [], PCP: [], LABORATORIO: [] };

    for (let i = 1; i <= MAX_SIGNATURES_PER_PROFILE; i++) {
      const sig = mapBackendSignature(supervisor, i);
      if (sig) signatures.SUPERVISOR.push(sig);
    }

    for (let i = 1; i <= MAX_SIGNATURES_PER_PROFILE; i++) {
      const sig = mapBackendSignature(mechanic, i);
      if (sig) signatures.MECANICO.push(sig);
    }

    (data?.pcp || []).forEach((row) => {
      if (!row.FIRMA_CODIGO) return;
      const profile = row.PERFIL_VALIDADOR === "SUPERVISOR" ? "SUPERVISOR" : "PCP";
      signatures[profile].push({
        code: row.FIRMA_CODIGO,
        name: row.FIRMA_USUARIO || row.VALIDADOR || "",
        tipo: row.PERFIL_VALIDADOR === "SUPERVISOR" ? "VALIDACION_RPM_SUSTITUTA" : `RPM_${row.DECISION || ""}`,
        timestamp: row.FIRMA_FECHA_HORA || row.FECHA_HORA_EVENTO || ""
      });
    });

    (data?.laboratorio || []).forEach((row) => {
      if (!row.FIRMA_CODIGO) return;
      if (row.PERFIL_RESPONSABLE === "MECANICO") return;
      signatures.LABORATORIO.push({
        code: row.FIRMA_CODIGO,
        name: row.FIRMA_USUARIO || row.RECIBIDO_POR || "",
        tipo: row.TIPO_EVENTO || "LABORATORIO",
        timestamp: row.FIRMA_FECHA_HORA || row.FECHA_HORA_EVENTO || ""
      });
    });

    if (!signatures.SUPERVISOR.length && master.FIRMA_SUPER_VIGENTE) {
      signatures.SUPERVISOR.push({
        code: master.FIRMA_SUPER_VIGENTE,
        name: master.ULTIMO_RESPONSABLE || "",
        tipo: "EMISION",
        timestamp: master.FECHA_HORA_ULTIMA_ACTUALIZACION || ""
      });
    }

    if (!signatures.MECANICO.length && master.FIRMA_MECA_VIGENTE) {
      signatures.MECANICO.push({
        code: master.FIRMA_MECA_VIGENTE,
        name: master.ULTIMO_RESPONSABLE || "",
        tipo: "EMISION",
        timestamp: master.FECHA_HORA_ULTIMA_ACTUALIZACION || ""
      });
    }

    const rpmAttempts = (data?.pcp || []).map(mapBackendRpmAttempt);
    const lastRpmAttempt = rpmAttempts[rpmAttempts.length - 1] || null;

    return normalizeOrderShape({
      id: master.ORDER_ID || "",
      code: master.CODIGO_OC || "",
      createdAt: master.FECHA_HORA_CREACION || "",
      updatedAt: master.FECHA_HORA_ULTIMA_ACTUALIZACION || master.FECHA_HORA_CREACION || "",
      status: master.ESTADO || "CREADA",
      version: Number(master.VERSION) || 1,
      createdByProfile: master.CREADO_POR_PERFIL || "",
      createdBy: master.CREADO_POR_USUARIO || "",
      date: normalizeDateInput(master.FECHA || master.FECHA_CREACION),
      machine: master.MAQUINA || "",
      shift: master.TURNO || state.session.shift || "Mañana",
      articulo: master.ARTICULO || "",
      lote: master.LOTE || "",
      fromNe: master.DE_NE || "",
      toNe: master.A_NE || "",
      mechanic: master.MECANICO || mechanic.MECANICO || "",
      supervisor: master.SUPERVISOR || supervisor.SUPERVISOR || "",
      startTime: master.HORA_INICIO || mechanic.HORA_INICIO || supervisor.HORA_INICIO || "",
      endTime: master.HORA_FIN || mechanic.HORA_FIN || supervisor.HORA_FIN || "",
      observations: supervisor.OBSERVACION || "",
      productionControl: master.CONTROL_PRODUCCION || mechanic.CONTROL_PRODUCCION || "",
      rpmMechanic: master.RPM_CIL_FRONTAL || mechanic.RPM_CIL_FRONTAL || "",
      metersMinute: master.MTS_MIN || mechanic.MTS_MIN || "",
      assistantDT: master.ASISTENTE_DT || mechanic.ASISTENTE_DT || "",
      rpmMeasured: lastRpmAttempt ? String(lastRpmAttempt.measuredRpm || "") : "",
      rpmValidationAttempts: rpmAttempts,
      mechanicCorrections: mapBackendMechanicCorrections(data?.historial || []),
      laboratoryReceipts: (data?.laboratorio || [])
        .filter((row) => ["RECEPCION", "RECEPCION_CORRECCION"].includes(String(row.TIPO_EVENTO || "")))
        .map(mapBackendLabReceipt),
      cleaningAttempts: (data?.laboratorio || [])
        .filter((row) => ["LIMPIEZA_APROBADA", "LIMPIEZA_RECHAZADA"].includes(String(row.TIPO_EVENTO || "")))
        .map(mapBackendCleaningAttempt),
      rpmCycleCount: Number(master.CICLO_RPM_ACTUAL) || 0,
      cleaningCycleCount: Number(master.CICLO_LIMPIEZA_ACTUAL) || 0,
      signatures,
      history: mapBackendHistory(data?.historial || []),
      closeNote: master.CIERRE_ACLARACION || ""
    });
  }

  function safeJsonParse(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function normalizeDateInput(value) {
    const text = String(value || "");
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    return isoDate();
  }

  function orderToSupervisorPayload(order) {
    return {
      fecha: order.date || "",
      maquina: order.machine || "",
      turno: order.shift || "",
      articulo: order.articulo || "",
      lote: order.lote || "",
      deNe: order.fromNe || "",
      aNe: order.toNe || "",
      mecanico: order.mechanic || "",
      supervisor: order.supervisor || "",
      horaInicio: order.startTime || "",
      horaFin: order.endTime || "",
      observacion: order.observations || "",
      controlProduccion: order.productionControl || "",
      rpmCilFrontal: order.rpmMechanic || "",
      mtsMin: order.metersMinute || "",
      asistenteDt: order.assistantDT || ""
    };
  }

  function orderToMechanicPayload(order) {
    return {
      fecha: order.date || "",
      maquina: order.machine || "",
      turno: order.shift || "",
      articulo: order.articulo || "",
      lote: order.lote || "",
      deNe: order.fromNe || "",
      aNe: order.toNe || "",
      mecanico: order.mechanic || "",
      supervisor: order.supervisor || "",
      horaInicio: order.startTime || "",
      horaFin: order.endTime || "",
      observacion: order.observations || "",
      controlProduccion: order.productionControl || "",
      rpmCilFrontal: order.rpmMechanic || "",
      mtsMin: order.metersMinute || "",
      asistenteDt: order.assistantDT || ""
    };
  }

  const dataAdapter = {
    load() {
      if (!CONFIG.USE_LOCAL_STORAGE_MOCK) return { orders: [] };
      try {
        const raw = localStorage.getItem(LS_KEY);
        const parsed = raw ? JSON.parse(raw) : { orders: [] };
        parsed.orders = (parsed.orders || []).map(normalizeOrderShape);
        return parsed;
      } catch {
        return { orders: [] };
      }
    },
    save(payload) {
      if (!CONFIG.USE_LOCAL_STORAGE_MOCK) return;
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(payload));
      } catch (err) {
        console.error("No se pudo guardar en localStorage:", err);
        alert(
          "No se pudo guardar la orden en este dispositivo (almacenamiento lleno o no disponible). " +
          "El cambio quedó solo en esta pantalla; anótelo o reintente antes de recargar o cambiar de perfil."
        );
      }
    },
    async fetchCatalogs() {
      const catalogs = await apiGet("getCatalogs");
      state.catalogs.supervisores = Array.isArray(catalogs.supervisores) ? catalogs.supervisores : [];
      state.catalogs.maquinas = Array.isArray(catalogs.maquinas) ? catalogs.maquinas : [];
      return state.catalogs;
    },
    async fetchOrders() {
      const rows = await apiGet("getOrders");
      return (Array.isArray(rows) ? rows : []).map(mapBackendOrder);
    },
    async fetchOrder(orderId) {
      const result = await apiGet("getOrder", { ORDER_ID: orderId });
      return mapBackendOrder(result);
    },
    async createOrder(data = {}) {
      const result = await apiPost("createOrder", {
        profile: state.session.profile,
        usuario: state.session.usuario || PROFILE_LABELS[state.session.profile] || state.session.profile,
        shift: state.session.shift,
        data
      });
      return mapBackendOrder(result);
    },
    async signSupervisor(order) {
      const result = await apiPost("signSupervisor", {
        ORDER_ID: order.id,
        expectedVersion: order.version,
        usuario: state.session.usuario || PROFILE_LABELS.SUPERVISOR,
        data: orderToSupervisorPayload(order)
      });
      return mapBackendOrder(result);
    },
    async sendToMechanic(order) {
      const result = await apiPost("sendToMechanic", {
        ORDER_ID: order.id,
        expectedVersion: order.version,
        usuario: state.session.usuario || PROFILE_LABELS.SUPERVISOR
      });
      return mapBackendOrder(result);
    },
    async startRegulation(order) {
      const result = await apiPost("startRegulation", {
        ORDER_ID: order.id,
        expectedVersion: order.version,
        usuario: state.session.usuario || PROFILE_LABELS.MECANICO,
        data: orderToMechanicPayload(order)
      });
      return mapBackendOrder(result);
    },
    async signMechanic(order) {
      const result = await apiPost("signMechanic", {
        ORDER_ID: order.id,
        expectedVersion: order.version,
        usuario: state.session.usuario || PROFILE_LABELS.MECANICO,
        data: orderToMechanicPayload(order)
      });
      return mapBackendOrder(result);
    },
    async validateRPM(order, validation) {
      const result = await apiPost("validateRpm", {
        ORDER_ID: order.id,
        expectedVersion: order.version,
        profile: state.session.profile,
        usuario: state.session.usuario || PROFILE_LABELS[state.session.profile] || state.session.profile,
        decision: validation.decision,
        reason: validation.reason || "",
        rpmDeclarada: validation.mechanicRpm,
        rpmMedida: validation.measuredRpm,
        mtsMin: order.metersMinute || ""
      });
      return mapBackendOrder(result);
    },
    async correctMechanicRpm(order, correction) {
      const result = await apiPost("correctMechanicRpm", {
        ORDER_ID: order.id,
        expectedVersion: order.version,
        usuario: state.session.usuario || PROFILE_LABELS.MECANICO,
        rpmDeclarada: correction.newDeclaredRpm,
        note: correction.note || ""
      });
      return mapBackendOrder(result);
    },
    async registerLabReceipt(order) {
      const result = await apiPost("registerLabReceipt", {
        ORDER_ID: order.id,
        expectedVersion: order.version,
        usuario: state.session.usuario || PROFILE_LABELS.LABORATORIO
      });
      return mapBackendOrder(result);
    },
    async validateCleaning(order, validation) {
      const result = await apiPost("validateCleaning", {
        ORDER_ID: order.id,
        expectedVersion: order.version,
        usuario: state.session.usuario || PROFILE_LABELS.LABORATORIO,
        decision: validation.decision,
        reason: validation.reason || ""
      });
      return mapBackendOrder(result);
    },
    async markCleaningCorrected(order) {
      const result = await apiPost("markCleaningCorrected", {
        ORDER_ID: order.id,
        expectedVersion: order.version,
        usuario: state.session.usuario || PROFILE_LABELS.MECANICO
      });
      return mapBackendOrder(result);
    },
    async saveOrder(order) { return order; },
    async updateOrder(order) { return order; },
    async registerHistory(orderId, event) { return { orderId, event }; },
    async registerSignature(orderId, signature) { return { orderId, signature }; },
    async closeOrder(order, closeData = {}) {
      const result = await apiPost("closeOrder", {
        ORDER_ID: order.id,
        expectedVersion: order.version,
        usuario: state.session.usuario || PROFILE_LABELS.SUPERVISOR,
        forced: !!closeData.forced,
        irregular: !!closeData.irregular,
        note: closeData.note || ""
      });
      return mapBackendOrder(result);
    },
    async deleteOrder(order, reason = "") {
      return apiPost("deleteOrder", {
        ORDER_ID: order.id,
        expectedVersion: order.version,
        profile: state.session.profile,
        usuario: state.session.usuario || PROFILE_LABELS[state.session.profile] || state.session.profile,
        reason
      });
    }
  };

  // ============================================================
  // UTILIDADES COMPARTIDAS
  // ============================================================
  const $ = (id) => document.getElementById(id);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const now = () => new Date();
  const isoDate = (d = now()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const timeHHMM = (d = now()) => d.toTimeString().slice(0, 5);
  const stamp = (d = now()) => d.toISOString();
  const formatDateTime = (value) => {
    if (!value) return "—";
    const d = new Date(value);
    return d.toLocaleString("es-PE", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  };
  const formatTime = (value) => {
    if (!value) return "—";
    const d = new Date(value);
    return d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
  };
  const uid = () => "tmp-" + Date.now() + "-" + Math.random().toString(16).slice(2);

  function normalizeProfileName(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  }

  function getProfileKeyFromName(value) {
    return LOGIN_PROFILE_MAP[normalizeProfileName(value)] || "";
  }

  function getPermissions(profile = state.session.profile) {
    return PROFILE_PERMISSIONS[profile] || {};
  }

  class ApiError extends Error {
    constructor(code, message) {
      super(message || code);
      this.code = code || "API_ERROR";
    }
  }

  const API_ERROR_MESSAGES = {
    API_URL_EMPTY: "La aplicación todavía no está conectada a Google Sheets (falta configurar la URL del backend en config.js).",
    VERSION_CONFLICT: "Esta orden fue actualizada por otro usuario. Actualice la orden antes de continuar.",
    MAX_SIGNATURES_REACHED: "Se alcanzó el máximo de 5 firmas de este perfil para esta orden.",
    FORBIDDEN: "Su perfil no tiene permiso para realizar esta acción.",
    ORDER_ALREADY_DELETED: "Esta orden ya fue eliminada.",
    CLOSE_REQUIREMENTS_NOT_MET: "Faltan requisitos para el cierre normal. Use \"Forzar cierre\" si corresponde.",
    UNKNOWN_ACTION: "La aplicación pidió una acción que el backend no reconoce. Puede ser una versión desactualizada."
  };

  function describeApiError(err) {
    const code = err && err.code;
    if (code && API_ERROR_MESSAGES[code]) return API_ERROR_MESSAGES[code];
    if (code && /^HTTP_/.test(code)) return "No se pudo conectar con Google Sheets (error de red/servidor). Intente nuevamente.";
    return (err && err.message) || "No se pudo completar la acción con Google Sheets. Intente nuevamente.";
  }

  // ============================================================
  // MODAL DE CARGA — visible para toda acción que hable con Google Sheets.
  // Centralizado aquí (no en cada botón) para cubrir automáticamente
  // cualquier llamada presente o futura que pase por apiGet/apiPost.
  // ============================================================
  const API_LOADING_MESSAGES = {
    getLoginProfiles: "Cargando perfiles desde Google Sheets...",
    getCatalogs: "Cargando catálogos desde Google Sheets...",
    getOrders: "Cargando órdenes desde Google Sheets...",
    getOrder: "Abriendo orden desde Google Sheets...",
    createOrder: "Creando orden en Google Sheets...",
    signSupervisor: "Guardando firma de Supervisor en Google Sheets...",
    sendToMechanic: "Enviando orden a Mecánico...",
    startRegulation: "Guardando inicio de regulación...",
    signMechanic: "Guardando firma de Mecánico en Google Sheets...",
    correctMechanicRpm: "Guardando corrección de RPM en Google Sheets...",
    validateRpm: "Guardando validación de RPM en Google Sheets...",
    registerLabReceipt: "Registrando recepción de Laboratorio...",
    validateCleaning: "Guardando decisión de limpieza en Google Sheets...",
    markCleaningCorrected: "Guardando corrección de limpieza...",
    closeOrder: "Cerrando orden en Google Sheets...",
    deleteOrder: "Eliminando orden en Google Sheets..."
  };

  let activeApiRequests = 0;
  function showLoadingOverlay(message) {
    const text = $("loadingOverlayText");
    const overlay = $("loadingOverlay");
    if (text) text.textContent = message || "Sincronizando con Google Sheets...";
    if (overlay) overlay.classList.remove("hidden");
  }
  function hideLoadingOverlay() {
    const overlay = $("loadingOverlay");
    if (overlay) overlay.classList.add("hidden");
  }
  async function withLoadingOverlay(action, fn) {
    activeApiRequests++;
    showLoadingOverlay(API_LOADING_MESSAGES[action]);
    try {
      return await fn();
    } finally {
      activeApiRequests--;
      if (activeApiRequests <= 0) {
        activeApiRequests = 0;
        hideLoadingOverlay();
      }
    }
  }

  async function apiGet(action, params = {}) {
    return withLoadingOverlay(action, () => apiGetRaw(action, params));
  }

  async function apiGetRaw(action, params = {}) {
    const apiUrl = String(CONFIG.API_URL || "").trim();
    if (!apiUrl) throw new ApiError("API_URL_EMPTY");

    const url = new URL(apiUrl);
    url.searchParams.set("action", action);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });

    const response = await fetch(url.toString(), { method: "GET" });
    if (!response.ok) throw new ApiError(`HTTP_${response.status}`);

    const payload = await response.json();
    if (!payload.ok) throw new ApiError(payload.code || "API_ERROR", payload.message);
    return payload.data;
  }

  async function apiPost(action, payload = {}) {
    return withLoadingOverlay(action, () => apiPostRaw(action, payload));
  }

  async function apiPostRaw(action, payload = {}) {
    const apiUrl = String(CONFIG.API_URL || "").trim();
    if (!apiUrl) throw new ApiError("API_URL_EMPTY");

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, payload })
    });
    if (!response.ok) throw new ApiError(`HTTP_${response.status}`);

    const data = await response.json();
    if (!data.ok) throw new ApiError(data.code || "API_ERROR", data.message);
    return data.data;
  }

  async function syncFromBackend({ checkLogin = false } = {}) {
    if (checkLogin && OC.login?.loadLoginProfiles) {
      await OC.login.loadLoginProfiles({ checkCurrentSession: true });
    }

    await dataAdapter.fetchCatalogs();
    const previousId = state.currentOrderId;
    state.orders = await dataAdapter.fetchOrders();

    if (previousId && state.orders.some((order) => order.id === previousId)) {
      state.currentOrderId = previousId;
    } else {
      // No autoseleccionar la primera orden: Visualización/Llenado deben quedar
      // vacíos hasta que el usuario presione "Abrir" en Registro de Ordenes.
      state.currentOrderId = null;
    }

    if (OC.tabFill?.populateCatalogs) OC.tabFill.populateCatalogs();
    if (state.currentOrderId && OC.tabFill?.loadOrderToForm) {
      OC.tabFill.loadOrderToForm(getCurrentOrder());
    } else {
      renderAll();
    }
  }

  function getCurrentOrder() {
    return state.orders.find(o => o.id === state.currentOrderId) || null;
  }

  function persist() {
    dataAdapter.save({ orders: state.orders });
  }

  function generateTemporaryOrderCode() {
    /**
     * BACKEND FUTURO:
     * El correlativo definitivo debe generarse en Apps Script / Google Sheets
     * para evitar duplicados con varios dispositivos conectados a la vez.
     * Formato previsto: OC-2026-0001
     */
    const year = new Date().getFullYear();
    const seq = String(state.orders.length + 1).padStart(4, "0");
    return `OC-${year}-${seq}`;
  }

  function addHistory(order, action, detail, extra = {}) {
    const event = {
      id: uid(),
      orderId: order.id,
      timestamp: stamp(),
      profile: state.session.profile,
      profileLabel: PROFILE_LABELS[state.session.profile] || state.session.profile,
      user: extra.user || getActorName(),
      action,
      section: extra.section || null,
      changes: extra.changes || [],
      previousStatus: extra.previousStatus ?? order.status,
      newStatus: extra.newStatus ?? order.status,
      detail: detail || ""
    };
    order.history.unshift(event);
    order.updatedAt = event.timestamp;
    dataAdapter.registerHistory(order.id, event);
  }

  function getActorName() {
    const order = getCurrentOrder();
    if (state.session.profile === "MECANICO") return $("mechanicSelect").value || "Mecánico";
    if (state.session.profile === "SUPERVISOR") return $("supervisorName").value || "Supervisor de Turno";
    if (state.session.profile === "PCP") return "PCP Hilandería";
    if (state.session.profile === "LABORATORIO") return "Laboratorio";
    if (state.session.profile === "JEFATURA") return "Jefe de Planta";
    return order?.lastActor || "Usuario";
  }

  function safeText(v) {
    return (v === undefined || v === null || String(v).trim() === "") ? "—" : String(v);
  }

  function escapeHtml(str = "") {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function statusClass(status) {
    const meta = ORDER_STATUS_META[status];
    return meta ? `status-${meta.color}` : "status-neutral";
  }

  function getLatestRpmAttempt(order) {
    return order.rpmValidationAttempts[order.rpmValidationAttempts.length - 1] || null;
  }

  function getCurrentDeclaredRpm(order) {
    const corrections = order.mechanicCorrections;
    if (corrections.length) return corrections[corrections.length - 1].newDeclaredRpm;
    return order.rpmMechanic;
  }

  function createBlankOrder() {
    return {
      id: uid(),
      code: generateTemporaryOrderCode(),
      createdAt: stamp(),
      updatedAt: stamp(),
      status: "CREADA",
      createdByProfile: state.session.profile,
      createdBy: getActorName(),
      date: isoDate(),
      machine: "",
      shift: state.session.shift || "Mañana",
      fromNe: "",
      toNe: "",
      mechanic: "",
      supervisor: "",
      startTime: "",
      endTime: "",
      observations: "",
      productionControl: "",
      rpmMechanic: "",
      metersMinute: "",
      assistantDT: "",
      rpmMeasured: "",
      rpmValidationAttempts: [],
      mechanicCorrections: [],
      laboratoryReceipts: [],
      cleaningAttempts: [],
      rpmCycleCount: 0,
      cleaningCycleCount: 0,
      signatures: { SUPERVISOR: [], MECANICO: [], PCP: [], LABORATORIO: [] },
      history: [],
      closeNote: ""
    };
  }

  // ============================================================
  // FIRMAS (código técnico, máximo 5 por perfil por orden)
  // ============================================================
  function canSign(order, profile) {
    return (order.signatures[profile] || []).length < MAX_SIGNATURES_PER_PROFILE;
  }

  function generateSignatureCode(order, profile, d = now()) {
    const yyyymmdd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const hhmmss = `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
    return `${order.code}_${SIGNATURE_PROFILE_CODE[profile]}_${yyyymmdd}_${hhmmss}`;
  }

  function registerSignature(order, profile, tipo) {
    const sig = {
      code: generateSignatureCode(order, profile),
      name: getActorName(),
      tipo,
      timestamp: stamp()
    };
    order.signatures[profile].push(sig);
    dataAdapter.registerSignature(order.id, sig);
    return sig;
  }

  function calculateRpmComparison(declared, measured) {
    const d = Number(declared);
    const m = Number(measured);
    if (!d || !m) return null;

    const difference = m - d;
    const percent = Math.abs(difference) / d * 100;
    const tolerance = Number(CONFIG.RPM_TOLERANCE_PERCENT ?? 5);

    return { difference, percent, withinTolerance: percent <= tolerance, tolerance };
  }

  function openModal(id) { $(id).classList.remove("hidden"); }
  function closeModal(id) { $(id).classList.add("hidden"); }

  function setTab(name) {
    const visibleTabs = OC.login.getVisibleTabs();
    if (visibleTabs && !visibleTabs.includes(name)) name = visibleTabs[0];

    state.activeTab = name;
    $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    $$(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${name}`));

    if (name === "preview") {
      OC.tabFill.collectFormIntoOrder();
      OC.tabPreview.renderPreview(getCurrentOrder());
    }
    if (name === "history") {
      OC.tabHistory.onShow();
    }
  }

  // Dispatcher: cada módulo de pestaña resuelve su propio render.
  function renderAll() {
    const order = getCurrentOrder();
    OC.tabFill.renderOrderBadge(order);
    OC.tabFill.renderFlow(order);
    OC.tabFill.renderHistory(order);
    OC.tabFill.renderSignatures(order);
    OC.tabFill.renderLab(order);
    OC.tabFill.renderRpmAttempts(order);
    OC.tabFill.renderMechanicCorrections(order);
    OC.tabFill.renderCleaningAttempts(order);
    OC.login.renderSectionVisibility(order);
    OC.login.renderActionVisibility(order);
    OC.tabFill.renderCloseChecklist(order);
    OC.tabPreview.renderPreview(order);
    OC.tabRegistry.renderRegistry();
    OC.tabFill.syncVisualStatus();
  }

  // Chrome global: topbar + navegación de tabs + cierre genérico de modales.
  function initNav() {
    $("newOrderBtn").addEventListener("click", () => OC.tabFill.startNewOrder());
    $("refreshBtn").addEventListener("click", async () => {
      const btn = $("refreshBtn");
      const previousText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Actualizando...";
      try {
        await syncFromBackend({ checkLogin: true });
        btn.textContent = "Actualizado";
        setTimeout(() => { btn.textContent = previousText; }, 1200);
      } catch (err) {
        alert("No se pudo sincronizar con Google Sheets.");
        btn.textContent = previousText;
      } finally {
        btn.disabled = false;
      }
    });
    $$(".tab").forEach(tab => tab.addEventListener("click", () => setTab(tab.dataset.tab)));
    $$("[data-close-modal]").forEach(btn => {
      btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
    });
  }

  Object.assign(window.OC, {
    CONFIG, MACHINES, LOGIN_PROFILE_MAP, PROFILE_LABELS, PROFILE_PERMISSIONS,
    ORDER_STATUS_META, STATUS_GROUPS, FLOW_STAGES,
    MAX_CYCLES, MAX_SIGNATURES_PER_PROFILE,
    state, dataAdapter,
    util: { $, $$, now, isoDate, timeHHMM, stamp, formatDateTime, formatTime, uid },
    normalizeProfileName, getProfileKeyFromName, getPermissions, apiGet, apiPost, syncFromBackend,
    ApiError, describeApiError,
    getCurrentOrder, persist, generateTemporaryOrderCode, addHistory, getActorName,
    safeText, escapeHtml, statusClass, getLatestRpmAttempt, getCurrentDeclaredRpm,
    createBlankOrder, calculateRpmComparison, openModal, closeModal, setTab, renderAll, initNav,
    canSign, registerSignature, generateSignatureCode
  });
})();
