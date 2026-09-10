(() => {
  "use strict";

  // ============================================================
  // COMBOBOX — Máquina, N°-Maq, Supervisor, Artículo, Lote,
  // Composición, A Ne.
  // ------------------------------------------------------------
  // Cada casilla conserva su elemento real (<select>/<input>, mismo
  // id de siempre) oculto con la clase .combo-native-hidden — sigue
  // siendo la única fuente de verdad para .value/.disabled/.readOnly,
  // así que collectFormIntoOrder(), loadOrderToForm(),
  // applyFieldPermissions() y el listener genérico de #orderForm
  // (todos en tab-fill.js) siguen funcionando sin cambios.
  //
  // Al lado, un <input class="combo-proxy"> visible es lo que el
  // usuario realmente ve y usa. Al confirmar un valor, el widget
  // escribe .value en el elemento oculto y le dispara un evento
  // "change" real — así los listeners que ya existen sobre esos ids
  // (incluida la cascada Máquina → N°-Maq) se enteran igual que si el
  // cambio hubiera venido del navegador.
  //
  // Dos modos, elegidos por data-combo-mode en el <label class="field
  // combo-shell">:
  //   - "closed"   (Máquina/N°-Maq/Supervisor): elección cerrada,
  //                 igual que el <select> nativo que reemplaza — el
  //                 proxy es readonly, solo abre el panel.
  //   - "freetext" (Artículo/Lote/Composición/A Ne): el proxy acepta
  //                 cualquier texto; el panel solo sugiere, filtrando
  //                 data-combo-source dentro de state.catalogs. Nunca
  //                 escribe en el catálogo de GESTION_OC.
  // ============================================================

  const { $$ } = OC.util;
  const { state } = OC;

  // Evita el problema ya conocido de escapes unicode literales
  // (̀-ͯ) corrompiéndose al pasar por ciertas herramientas —
  // se arma el rango en tiempo de ejecución con fromCharCode.
  const DIACRITICS_RE = new RegExp(
    "[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]",
    "g"
  );

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(DIACRITICS_RE, "");
  }

  let shells = [];
  let openDescriptor = null;

  // ------------------------------------------------------------
  // Construcción de cada casilla
  // ------------------------------------------------------------
  function buildDescriptor(shell) {
    const nativeEl = shell.querySelector(".combo-native-hidden");
    const proxyEl = shell.querySelector(".combo-proxy");
    const menuEl = shell.querySelector(".combo-menu");
    if (!nativeEl || !proxyEl || !menuEl) return null;

    return {
      shell,
      nativeEl,
      proxyEl,
      menuEl,
      mode: shell.dataset.comboMode === "freetext" ? "freetext" : "closed",
      source: shell.dataset.comboSource || "",
      activeIndex: -1,
      visibleItems: []
    };
  }

  function isLocked(descriptor) {
    return descriptor.mode === "closed"
      ? !!descriptor.nativeEl.disabled
      : !!descriptor.nativeEl.readOnly;
  }

  // ------------------------------------------------------------
  // Sincronización proxy ← elemento oculto (valor y bloqueo)
  // ------------------------------------------------------------
  function refreshOne(descriptor) {
    const { nativeEl, proxyEl, mode, shell } = descriptor;

    if (mode === "closed") {
      const opt = nativeEl.selectedOptions && nativeEl.selectedOptions[0];
      proxyEl.value = opt ? opt.textContent : (nativeEl.value || "");
    } else {
      proxyEl.value = nativeEl.value || "";
    }

    const locked = isLocked(descriptor);
    shell.classList.toggle("is-disabled", locked);
    if (mode === "freetext") {
      proxyEl.readOnly = locked;
    } else {
      proxyEl.disabled = locked;
    }
  }

  function refreshAll() {
    shells.forEach(refreshOne);
  }

  // ------------------------------------------------------------
  // Panel de opciones
  // ------------------------------------------------------------
  function getSourceItems(descriptor) {
    if (descriptor.mode === "closed") {
      return Array.from(descriptor.nativeEl.options)
        .filter((o) => o.value !== "")
        .map((o) => o.textContent);
    }
    const source = state.catalogs && state.catalogs[descriptor.source];
    return Array.isArray(source) ? source : [];
  }

  function closeAllMenus() {
    shells.forEach((d) => d.shell.classList.remove("open"));
    openDescriptor = null;
  }

  function closeMenu(descriptor) {
    descriptor.shell.classList.remove("open");
    if (openDescriptor === descriptor) openDescriptor = null;
  }

  function anyMenuOpen() {
    return shells.some((d) => d.shell.classList.contains("open"));
  }

  function renderMenu(descriptor, query) {
    // Solo un combo abierto a la vez: cerrar cualquier otro antes de abrir
    // este (cubre "toco uno, no elijo nada, toco otro" sin depender del
    // timing del blur).
    shells.forEach((d) => { if (d !== descriptor) d.shell.classList.remove("open"); });

    const items = getSourceItems(descriptor);
    const q = normalizeText(query);
    const filtered = descriptor.mode === "closed"
      ? items
      : items.filter((v) => !q || normalizeText(v).includes(q));

    descriptor.activeIndex = -1;
    descriptor.visibleItems = filtered.slice(0, 60);
    descriptor.menuEl.innerHTML = "";

    if (!descriptor.visibleItems.length) {
      const empty = document.createElement("div");
      empty.className = "combo-empty";
      empty.textContent = descriptor.mode === "closed"
        ? "No hay opciones disponibles."
        : "No hay coincidencias. Puede escribir un valor nuevo.";
      descriptor.menuEl.appendChild(empty);
    } else {
      descriptor.visibleItems.forEach((text) => {
        const opt = document.createElement("div");
        opt.className = "combo-option";
        opt.textContent = text;
        opt.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          commitValue(descriptor, text);
        });
        descriptor.menuEl.appendChild(opt);
      });
    }

    descriptor.shell.classList.add("open");
    openDescriptor = descriptor;
  }

  function moveActive(descriptor, delta) {
    if (!descriptor.visibleItems.length) return;
    const max = descriptor.visibleItems.length - 1;
    let next = descriptor.activeIndex + delta;
    if (next < 0) next = 0;
    if (next > max) next = max;
    descriptor.activeIndex = next;
    Array.from(descriptor.menuEl.children).forEach((el, i) => {
      el.classList.toggle("active", i === next);
    });
    const activeEl = descriptor.menuEl.children[next];
    if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: "nearest" });
  }

  // ------------------------------------------------------------
  // Confirmación de valor — única puerta de escritura hacia el
  // elemento oculto real.
  // ------------------------------------------------------------
  function commitValue(descriptor, value) {
    const { nativeEl, proxyEl } = descriptor;
    const changed = nativeEl.value !== value;
    nativeEl.value = value;
    proxyEl.value = value;
    if (changed) {
      nativeEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    closeMenu(descriptor);
  }

  // ------------------------------------------------------------
  // Modo "closed" — Máquina, N°-Maq, Supervisor
  // ------------------------------------------------------------
  function wireClosed(descriptor) {
    const { proxyEl } = descriptor;

    proxyEl.addEventListener("mousedown", (ev) => {
      if (descriptor.nativeEl.disabled) return;
      ev.preventDefault();
      if (descriptor.shell.classList.contains("open")) {
        closeAllMenus();
      } else {
        renderMenu(descriptor, "");
        proxyEl.focus();
      }
    });

    proxyEl.addEventListener("keydown", (ev) => {
      if (descriptor.nativeEl.disabled) return;
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        if (!descriptor.shell.classList.contains("open")) renderMenu(descriptor, "");
        moveActive(descriptor, 1);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        if (!descriptor.shell.classList.contains("open")) renderMenu(descriptor, "");
        moveActive(descriptor, -1);
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        if (descriptor.activeIndex >= 0 && descriptor.visibleItems[descriptor.activeIndex] != null) {
          commitValue(descriptor, descriptor.visibleItems[descriptor.activeIndex]);
        } else if (!descriptor.shell.classList.contains("open")) {
          renderMenu(descriptor, "");
        }
      } else if (ev.key === "Escape") {
        closeAllMenus();
      }
    });

    // A diferencia del modo freetext (que ya cierra su menú en el blur al
    // confirmar el texto), el modo closed no tenía cierre al perder el
    // foco — quedaba abierto al saltar a otra casilla con Tab.
    proxyEl.addEventListener("blur", () => {
      setTimeout(() => {
        if (openDescriptor === descriptor) closeMenu(descriptor);
      }, 0);
    });
  }

  // ------------------------------------------------------------
  // Modo "freetext" — Artículo, Lote, Composición, A Ne
  // ------------------------------------------------------------
  function wireFreetext(descriptor) {
    const { proxyEl } = descriptor;

    proxyEl.addEventListener("focus", () => {
      if (descriptor.nativeEl.readOnly) return;
      renderMenu(descriptor, proxyEl.value);
    });

    proxyEl.addEventListener("mousedown", () => {
      if (descriptor.nativeEl.readOnly) return;
      if (!descriptor.shell.classList.contains("open")) renderMenu(descriptor, proxyEl.value);
    });

    proxyEl.addEventListener("input", () => {
      renderMenu(descriptor, proxyEl.value);
    });

    proxyEl.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        moveActive(descriptor, 1);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        moveActive(descriptor, -1);
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        if (descriptor.activeIndex >= 0 && descriptor.visibleItems[descriptor.activeIndex] != null) {
          commitValue(descriptor, descriptor.visibleItems[descriptor.activeIndex]);
        } else {
          commitValue(descriptor, proxyEl.value.trim());
        }
      } else if (ev.key === "Escape") {
        closeAllMenus();
      }
    });

    proxyEl.addEventListener("blur", () => {
      // Pequeño margen para que el mousedown de una opción (que hace
      // preventDefault sobre el blur) se resuelva primero.
      setTimeout(() => commitValue(descriptor, proxyEl.value.trim()), 0);
    });
  }

  // ------------------------------------------------------------
  // Inicialización
  // ------------------------------------------------------------
  function init() {
    shells = Array.from($$(".combo-shell")).map(buildDescriptor).filter(Boolean);
    shells.forEach((descriptor) => {
      if (descriptor.mode === "freetext") wireFreetext(descriptor);
      else wireClosed(descriptor);
    });

    document.addEventListener("mousedown", (ev) => {
      if (!ev.target.closest(".combo-shell")) closeAllMenus();
    });

    refreshAll();
  }

  OC.combobox = { init, refreshAll, closeAllMenus, anyMenuOpen };
})();
