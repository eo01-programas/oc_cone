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
    // Tras un rechazo de PCP la responsabilidad de corregir es del
    // Supervisor (no del Mecánico) -- ver PLAN_IMPLEMENTACION_FLUJO_PCP.md.
    // El Mecánico se conserva por si alguna orden sigue el camino anterior.
    $("correctionCard").classList.toggle("hidden", !((p === "MECANICO" || p === "SUPERVISOR") && order && order.status === "RECHAZADA_RPM"));
  }

  function renderActionVisibility(order) {
    const p = state.session.profile;
    const show = (id, cond) => $(id).classList.toggle("hidden", !cond);

    // "Guardar/Firmar/Enviar" ahora es una acción atómica delegada
    // (signAndDelegateSupervisor_ en code.gs): firma Supervisor (si hace
    // falta) + firma mecánica delegada + salto directo a
    // PENDIENTE_VALIDACION_RPM, sin pasar por el Mecánico. Por eso se
    // muestra en los 3 estados que la acción acepta -- no solo CREADA --
    // así el mismo botón también "migra" en caliente una orden que haya
    // quedado en PENDIENTE_MECANICO o EN_REGULACION de antes de este
    // cambio (ver PLAN_IMPLEMENTACION_FLUJO_PCP.md, Fase 5). El backend
    // es retry-safe: si ya tiene firma de Supervisor no la duplica.
    // "Enviar a Mecánico" (el envío manual del flujo anterior, dos pasos)
    // queda sin uso en esta ruta -- se deja de mostrar.
    const supervisorPendingStates = ["CREADA", "PENDIENTE_MECANICO", "EN_REGULACION"];
    show("supervisorSignBtn", p === "SUPERVISOR" && !!order && supervisorPendingStates.includes(order.status));

    show("startRegulationBtn", p === "MECANICO" && !!order && order.status === "PENDIENTE_MECANICO");
    show("mechanicSignBtn", p === "MECANICO" && !!order && order.status === "EN_REGULACION");
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

      // Arranca siempre en la sección global "Orden de Cambio" (por si
      // quedó en "Control de Paros" de una sesión anterior).
      OC.showSection("orden");

      // Mientras se traen los datos del backend (con el modal de carga
      // encima), mostrar la vista imprimible vacía en vez del formulario
      // de llenado vacío, que era lo que quedaba activo por defecto.
      // Toggle directo de clases (no setTab): es un estado transitorio,
      // no debe entrar al historial ni disparar validaciones de
      // "orden abierta". Después de sincronizar, setTab("registry")
      // deja todo en su lugar.
      $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === "preview"));
      $$(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-preview"));
      OC.tabPreview.renderPreview();

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
    // Limpia el marcador de historial de navegación: el próximo login
    // vuelve a fijar una base limpia (ver syncNavHistory en core.js).
    try { history.replaceState({ oc: false }, "", location.pathname + location.search); } catch (e) {}
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
