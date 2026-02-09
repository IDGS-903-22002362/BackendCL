# Reporte de Arquitectura Firebase - Club León App

**Fecha:** 8/2/2026
**Fuente:** Análisis estático de código (C:\Users\dell\OneDrive\Escritorio\Estadias\backend\functions\src)

## Servicios Detectados
- [x] Cloud Functions / Node.js Backend
- [x] Firestore Database
- [x] Firebase Auth
- [x] Cloud Storage
- [ ] Firebase Cloud Messaging (FCM)

## Colecciones Firestore Detectadas
| Colección / Ruta | Archivos de Referencia | Observaciones |
|---|---|---|
| `categorias` | `categories.debug.controller.ts`, `seed.ts` | |
| `lineas` | `lines.debug.controller.ts`, `seed.ts` | |
| `productos` | `products.debug.controller.ts`, `seed.ts` | |
| `proveedores` | `providers.debug.controller.ts`, `seed.ts` | |
| `tallas` | `sizes.debug.controller.ts`, `seed.ts` | |
| `usuariosApp` | `auth.social.controller.ts`, `users.debug.controller.ts`, `middlewares.ts` | |
| `_test` | `diagnostico.ts` | |
| `conexion` | `diagnostico.ts` | |
| `ubicaciones` | `seed.ts` | |
| `configuracion` | `seed.ts` | |
| `puntos` | `seed.ts` | |
| `tienda` | `seed.ts` | |
| `usuarios` | `orden.service.ts` | |

## Hallazgos y Notas de Seguridad
- **Reglas de Seguridad:** Se recomienda revisar `firestore.rules` para asegurar que las colecciones detectadas tengan las reglas apropiadas.
- **Expansión Dinámica:** Las rutas que contienen parámetros (ej. `{uid}`) indican subcolecciones o documentos específicos. Asegurar validación de IDs en el backend.

> No se detectaron inconsistencias obvias en nombres de colecciones.

## Evidencia
Se sugiere adjuntar capturas de pantalla de:
1. **Firebase Console > Firestore Data** (para validar estructura real).
2. **Firebase Console > Usage** (para verificar cuotas).
