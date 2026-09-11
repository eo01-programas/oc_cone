(() => {
  "use strict";

  const { $, $$, formatDateTime } = OC.util;
  const { state, STATUS_GROUPS, ORDER_STATUS_META, escapeHtml, safeText, statusClass } = OC;

  // El registro se ordena SIEMPRE por fecha de creación descendente (la
  // más nueva primero). Editar una orden no cambia su posición — solo se
  // sombrea (ver getMostRecentOrderId, que sí mira la última edición).
  // Por defecto solo se ven las N primeras; el resto queda plegado.
  const REGISTRY_COLLAPSED_COUNT = 5;
  let registryExpanded = false;

  function orderCreatedTime(o) {
    const t = o.createdAt ? new Date(o.createdAt).getTime() : 0;
    return Number.isNaN(t) ? 0 : t;
  }

  // Orden con la última edición más reciente -> es la que se sombrea.
  // (Distinto del orden de la lista, que va por fecha de creación.)
  function getMostRecentOrderId() {
    let bestId = null;
    let bestTime = -Infinity;
    state.orders.forEach((o) => {
      const time = o.updatedAt ? new Date(o.updatedAt).getTime() : NaN;
      if (!Number.isNaN(time) && time > bestTime) {
        bestTime = time;
        bestId = o.id;
      }
    });
    return bestId;
  }

  function populateStatusFilters() {
    $("registryStatusFilter").innerHTML =
      `<option value="">Todos los estados</option>` +
      Object.entries(ORDER_STATUS_META).map(([key, meta]) => `<option value="${key}">${meta.label}</option>`).join("");
  }

  function renderRegistry() {
    const tbody = $("registryBody");
    const q = ($("registrySearch")?.value || "").toLowerCase();
    const group = $("registryGroupFilter")?.value || "";
    const status = $("registryStatusFilter")?.value || "";
    const canDelete = !!OC.getPermissions().canDeleteOrder;
    const mostRecentId = getMostRecentOrderId();

    const rows = state.orders.filter(o => {
      const matchesText = [o.code, o.machine, o.mechanic, o.fromNe, o.toNe, o.articulo, o.lote, o.articuloLoteSale]
        .join(" ").toLowerCase().includes(q);
      const matchesGroup = !group || (STATUS_GROUPS[group] || []).includes(o.status);
      const matchesStatus = !status || o.status === status;
      return matchesText && matchesGroup && matchesStatus;
    }).sort((a, b) =>
      orderCreatedTime(b) - orderCreatedTime(a) ||
      String(b.code || "").localeCompare(String(a.code || ""))
    );

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="12" class="muted">No hay ordenes para mostrar.</td></tr>`;
      return;
    }

    const collapsible = rows.length > REGISTRY_COLLAPSED_COUNT;
    const visibleRows = (collapsible && !registryExpanded) ? rows.slice(0, REGISTRY_COLLAPSED_COUNT) : rows;

    const toggleRowHtml = collapsible ? `
      <tr class="registry-toggle-row">
        <td colspan="12">
          <button type="button" class="registry-toggle" data-registry-toggle>
            <span class="registry-toggle-arrow">${registryExpanded ? "&#9652;" : "&#9662;"}</span>
            ${registryExpanded
              ? "Ver menos"
              : `Ver todas las ordenes (${rows.length})`}
          </button>
        </td>
      </tr>` : "";

    tbody.innerHTML = visibleRows.map(o => `
      <tr class="${o.id === mostRecentId ? "row-recent" : ""}">
        <td class="row-actions-cell">
          <button class="row-action" data-open-order="${o.id}">Abrir</button>
          <button class="row-action" data-open-paro-from-registry="${o.id}" title="Ver Control de Paros de esta orden">Ver Paro</button>
          ${canDelete ? `<button class="row-action row-action-danger" data-delete-order="${o.id}" title="Eliminar orden" aria-label="Eliminar orden ${escapeHtml(o.code)}">Eliminar</button>` : ""}
        </td>
        <td>${formatDateTime(o.updatedAt)}</td>
        <td>${escapeHtml(safeText(o.machine))}</td>
        <td>${escapeHtml(safeText(o.fromNe))} -> ${escapeHtml(safeText(o.toNe))}</td>
        <td>${escapeHtml(safeText(o.articulo))}</td>
        <td>${escapeHtml(safeText(o.lote))}</td>
        <td>${escapeHtml(safeText(o.articuloLoteSale))}</td>
        <td>${escapeHtml(safeText(o.date))}</td>
        <td>${escapeHtml(safeText(o.shift))}</td>
        <td>${escapeHtml(safeText(o.mechanic))}</td>
        <td><strong>${escapeHtml(o.code)}</strong></td>
        <td><span class="status-badge ${statusClass(o.status)}">${escapeHtml(ORDER_STATUS_META[o.status]?.label || o.status)}</span></td>
      </tr>
    `).join("") + toggleRowHtml;

    $$("[data-registry-toggle]").forEach(btn => {
      btn.addEventListener("click", () => {
        registryExpanded = !registryExpanded;
        renderRegistry();
      });
    });

    $$("[data-open-order]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.openOrder;
        const previousText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Abriendo...";

        try {
          const order = await OC.dataAdapter.fetchOrder(id);
          state.orders = [order, ...state.orders.filter(item => item.id !== id)];
          state.currentOrderId = order.id;
          OC.tabFill.loadOrderToForm(order);
          OC.setTab("fill");
        } catch (error) {
          console.error("No se pudo abrir la orden", error);
          alert("No se pudo abrir la orden desde Google Sheets.");
        } finally {
          btn.disabled = false;
          btn.textContent = previousText;
        }
      });
    });

    $$("[data-open-paro-from-registry]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.openParoFromRegistry;
        const previousText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Abriendo...";
        try {
          OC.setSection("paros");
          await OC.tabParos.openParo(id);
        } catch (error) {
          console.error("No se pudo abrir Control de Paros", error);
          alert("No se pudo abrir Control de Paros desde Google Sheets.");
        } finally {
          btn.disabled = false;
          btn.textContent = previousText;
        }
      });
    });

    $$("[data-delete-order]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.deleteOrder;
        const order = state.orders.find(o => o.id === id);
        if (!order) return;

        const proceed = confirm(`Eliminar la orden ${order.code}? Se ocultara del registro y quedara trazabilidad en historial.`);
        if (!proceed) return;

        const previousText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Eliminando...";

        try {
          await OC.dataAdapter.deleteOrder(order, "Eliminada desde registro.");
          state.orders = state.orders.filter(item => item.id !== id);
          if (state.currentOrderId === id) {
            state.currentOrderId = state.orders[0]?.id || null;
            if (state.currentOrderId) OC.tabFill.loadOrderToForm(state.orders[0]);
          }
          OC.renderAll();
        } catch (error) {
          console.error("No se pudo eliminar la orden", error);
          alert("No se pudo eliminar la orden en Google Sheets.");
        } finally {
          btn.disabled = false;
          btn.textContent = previousText;
        }
      });
    });
  }

  function init() {
    populateStatusFilters();
    $("registrySearch").addEventListener("input", renderRegistry);
    $("registryGroupFilter").addEventListener("change", renderRegistry);
    $("registryStatusFilter").addEventListener("change", renderRegistry);

    // Switch Filtros: encendido muestra el panel; apagado lo oculta Y
    // limpia búsqueda/grupo/estado (la lista vuelve a mostrar todo).
    $("registryFilterToggle").addEventListener("change", (e) => {
      const on = e.target.checked;
      $("registryFilters").classList.toggle("hidden", !on);
      if (!on) {
        $("registrySearch").value = "";
        $("registryGroupFilter").value = "";
        $("registryStatusFilter").value = "";
        renderRegistry();
      }
    });
  }

  OC.tabRegistry = { init, renderRegistry, populateStatusFilters };
})();
