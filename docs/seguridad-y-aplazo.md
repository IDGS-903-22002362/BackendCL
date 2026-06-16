# Seguridad del Repositorio e Integracion de Aplazo

## 1. Resumen ejecutivo

Este backend implementa una estrategia de seguridad en capas:

- Seguridad HTTP en Express (headers, CORS, limites de payload).
- Autenticacion y autorizacion por JWT y roles.
- Validacion estricta de entrada con Zod.
- Protecciones anti-abuso (rate limiting en rutas criticas).
- Manejo centralizado de errores y contexto por request.
- Uso de secretos en Cloud Functions para credenciales sensibles.
- Controles especificos de pagos Aplazo (idempotencia, ownership, webhook auth, deduplicacion y reconciliacion).

Ademas, Aplazo esta integrado como un proveedor de pagos desacoplado de Stripe legacy, con flujo online y modelo asincrono basado en webhook mas reconciliacion.

## 2. Seguridad implementada en el repositorio

### 2.1 Capa HTTP y app bootstrap

Referencia:

- functions/src/app.ts

Controles actuales:

- helmet habilitado para cabeceras de seguridad.
- cors habilitado con origin true (permite origen dinamico).
- Parsing de raw body en webhooks de Stripe y Aplazo para validar payload crudo.
- Limite de payload JSON y URL encoded en 50mb.
- Contexto de request con x-request-id para trazabilidad.
- Middleware global de 404 y de errores.

### 2.2 Contexto y trazabilidad por request

Referencia:

- functions/src/middleware/request-context.middleware.ts

Controles actuales:

- Si no llega x-request-id, se genera UUID.
- Se propaga x-request-id en la respuesta.
- Se usa para rastrear eventos de webhook/pagos.

### 2.3 Autenticacion y autorizacion

Referencias:

- functions/src/utils/middlewares.ts
- functions/src/middleware/payments-auth.middleware.ts
- functions/src/middleware/ai-authz.middleware.ts

Controles actuales:

- Autenticacion principal por Bearer JWT firmado con JWT_SECRET.
- Enriquecimiento de req.user consultando usuariosApp.
- Middleware de autenticacion opcional para endpoints mixtos (anonimo/autenticado).
- Autorizacion por rol (ADMIN, EMPLEADO, CLIENTE) en varios modulos.
- En pagos V2:
  - paymentAuthMiddleware exige token valido.
  - Operaciones sensibles (cancel/refund manual) requieren ADMIN en el servicio.
- En AI:
  - Capabilities por rol/scopes.
  - Middleware de ownership para recursos por usuario.

### 2.4 Validacion estricta de entrada

Referencias:

- functions/src/middleware/validation.middleware.ts
- functions/src/middleware/validators/payments-v2.validator.ts

Controles actuales:

- Validacion de body, params y query con Zod.
- Respuestas estructuradas para errores de validacion.
- Uso de schemas strict para rechazar campos extra (mass assignment prevention).
- Reglas de negocio en validacion para crear pagos Aplazo online desde ordenes.

### 2.5 Anti-abuso y control de consumo

Referencias:

- functions/src/middleware/rate-limit.middleware.ts
- functions/src/routes/payments-v2.routes.ts
- functions/src/middleware/ai-rate-limit.middleware.ts

Controles actuales:

- Rate limiter en memoria por IP y prefijo de ruta.
- Pagos V2 criticos limitados a 25 requests por minuto.
- AI/public chat/try-on/uploads con limites dedicados.
- Respuesta 429 con header Retry-After.

### 2.6 Uploads seguros (AI)

Referencia:

- functions/src/middleware/multipart.middleware.ts

Controles actuales:

- Validacion estricta de Content-Type multipart y boundary.
- Limite de numero de archivos y tamano por archivo.
- Restriccion de mime types permitidos (imagenes).
- Manejo de archivos temporales con limpieza en error.

### 2.7 Manejo de errores y logging

Referencias:

- functions/src/utils/error-handler.ts
- functions/src/utils/logger.ts
- functions/src/services/payments/payment-sanitizer.ts

Controles actuales:

- Clase ApiError para errores operativos.
- Error handler global con status code controlado.
- Logger estructurado sobre firebase-functions logger.
- Sanitizacion de payloads para almacenamiento/logs:
  - mascara de token/secret/signature/password.
  - mascara parcial de email y telefono.

### 2.8 Secretos y configuracion segura en Cloud Functions

Referencias:

- functions/src/index.ts
- functions/src/aplazo-payments.cron.ts
- functions/src/services/payments/payment-event.trigger.ts

Controles actuales:

- Variables sensibles inyectadas como secrets en funciones y triggers.
- Feature flags para habilitar/deshabilitar Aplazo por entorno y canal.
- Secretos separados por uso (API, webhook, timeout, paths, etc.).

### 2.9 Reglas de Firestore

Referencia:

- firestore.rules

Control actual:

- Acceso a Firestore permitido solo para requests autenticadas (request.auth != null).

## 3. Integracion de Aplazo: arquitectura y flujo

## 3.1 Superficie de endpoints

Referencias:

- functions/src/routes/payments-v2.routes.ts
- functions/src/routes/admin-payments.routes.ts
- functions/src/routes/webhooks.routes.ts
- functions/src/routes/payments-public.routes.ts

Online:

- POST /api/payments/aplazo/online/create
- GET /api/payments/:paymentAttemptId/status
- GET /payments/aplazo/success
- GET /payments/aplazo/failure
- GET /payments/aplazo/cancel

Webhook:

- POST /api/webhooks/aplazo

Admin operativo:

- POST /api/admin/payments/aplazo/:paymentAttemptId/reconcile
- POST /api/admin/payments/aplazo/:paymentAttemptId/cancel
- POST /api/admin/payments/aplazo/:paymentAttemptId/refund
- GET /api/admin/payments/aplazo/:paymentAttemptId/refund/status

## 3.2 Componentes principales

Referencias:

- functions/src/config/aplazo.config.ts
- functions/src/services/payments/payments.service.ts
- functions/src/services/payments/providers/aplazo.provider.ts
- functions/src/services/payments/payment-event-log.repository.ts
- functions/src/services/payments/payment-event-processing.service.ts
- functions/src/services/payments/payment-reconciliation.service.ts

Piezas de integracion:

- Config central de Aplazo online.
- Provider adapter para llamadas HTTP al proveedor.
- PaymentsService como orquestador de negocio.
- Repositorio de PaymentAttempt y EventLog para persistencia.
- Trigger de eventos para procesar webhooks de forma asincrona.
- Scheduler de reconciliacion periodica cada 5 minutos.

## 3.3 Controles de seguridad especificos en Aplazo

### Autenticacion y autorizacion del actor

- create online requiere usuario autenticado.
- Online valida ownership de orden (si no es staff, la orden debe pertenecer al uid).
- Consulta de status valida acceso al PaymentAttempt por ownership/rol.
- Cancel y refund manual restringidos a ADMIN.

### Idempotencia

- Header Idempotency-Key aceptado y validado (longitud 8-255).
- Si no se envia, se genera key deterministica por hash (flujo, entidad, actor, monto y pricing snapshot).
- Si existe intento previo con la misma key, se retorna el intento existente.

### Validacion de montos y moneda

- El backend recalcula montos desde la orden.
- Si total del cliente no coincide con el calculo interno, responde PAYMENT_AMOUNT_MISMATCH.
- En procesamiento de webhook se valida amountMinor/currency contra el intento persistido.

### Webhook security y deduplicacion

- El endpoint recibe raw body para parse robusto.
- parseWebhook exige JSON valido.
- Resolucion del merchantId online por credenciales configuradas.
- Validacion de Authorization en webhook:
  - compara header contra esquema configurado (Bearer o Basic) y `APLAZO_ONLINE_WEBHOOK_SECRET`.
- Dedupe key por eventId o hash SHA-256 del body.
- Reserva de evento en paymentEventLogs con id deterministico (provider + dedupeKey) para evitar reproceso.

### Procesamiento asincrono y maquina de estados

- Webhook persiste evento y trigger lo procesa.
- Transiciones validadas por state machine (canTransitionPaymentStatus).
- Eventos duplicados o transiciones invalidas se marcan sin reprocesar.
- Late paid despues de estado terminal se registra como divergencia para revision manual.

### Resiliencia operativa

- Timeouts en llamadas HTTP a Aplazo.
- Mapeo de errores de proveedor a PaymentApiError.
- Reconciliacion manual (admin) y automatica (scheduler).
- Expiracion controlada de intentos stale si no se confirman.

### Proteccion de datos sensibles

- Sanitizacion de request/response antes de persistir payloads de proveedor.
- Enmascaramiento de secrets y PII parcial en almacenamiento de trazas.

## 4. Feature flags y despliegue seguro de Aplazo

Referencia:

- functions/src/config/aplazo.config.ts
- functions/src/index.ts

Flags principales:

- APLAZO_ENABLED
- APLAZO_ONLINE_ENABLED
- APLAZO_REFUNDS_ENABLED
- APLAZO_RECONCILE_ENABLED

Patron recomendado de rollout:

- Desplegar con APLAZO_ENABLED=false.
- Activar Aplazo online cuando el contrato y webhooks esten validados.
- Mantener refunds deshabilitado hasta certificar contrato operativo.

## 5. Evidencia de pruebas automatizadas de Aplazo

Referencias:

- functions/tests/payments.aplazo.service.test.ts
- functions/tests/payments.aplazo.provider.test.ts
- functions/tests/payments.aplazo-state-machine.test.ts

Cobertura visible:

- Flujos principales de servicio de pagos Aplazo.
- Contrato de provider adapter.
- Matriz de transiciones de estado y mapeo de status de proveedor.

## 6. Observaciones y oportunidades de hardening

1. CORS esta abierto con origin true. Si se requiere mayor restriccion, conviene usar allowlist por ambiente.
2. El rate limiter actual es en memoria local del proceso; en escenarios multi-instancia puede requerir backend compartido.
3. El webhook de Aplazo valida header Authorization por secreto estatico; si el proveedor soporta firma criptografica (HMAC), conviene evaluarla para mayor robustez.
4. Mantener rotacion y gobierno de secretos (JWT, API tokens, webhook secrets) como practica operativa.

## 7. Mapa rapido de archivos clave

- App y seguridad HTTP: functions/src/app.ts
- Auth general: functions/src/utils/middlewares.ts
- Auth pagos: functions/src/middleware/payments-auth.middleware.ts
- Validacion Zod: functions/src/middleware/validation.middleware.ts
- Validator pagos V2: functions/src/middleware/validators/payments-v2.validator.ts
- Rate limiting: functions/src/middleware/rate-limit.middleware.ts
- Contexto request-id: functions/src/middleware/request-context.middleware.ts
- Entradas Aplazo (rutas): functions/src/routes/payments-v2.routes.ts
- Admin Aplazo: functions/src/routes/admin-payments.routes.ts
- Webhook Aplazo: functions/src/routes/webhooks.routes.ts
- Return URLs Aplazo: functions/src/routes/payments-public.routes.ts
- Orquestacion pagos: functions/src/services/payments/payments.service.ts
- Adapter proveedor: functions/src/services/payments/providers/aplazo.provider.ts
- Deduplicacion webhook: functions/src/services/payments/payment-event-log.repository.ts
- Procesamiento evento: functions/src/services/payments/payment-event-processing.service.ts
- Reconciliacion: functions/src/services/payments/payment-reconciliation.service.ts
- Secrets runtime: functions/src/index.ts
- Reglas Firestore: firestore.rules
