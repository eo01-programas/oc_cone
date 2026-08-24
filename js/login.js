(() => {
  "use strict";

  const { $, $$ } = OC.util;
  const { state, PROFILE_LABELS, getPermissions, apiGet } = OC;

  const CLOSED_STATUSES = [
    "CERRADA",
    "CERRADA_CON_OBSERVACIONES",
    "CERRADA_MAX_RECHAZOS_RPM",
    "CERRADA_MAX_FALLOS_LIMPIEZA"
  ];

  function getVisibleTabs() {
    return null;
  }

  function setLoginStatus(message, isError = false) {
    const el = $("loginStatus");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("error", !!isError);
  }

  function setLoginLoading(isLoading) {
    $("profileSelect").disabled = isLoading;
    $("loginBtn").disabled = true;
    $("retryLoginProfilesBtn").classList.add("hidden");
    if (isLoading) setLoginStatus("Cargando perfiles...");
  }

  function populateLoginProfiles(profiles) {
    state.loginProfiles = Array.isArray(profiles) ? profiles : [];
    $("profileSelect").innerHTML =
      `<option value="">Seleccione...</option>` +
      state.loginProfiles.map((profile) => `
        <option value="${OC.escapeHtml(profile.profileKey)}"
          data-usuario="${OC.escapeHtml(profile.usuario)}"
          data-rol="${OC.escapeHtml(profile.rol)}">
          ${OC.escapeHtml(profile.usuario)}
        </option>
      `).join("");

    $("profileSelect").disabled = false;
    $("loginBtn").disabled = true;
    setLoginStatus("");
  }

  async function loadLoginProfiles({ checkCurrentSession = false } = {}) {
    setLoginLoading(true);

    try {
      const profiles = await apiGet("getLoginProfiles");
      populateLoginProfiles(profiles);

      if (checkCurrentSession && state.session.profile) {
        const stillActive = state.loginProfiles.some((profile) => profile.profileKey === state.session.profile);
        if (!stillActive) {
          alert("Este perfil fue desactivado. La sesión será cerrada.");
          logoutUser();
        }
      }
    } catch (err) {
      state.loginProfiles = [];
      $("profileSelect").innerHTML = `<option value="">Fallo conexión</option>`;
      $("profileSelect").disabled = true;
      $("loginBtn").disabled = true;
      $("retryLoginProfilesBtn").classList.remove("hidden");
      setLoginStatus("Fallo conexión", true);
    }
  }

  function applyProfilePermissions() {
    const p = state.session.profile;
    const permissions = getPermissions(p);

    $("approveRpmBtn").classList.toggle("hidden", !permissions.canValidateRPM);
    $("rejectRpmBtn").classList.toggle("hidden", !permissions.canValidateRPM);
    $("labReceivedBtn").classList.toggle("hidden", !permissions.canReceiveLab);
    $("closeOrderBtn").classList.toggle("hidden", !permissions.canCloseOrder);
    $("forceCloseBtn").classList.toggle("hidden", !permissions.canForceClose);
    $("newOrderBtn").classList.toggle("hidden", !permissions.canCreateOrder);

    const historyCard = $("historyTimeline")?.closest(".card");
    if (historyCard) historyCard.classList.toggle("hidden", !permissions.canViewHistory);

    OC.tabFill.applyFieldPermissions();

    $$(".tab").forEach(t => t.classList.remove("hidden"));
    // El histórico es una vista ampliada del mismo historial: mismo permiso que la tarjeta de Historial.
    $$('.tab[data-tab="history"]').forEach(t => t.classList.toggle("hidden", !permissions.canViewHistory));

    $("sessionMeta").textContent =
      `${PROFILE_LABELS[p] || p} · Turno ${state.session.shift}`;
  }

  function renderSectionVisibility(order) {
    const p = state.session.profile;
    const hasRejection = !!order && order.rpmValidationAttempts.some(a => a.decision === "RECHAZADA");

    $("rpmValidationCard").classList.toggle("hidden", p === "MECANICO" && !hasRejection);
    $("labCard").classList.toggle("hidden", p === "MECANICO");
    $("correctionCard").classList.toggle("hidden", !(p === "MECANICO" && order && order.status === "RECHAZADA_RPM"));
    $("cleaningCorrectionCard").classList.toggle("hidden", !(p === "MECANICO" && order && order.status === "LIMPIEZA_RECHAZADA"));

    $("labReceivedBtn").disabled = !order || !["PENDIENTE_LABORATORIO", "LIMPIEZA_CORREGIDA_PENDIENTE_LABORATORIO"].includes(order.status);
  }

  function renderActionVisibility(order) {
    const p = state.session.profile;
    const permissions = getPermissions(p);
    const show = (id, cond) => $(id).classList.toggle("hidden", !cond);

    show("supervisorSignBtn", p === "SUPERVISOR" && !!order && !CLOSED_STATUSES.includes(order.status));
    show("sendToMechanicBtn", p === "SUPERVISOR" && !!order && order.status === "CREADA");
    if (order) $("sendToMechanicBtn").disabled = !order.signatures.SUPERVISOR.length;

    show("startRegulationBtn", p === "MECANICO" && !!order && order.status === "PENDIENTE_MECANICO");
    show("mechanicSignBtn", p === "MECANICO" && !!order && order.status === "EN_REGULACION");

    show("approveCleaningBtn", permissions.canValidateCleaning && !!order && order.status === "LABORATORIO_RECIBIDO");
    show("rejectCleaningBtn", permissions.canValidateCleaning && !!order && order.status === "LABORATORIO_RECIBIDO");
  }

  function updateTurnVisibility() {
    const isPcp = $("profileSelect").value === "PCP";
    $("loginTurnField").classList.toggle("hidden", isPcp);
    if (isPcp) $("loginTurn").value = "Mañana";
  }

  async function loginUser() {
    const selected = $("profileSelect").selectedOptions[0];
    const profile = $("profileSelect").value;

    if (!profile) {
      alert("Seleccione un perfil.");
      return;
    }

    state.session.profile = profile;
    state.session.usuario = selected?.dataset.usuario || "";
    state.session.rol = selected?.dataset.rol || "";
    state.session.shift = profile === "PCP" ? "Mañana" : $("loginTurn").value;

    $("loginBtn").disabled = true;
    $("loginBtn").textContent = "Ingresando...";

    try {
      $("loginView").classList.add("hidden");
      $("mainView").classList.remove("hidden");

      applyProfilePermissions();
      await OC.syncFromBackend();
      OC.setTab("registry");
    } catch (err) {
      $("mainView").classList.add("hidden");
      $("loginView").classList.remove("hidden");
      alert("No se pudo sincronizar con Google Sheets.");
    } finally {
      $("loginBtn").textContent = "Ingresar";
      $("loginBtn").disabled = !$("profileSelect").value;
    }
  }

  function logoutUser() {
    state.session.profile = "";
    state.session.usuario = "";
    state.session.rol = "";
    state.session.shift = "Mañana";
    $("mainView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
    $("profileSelect").value = "";
    updateTurnVisibility();
    $("loginBtn").disabled = true;
  }

  function init() {
    $("profileSelect").addEventListener("change", () => {
      updateTurnVisibility();
      $("loginBtn").disabled = !$("profileSelect").value;
    });

    $("retryLoginProfilesBtn").addEventListener("click", () => loadLoginProfiles());
    $("loginBtn").addEventListener("click", loginUser);
    $("logoutBtn").addEventListener("click", logoutUser);

    loadLoginProfiles();
  }

  OC.login = {
    init,
    applyProfilePermissions,
    renderSectionVisibility,
    renderActionVisibility,
    getVisibleTabs,
    loadLoginProfiles,
    logoutUser
  };
})();
