export const NOTIFICATION_COLLECTIONS = {
  events: "notificacionEventos",
  deliveries: "notificacionEnvios",
  campaigns: "notificacionCampanas",
  systemNotifications: "notificacionesSistema",
  users: "usuariosApp",
  userDeviceTokens: "dispositivosPush",
  userPreferences: "preferenciasPush",
} as const;

export const notificationCollections = NOTIFICATION_COLLECTIONS;
export default NOTIFICATION_COLLECTIONS;
