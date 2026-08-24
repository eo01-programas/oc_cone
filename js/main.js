(() => {
  "use strict";

  function init() {
    OC.initNav();
    OC.login.init();
    OC.tabFill.init();
    OC.tabPreview.init();
    OC.tabRegistry.init();
    OC.tabHistory.init();

    const loaded = OC.dataAdapter.load();
    OC.state.orders = Array.isArray(loaded.orders) ? loaded.orders : [];

    document.getElementById("orderDate").value = OC.util.isoDate();

    OC.renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
