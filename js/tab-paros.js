(() => {
  "use strict";

  const { $, $$, formatDateTime, formatTime } = OC.util;
  const { state, escapeHtml, safeText, PARO_STAGE_LABELS, PARO_STAGE_PROFILES, PARO_STAGE_BY_STATUS, PARO_STATUS_META } = OC;

  // Mientras se firma/corrige una etapa, no se puede volver a abrir el
  // panel de lista -- pero el usuario si puede navegar lista<->detalle
  // libremente entre acciones.
  let activeParo = null;
  // Sello cuya fila de corrección está en modo confirmación ("Término de
  // Corrección" / "Cancelar" en vez del botón "Corrección").
  let correctingSello = null;

  function paroStatusClass(status) {
    const meta = PARO_STATUS_META[status];
    return meta ? `status-${meta.color}` : "status-neutral";
  }

  function formatDuration(ms) {
    if (ms === null || ms === undefined || Number.isNaN(ms) || ms < 0) return "—";
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  }

  function findParoByOrderId(orderId) {
    return state.paros.find((p) => p.orderId === orderId) || null;
  }

  // ============================================================
  // LISTA
  // ============================================================
  function renderList() {
    const tbody = $("parosBody");
    if (!tbody) return;

    if (!state.paros.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted">No hay paros para mostrar.</td></tr>`;
      return;
    }

    const rows = [...state.paros].sort((a, b) => {
      const orderA = state.orders.find((o) => o.id === a.orderId);
      const orderB = state.orders.find((o) => o.id === b.orderId);
      const ta = orderA?.createdAt ? new Date(orderA.createdAt).getTime() : 0;
      const tb = orderB?.createdAt ? new Date(orderB.createdAt).getTime() : 0;
      return tb - ta;
    });

    tbody.innerHTML = rows.map((p) => {
      const meta = PARO_STATUS_META[p.status];
      const etapa = p.currentStage ? PARO_STAGE_LABELS[p.currentStage] : (p.status === "FINALIZADO" ? "—" : "—");
      return `
      <tr>
        <td class="row-actions-cell">
          <button class="row-action" data-open-paro="${p.orderId}">Abrir</button>
        </td>
        <td><strong>${escapeHtml(p.code)}</strong></td>
        <td>${escapeHtml(safeText(p.machine))}</td>
        <td>${escapeHtml(safeText(p.articulo))} → ${escapeHtml(safeText(p.toNe))}</td>
        <td><span class="status-badge ${paroStatusClass(p.status)}">${escapeHtml(meta?.label || p.status)}</span></td>
        <td>${escapeHtml(etapa)}</td>
        <td>${formatDuration(p.totalMs)}</td>
      </tr>`;
    }).join("");

    $$("[data-open-paro]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const previousText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Abriendo...";
        try {
          await openParo(btn.dataset.openParo);
        } catch (error) {
          console.error("No se pudo abrir el Paro", error);
          alert("No se pudo abrir Control de Paros desde Google Sheets.");
        } finally {
          btn.disabled = false;
          btn.textContent = previousText;
        }
      });
    });
  }

  // ============================================================
  // DETALLE
  // ============================================================
  async function openParo(orderId) {
    correctingSello = null;
    activeParo = await OC.dataAdapter.fetchParo(orderId);
    state.activeParoId = orderId;
    showDetailPanel();
    renderDetail();
  }

  function showDetailPanel() {
    $("parosListPanel")?.classList.add("hidden");
    $("parosDetailPanel")?.classList.remove("hidden");
  }

  function showListPanel() {
    $("parosDetailPanel")?.classList.add("hidden");
    $("parosListPanel")?.classList.remove("hidden");
    state.activeParoId = null;
    activeParo = null;
    correctingSello = null;
  }

  async function refreshActiveParo() {
    if (!state.activeParoId) return;
    activeParo = await OC.dataAdapter.fetchParo(state.activeParoId);
    // Mantiene la lista general en sincronia sin esperar a un refresh manual.
    state.paros = state.paros.map((p) => (p.orderId === activeParo.orderId ? activeParo : p));
    renderDetail();
  }

  function stageRowHtml(n, paro) {
    const seal = paro.seals[n];
    const prevSeal = paro.seals[n - 1];
    const label = PARO_STAGE_LABELS[n];
    const omitida = seal.origen === "OMITIDA";
    const duration = omitida ? "Omitida" : formatDuration(paro.stageDurations[n - 1]);
    const closed = omitida || !!seal.hora;
    const canCorrect = n <= 5 && closed && !omitida;
    const allowedProfiles = PARO_STAGE_PROFILES[n] || [];
    const canActOnThisStage = allowedProfiles.includes(state.session.profile);

    let correctionCell = "";
    if (canCorrect) {
      if (correctingSello === n) {
        correctionCell = `
          <button type="button" class="btn btn-ghost btn-sm" data-cancel-correction>Cancelar</button>
          <button type="button" class="btn btn-warning btn-sm" data-confirm-correction="${n}" ${canActOnThisStage ? "" : "disabled"}>Término de Corrección</button>`;
      } else {
        correctionCell = `<button type="button" class="btn btn-ghost btn-sm" data-start-correction="${n}">Corrección</button>`;
      }
    }

    return `
      <tr class="${closed ? "" : "paro-stage-pending"}">
        <td>${escapeHtml(label)}</td>
        <td>${prevSeal.hora ? formatTime(prevSeal.hora) : "—"}</td>
        <td>${omitida ? "—" : (seal.hora ? formatTime(seal.hora) : "—")}</td>
        <td>${duration}${seal.corregido ? ` <span class="muted" title="Original: ${escapeHtml(formatDateTime(seal.original?.hora))}">(corregida)</span>` : ""}</td>
        <td>${omitida ? "—" : escapeHtml(safeText(seal.usuario ? `${seal.usuario} (${seal.perfil || "—"})` : ""))}</td>
        <td class="row-actions-cell">${correctionCell}</td>
      </tr>`;
  }

  function actionsHtml(paro) {
    if (paro.status === "PENDIENTE") {
      return `<div class="alert alert-warning">Falta la firma del Supervisor en la Orden de Cambio para iniciar este Paro.</div>`;
    }
    if (paro.status === "FINALIZADO") {
      return `<div class="alert alert-success">Paro finalizado. Duración total: ${formatDuration(paro.totalMs)}.</div>`;
    }

    const sello = PARO_STAGE_BY_STATUS[paro.status];
    if (!sello) return "";
    const allowedProfiles = PARO_STAGE_PROFILES[sello] || [];
    const canAct = allowedProfiles.includes(state.session.profile);
    const label = PARO_STAGE_LABELS[sello];

    if (!canAct) {
      return `<div class="alert alert-info">Etapa actual: <strong>${escapeHtml(label)}</strong>. Solo puede firmarla: ${escapeHtml(allowedProfiles.join(", "))}.</div>`;
    }

    const buttons = [`<button type="button" class="btn btn-primary" data-sign-sello="${sello}">Firmar: terminé ${escapeHtml(label)}</button>`];
    if (sello === 5) {
      buttons.push(`<button type="button" class="btn btn-ghost" data-omit-sello="5">Omitir RKM</button>`);
    }
    if (sello === 6) {
      buttons.push(`<p class="muted">También se cierra automáticamente al aprobar RPM en la Orden de Cambio.</p>`);
    }
    return `<div class="paros-actions-row">${buttons.join("")}</div>`;
  }

  function renderDetail() {
    const paro = activeParo;
    if (!paro) return;

    const head = $("parosDetailHead");
    if (head) {
      const meta = PARO_STATUS_META[paro.status];
      head.innerHTML = `
        <h2>${escapeHtml(paro.code)}</h2>
        <p class="muted">${escapeHtml(safeText(paro.machine))} · ${escapeHtml(safeText(paro.articulo))} → ${escapeHtml(safeText(paro.toNe))} · ${escapeHtml(safeText(paro.mechanic))}</p>
        <span class="status-badge ${paroStatusClass(paro.status)}">${escapeHtml(meta?.label || paro.status)}</span>`;
    }

    const alertBox = $("parosDetailAlert");
    if (alertBox) alertBox.innerHTML = actionsHtml(paro);

    const tbody = $("parosTimelineBody");
    if (tbody) {
      tbody.innerHTML = [1, 2, 3, 4, 5, 6].map((n) => stageRowHtml(n, paro)).join("");
    }

    wireDetailButtons();
  }

  function wireDetailButtons() {
    $$("[data-sign-sello]").forEach((btn) => {
      btn.addEventListener("click", () => runParoAction(btn, () => OC.dataAdapter.signParoStage(activeParo, Number(btn.dataset.signSello))));
    });
    $$("[data-omit-sello]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!confirm("¿Omitir la etapa RKM para esta orden?")) return;
        runParoAction(btn, () => OC.dataAdapter.signParoStage(activeParo, Number(btn.dataset.omitSello), { omitir: true }));
      });
    });
    $$("[data-start-correction]").forEach((btn) => {
      btn.addEventListener("click", () => {
        correctingSello = Number(btn.dataset.startCorrection);
        renderDetail();
      });
    });
    $$("[data-cancel-correction]").forEach((btn) => {
      btn.addEventListener("click", () => {
        correctingSello = null;
        renderDetail();
      });
    });
    $$("[data-confirm-correction]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sello = Number(btn.dataset.confirmCorrection);
        runParoAction(btn, () => OC.dataAdapter.correctParoStage(activeParo, sello)).then(() => {
          correctingSello = null;
        });
      });
    });
  }

  async function runParoAction(btn, action) {
    $$(".paros-actions-row button, [data-start-correction], [data-confirm-correction], [data-cancel-correction]").forEach((b) => (b.disabled = true));
    try {
      activeParo = await action();
      state.paros = state.paros.map((p) => (p.orderId === activeParo.orderId ? activeParo : p));
      renderDetail();
    } catch (error) {
      console.error("No se pudo guardar la accion de Control de Paros", error);
      alert(OC.describeApiError ? OC.describeApiError(error) : "No se pudo guardar en Google Sheets.");
      renderDetail();
    }
  }

  function init() {
    $("parosRefreshBtn")?.addEventListener("click", async () => {
      state.paros = await OC.dataAdapter.fetchParos();
      if (state.activeParoId) await refreshActiveParo();
      renderList();
    });
    $("parosBackBtn")?.addEventListener("click", showListPanel);
  }

  OC.tabParos = { init, renderList, renderDetail, openParo };
})();
