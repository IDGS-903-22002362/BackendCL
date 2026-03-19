# Requerimientos del Sistema

## Módulos: Tienda Digital, León AI + Generación de Imágenes, Notificaciones Inteligentes

## Cobertura: 4.2.1, 4.2.2, 4.2.3, 4.2.4, 4.2.5

Fecha: 2026-03-17
Proyecto: Backend Tienda Digital (Firebase + Cloud Functions + Express + TypeScript)

## 1. Objetivo del documento

Definir en un solo documento los requerimientos funcionales (RF) y no funcionales (RNF) para implementar el sistema completo en los módulos de Tienda, León AI con generación de imágenes y Notificaciones Inteligentes, considerando el ciclo de análisis, construcción, integración móvil y validación integral.

## 2. Alcance funcional

- Módulo de Tienda Digital: catálogo, inventario, carrito, órdenes, pagos.
- Módulo León AI: asistente conversacional, personalización, herramientas de comercio.
- Módulo de Generación de Imágenes: try-on y previsualización de producto.
- Módulo de Notificaciones Inteligentes: eventos, segmentación, envío push.
- Integración backend con aplicación móvil y pruebas end-to-end.

## 3. Requerimientos por entregable

## 3.1 4.2.1 Analizar requisitos del sistema y diseñar la arquitectura en Firebase

### RF-4.2.1 (Funcionales)

RF-4.2.1-01: Definir arquitectura modular por dominios: Usuarios/Auth, Catálogo, Inventario, Carrito, Órdenes, Pagos, León AI, Try-On/Imagen, Notificaciones.
RF-4.2.1-02: Definir colecciones Firestore por dominio, su propósito, estructura de datos e índices requeridos.
RF-4.2.1-03: Diseñar flujos de datos E2E:

- carrito -> orden -> pago -> actualización de estado -> notificación
- sesión AI -> orquestación de herramientas -> respuesta
- upload imagen -> job asíncrono -> resultado firmado
  RF-4.2.1-04: Definir contratos entre módulos (eventos internos, payloads, estados y errores).
  RF-4.2.1-05: Definir roles y permisos (ADMIN, EMPLEADO, CLIENTE) para acceso por función y por recurso.
  RF-4.2.1-06: Definir la estrategia de documentación API (OpenAPI/Swagger) obligatoria por endpoint.

### RNF-4.2.1 (No funcionales)

RNF-4.2.1-01: Seguridad por diseño (AuthN/AuthZ, prevención BOLA/BFLA, principio de mínimo privilegio).
RNF-4.2.1-02: Escalabilidad serverless (diseño para autoescalado, desacople por eventos).
RNF-4.2.1-03: Trazabilidad transversal (requestId, userId, evento, latencia, resultado).
RNF-4.2.1-04: Mantenibilidad (arquitectura por capas, tipado estricto, separación de responsabilidades).
RNF-4.2.1-05: Consistencia documental (arquitectura, modelo de datos y API sincronizados).

## 3.2 4.2.2 Configurar entorno de desarrollo e infraestructura backend con Node.js

### RF-4.2.2 (Funcionales)

RF-4.2.2-01: Configurar backend Node.js + Express + TypeScript (modo estricto).
RF-4.2.2-02: Configurar Firebase Admin SDK, Firestore, Cloud Storage y Cloud Functions.
RF-4.2.2-03: Integrar autenticación con tokens y middleware de autorización por rol/ownership.
RF-4.2.2-04: Implementar validación de entrada en body/query/params con esquemas estrictos.
RF-4.2.2-05: Configurar manejo global de errores con códigos HTTP consistentes.
RF-4.2.2-06: Configurar CORS allowlist, cabeceras de seguridad y límites de payload.
RF-4.2.2-07: Configurar variables de entorno y secretos para Stripe, Gemini, Vertex AI, JWT, FCM.
RF-4.2.2-08: Configurar documentación Swagger y publicación de /api-docs.

### RNF-4.2.2 (No funcionales)

RNF-4.2.2-01: Seguridad operativa (secretos fuera de código, validación de firma en webhooks, hardening base).
RNF-4.2.2-02: Confiabilidad (timeouts, retries controlados, deduplicación de eventos).
RNF-4.2.2-03: Observabilidad mínima productiva (logs estructurados, métricas, alertas).
RNF-4.2.2-04: Portabilidad de entorno (desarrollo, pruebas y producción con configuración consistente).
RNF-4.2.2-05: Cumplimiento de buenas prácticas OWASP API Security.

## 3.3 4.2.3 Desarrollar módulo de tienda digital

### RF-4.2.3 (Funcionales)

RF-4.2.3-01: Gestionar catálogos de líneas, categorías, productos, tallas y proveedores.
RF-4.2.3-02: Permitir búsqueda y filtrado de catálogo por atributos de negocio.
RF-4.2.3-03: Gestionar inventario global y por talla, incluyendo movimientos auditables (entrada, salida, venta, devolución, ajuste).
RF-4.2.3-04: Gestionar carrito para usuario autenticado y anónimo con soporte de merge al autenticarse.
RF-4.2.3-05: Permitir crear orden desde carrito con cálculo server-side de precios y totales.
RF-4.2.3-06: Gestionar estados de orden (pendiente, confirmada, en proceso, enviada, entregada, cancelada).
RF-4.2.3-07: Integrar pagos (Stripe) con intents/sesiones, webhook de confirmación y reembolsos.
RF-4.2.3-08: Restaurar stock en cancelaciones válidas.
RF-4.2.3-09: Emitir eventos de negocio para notificaciones (orden creada, pago confirmado, envío, etc.).

### RNF-4.2.3 (No funcionales)

RNF-4.2.3-01: Consistencia transaccional en operaciones críticas (orden + stock).
RNF-4.2.3-02: Idempotencia en pagos y procesos sensibles para evitar duplicados.
RNF-4.2.3-03: Integridad de datos (precios y totales calculados por servidor, no por cliente).
RNF-4.2.3-04: Seguridad de acceso por ownership para órdenes, pagos y carrito.
RNF-4.2.3-05: Rendimiento con índices para consultas por usuario, estado y fecha.
RNF-4.2.3-06: Auditabilidad completa de cambios de inventario y estados de orden.

## 3.4 4.2.4 Implementar módulos inteligentes de interacción y comunicación

### RF-4.2.4 (Funcionales)

RF-4.2.4-01: Implementar asistente conversacional León AI con sesiones autenticadas y públicas.
RF-4.2.4-02: Permitir uso de herramientas de negocio desde el chatbot (buscar productos, stock, promociones, FAQ, estado de pedido, carrito).
RF-4.2.4-03: Implementar motor de personalización para recomendaciones contextuales.
RF-4.2.4-04: Implementar carga segura de imágenes de usuario para procesos AI.
RF-4.2.4-05: Implementar generación de imágenes (try-on/previews) mediante jobs asíncronos con consulta de estado.
RF-4.2.4-06: Entregar resultados de imagen por enlaces firmados con expiración.
RF-4.2.4-07: Implementar generación automática de contenido/copy comercial con fallback.
RF-4.2.4-08: Implementar notificaciones push segmentadas por evento, preferencia y comportamiento.
RF-4.2.4-09: Implementar reglas de elegibilidad de notificaciones (quiet hours, cooldown, límite diario).
RF-4.2.4-10: Registrar trazabilidad de entrega de notificaciones (enviado, omitido, fallido).

### RNF-4.2.4 (No funcionales)

RNF-4.2.4-01: Privacidad de datos personales e imágenes (consentimiento, retención, borrado controlado).
RNF-4.2.4-02: Seguridad AI (RBAC de herramientas, validación de archivos por tipo real, tamaño y dimensiones).
RNF-4.2.4-03: Resiliencia frente a fallos de proveedores AI (fallback funcional y degradación controlada).
RNF-4.2.4-04: Control de costos (rate limit, cuotas por endpoint, límites de uso por sesión/usuario).
RNF-4.2.4-05: Disponibilidad y latencia aceptables en chat síncrono y jobs asíncronos.
RNF-4.2.4-06: Protección contra abuso (spam, prompt abuse, uso excesivo de generación).

## 3.5 4.2.5 Integrar módulos con app móvil y ejecutar pruebas integrales

### RF-4.2.5 (Funcionales)

RF-4.2.5-01: Exponer contratos API estables para app móvil en tienda, AI, imágenes y notificaciones.
RF-4.2.5-02: Integrar flujo de sesión anónima -> autenticada sin pérdida de carrito/contexto.
RF-4.2.5-03: Validar flujo completo de compra desde catálogo hasta confirmación de pago.
RF-4.2.5-04: Validar flujo completo de interacción AI y herramientas asociadas.
RF-4.2.5-05: Validar flujo completo de generación de imagen (upload, job, resultado).
RF-4.2.5-06: Validar preferencias y entrega real de notificaciones push segmentadas.
RF-4.2.5-07: Ejecutar pruebas de regresión funcional por módulo y por flujo transversal.

### RNF-4.2.5 (No funcionales)

RNF-4.2.5-01: Seguridad integral validada con pruebas de autorización, inyección y abuso.
RNF-4.2.5-02: Desempeño validado por pruebas de carga en endpoints críticos.
RNF-4.2.5-03: Confiabilidad validada por pruebas de idempotencia y reintentos.
RNF-4.2.5-04: Observabilidad validada con métricas, logs y alertas operativas.
RNF-4.2.5-05: Calidad de entrega con criterios de aceptación y cobertura mínima por módulo.

## 4. Requerimientos transversales obligatorios

RT-01: Todo endpoint debe tener validación de entrada y documentación Swagger antes de merge.
RT-02: Todo acceso a recursos sensibles debe validar autenticación, rol y ownership.
RT-03: Todo flujo crítico debe contemplar errores de negocio y errores técnicos con respuestas estandarizadas.
RT-04: Toda integración externa (pagos/AI/push) debe incluir control de timeout, retry y auditoría.
RT-05: Todo dato sensible debe protegerse en tránsito y en reposo; no debe exponerse en logs.
RT-06: Todo cambio crítico debe incluir pruebas automáticas que prevengan regresiones.

## 5. Criterios de aceptación globales

CA-01: El sistema permite comprar en flujo completo sin inconsistencias de stock ni cobros duplicados.
CA-02: León AI responde dentro de tiempos objetivo y solo ejecuta herramientas permitidas por rol.
CA-03: El módulo de generación de imágenes respeta validaciones, permisos y privacidad.
CA-04: Las notificaciones se envían solo a usuarios elegibles y quedan trazadas en delivery logs.
CA-05: El backend supera pruebas integrales de seguridad, funcionalidad y desempeño para salida a producción.

## 6. Priorización sugerida

- Prioridad Alta: seguridad base, autenticación/autorización, inventario/órdenes/pagos, contratos API.
- Prioridad Media: personalización AI avanzada, optimización de copy y segmentación fina.
- Prioridad Baja: mejoras de experiencia y automatizaciones no críticas al flujo comercial principal.

## 7. Dependencias entre entregables

- 4.2.1 y 4.2.2 son prerequisito de 4.2.3 y 4.2.4.
- 4.2.3 y 4.2.4 deben estar funcionalmente cerrados para iniciar 4.2.5.
- 4.2.5 valida cierre funcional y no funcional de todos los módulos en conjunto.
