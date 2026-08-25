/**
 * CONFIGURACIÓN CENTRAL
 * ---------------------------------------------------------
 * Este archivo será el punto de conexión con Apps Script.
 * Mantener las URLs fuera de app.js.
 */
window.APP_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbyjd25ukRICvmwDNnPlaZ6QMMAC1GAayJhS6AGvmyTrODMzQXWiIhfCeWopW4t_DLNvVw/exec",
  SPREADSHEET_ID: "1gHCqSveYXu16x_Ip3MeLa09J1lNmafHW8Gm1OczvCbk",
  SHEETS_URL: "https://docs.google.com/spreadsheets/d/1gHCqSveYXu16x_Ip3MeLa09J1lNmafHW8Gm1OczvCbk/edit",
  RPM_TOLERANCE_PERCENT: 5,

  /**
   * MOCK FRONTEND
   * true  = guarda órdenes de prueba en localStorage para revisar la UX.
   * false = solo memoria de la pestaña.
   *
   * Cuando se conecte Apps Script, puede deshabilitarse.
   */
  USE_LOCAL_STORAGE_MOCK: false,

  /**
   * Horario informativo de PCP Hilandería.
   * El frontend NO bloquea por horario. La validación puede ser asumida
   * manualmente por Supervisor de Turno cuando corresponda.
   */
  PCP_HOURS: {
    START: "07:00",
    END: "15:00"
  }
};
