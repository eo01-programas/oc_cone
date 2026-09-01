(() => {
  "use strict";

  const { $, $$, formatDateTime } = OC.util;
  const { state, STATUS_GROUPS, ORDER_STATUS_META, escapeHtml, safeText, statusClass } = OC;

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
      const matchesText = [o.code, o.machine, o.mechanic, o.fromNe, o.toNe, o.articulo, o.lote]
        .join(" ").toLowerCase().includes(q);
      const matchesGroup = !group || (STATUS_GROUPS[group] || []).includes(o.status);
      const matchesStatus = !status || o.status === status;
      return matchesText && matchesGroup && matchesStatus;
    });

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="11" class="muted">No hay ordenes para mostrar.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(o => `
      <tr class="${o.id === mostRecentId ? "row-recent" : ""}">
        <td class="row-actions-cell">
          <button class="row-action" data-open-order="${o.id}">Abrir</button>
          ${canDelete ? `<button class="row-action row-action-danger" data-delete-order="${o.id}" title="Eliminar orden" aria-label="Eliminar orden ${escapeHtml(o.code)}">Eliminar</button>` : ""}
        </td>
        <td>${formatDateTime(o.updatedAt)}</td>
        <td>${escapeHtml(safeText(o.machine))}</td>
        <td>${escapeHtml(safeText(o.fromNe))} -> ${escapeHtml(safeText(o.toNe))}</td>
        <td>${escapeHtml(safeText(o.articulo))}</td>
        <td>${escapeHtml(safeText(o.lote))}</td>
        <td>${escapeHtml(safeText(o.date))}</td>
        <td>${escapeHtml(safeText(o.shift))}</td>
        <td>${escapeHtml(safeText(o.mechanic))}</td>
        <td><strong>${escapeHtml(o.code)}</strong></td>
        <td><span class="status-badge ${statusClass(o.status)}">${escapeHtml(ORDER_STATUS_META[o.status]?.label || o.status)}</span></td>
      </tr>
    `).join("");

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
  }

  OC.tabRegistry = { init, renderRegistry, populateStatusFilters };
})();
