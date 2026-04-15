# Integración correcta de Aplazo en backend (Node.js + Express)

## Objetivo

Este documento resume cómo implementar correctamente **Aplazo** en backend usando:

- la documentación oficial pública de Aplazo Integrations
- los PDFs privados de Club León para **Online API** y **In-Store API**
- el contexto de un backend propio que **ya tiene Stripe** y necesita tratar Aplazo como un **método alternativo**, no como reemplazo

---

## 1. Enfoque recomendado de arquitectura

Aplazo debe vivir detrás de una **capa común de pagos por proveedor**.

### Recomendación

Mantener Stripe intacto en sus rutas existentes y agregar Aplazo como otro provider dentro de una capa común con piezas como:

- `PaymentProvider` interface
- `payments.service.ts`
- `payment-finalizer.service.ts`
- `payment-event-processing.service.ts`
- `payment-reconciliation.service.ts`
- `aplazo.provider.ts`
- `aplazo.contract.v1.ts`

### Regla principal

- **Frontend nunca habla directo con Aplazo con credenciales**.
- El **backend crea el intento**.
- El **frontend solo redirige** o muestra QR/link.
- La **confirmación real** debe venir del **webhook** o de una **reconciliación backend**.

---

## 2. Qué canales existen

Aplazo tiene **dos canales distintos**:

### 2.1 Online API
Para ecommerce web.

### 2.2 In-Store API
Para puntos de venta físicos / POS.

Esto también está separado en los PDFs de Club León:

- `Paquete de integracion Club Leon On.pdf` → **Online API**
- `Paquete de integracion Club Leon Off.pdf` → **In-Store API**

---

## 3. Credenciales correctas (Club León)

### Online API
Del PDF **On**:

- Merchant ID: `3683`
- API Token: `5550d060-fb56-40fd-8c8b-1febb40e7fa4`

### In-Store API
Del PDF **Off**:

- Merchant ID: `3684`
- API Token: `44ffa384-1dd1-4b45-86e0-7c4d2a2af7cb`

### Variables recomendadas

```env
APLAZO_ONLINE_MERCHANT_ID=3683
APLAZO_ONLINE_API_TOKEN=5550d060-fb56-40fd-8c8b-1febb40e7fa4

APLAZO_INSTORE_MERCHANT_ID=3684
APLAZO_INSTORE_API_TOKEN=44ffa384-1dd1-4b45-86e0-7c4d2a2af7cb
```

> **Importante:** estos valores no deben quedar en `.env.example` ni en el repositorio. Solo en secrets o `.env` privado.

---

## 4. Autenticación correcta por canal

## 4.1 Online API
La Online API **sí usa autenticación previa**.

### Flujo correcto
1. Hacer `POST /auth`
2. Enviar en body:
   - `apiToken`
   - `merchantId`
3. Leer el token devuelto
4. Usarlo como `Authorization: Bearer ...` en la request real siguiente

### Hosts
#### Sandbox
- Base auth/create: `https://api.aplazo.net/api`

#### Producción
- Base auth/create: `https://api.aplazo.mx/api`

### Paths relevantes
- `POST /auth`
- `POST /loan`

### Recomendación técnica
No caches el token de forma compleja en la primera versión. La documentación pública sugiere que el Bearer se genera por request.

---

## 4.2 In-Store API
La In-Store API **no usa Bearer**.

### Headers correctos
Cada request debe llevar:

```http
api_token: <API_TOKEN>
merchant_id: <MERCHANT_ID>
```

### Hosts
#### Sandbox
- `https://api.aplazo.net`

#### Producción
- `https://api.aplazo.mx`

---

## 5. Variables de entorno recomendadas

```env
# --- Aplazo ---
APLAZO_ENABLED=true
APLAZO_ENV=sandbox
APLAZO_INTEGRATION_VERSION=official-gitbook-v1
APLAZO_ONLINE_ENABLED=true
APLAZO_INSTORE_ENABLED=true
APLAZO_REFUNDS_ENABLED=false
APLAZO_RECONCILE_ENABLED=true

# --- Aplazo Online API ---
APLAZO_ONLINE_BASE_URL=https://api.aplazo.net/api
APLAZO_ONLINE_MERCHANT_BASE_URL=https://merchant.aplazo.net/api
APLAZO_ONLINE_REFUNDS_BASE_URL=https://refunds-bifrost.aplazo.net/api
APLAZO_ONLINE_AUTH_PATH=/auth
APLAZO_ONLINE_CREATE_PATH=/loan
APLAZO_ONLINE_STATUS_PATH=/v1/loan/status
APLAZO_ONLINE_CANCEL_PATH=
APLAZO_ONLINE_REFUND_PATH=/loan/refund-from-cart
APLAZO_ONLINE_REFUND_STATUS_PATH=/v1/merchant/refund/status
APLAZO_ONLINE_MERCHANT_ID=3683
APLAZO_ONLINE_API_TOKEN=<SECRET>
APLAZO_ONLINE_WEBHOOK_SECRET=<SECRET>
APLAZO_ONLINE_WEBHOOK_AUTH_SCHEME=Bearer
APLAZO_ONLINE_SUCCESS_URL=https://ecomerce-next-front--e-comerce-leon.us-central1.hosted.app/pagos/aplazo/success
APLAZO_ONLINE_CANCEL_URL=https://ecomerce-next-front--e-comerce-leon.us-central1.hosted.app/pagos/aplazo/cancel
APLAZO_ONLINE_FAILURE_URL=https://ecomerce-next-front--e-comerce-leon.us-central1.hosted.app/pagos/aplazo/failure
APLAZO_ONLINE_CART_URL=https://ecomerce-next-front--e-comerce-leon.us-central1.hosted.app/cart
APLAZO_ONLINE_TIMEOUT_MS=15000

# --- Aplazo In-Store API ---
APLAZO_INSTORE_BASE_URL=https://api.aplazo.net
APLAZO_INSTORE_MERCHANT_BASE_URL=https://merchant.aplazo.net
APLAZO_INSTORE_CREATE_PATH=/api/pos/loan
APLAZO_INSTORE_STATUS_PATH=/api/pos/loan/{cartId}
APLAZO_INSTORE_CANCEL_PATH=/api/pos/loan/cancel
APLAZO_INSTORE_REFUND_PATH=/api/pos/loan/refund
APLAZO_INSTORE_REFUND_STATUS_PATH=/api/pos/loan/refund/{cartId}
APLAZO_INSTORE_REGISTER_BRANCH_PATH=/merchant/create-branch
APLAZO_INSTORE_RESEND_CHECKOUT_PATH=
APLAZO_INSTORE_GET_QR_PATH=
APLAZO_INSTORE_MERCHANT_ID=3684
APLAZO_INSTORE_API_TOKEN=<SECRET>
APLAZO_INSTORE_WEBHOOK_SECRET=<SECRET>
APLAZO_INSTORE_WEBHOOK_AUTH_SCHEME=Bearer
APLAZO_INSTORE_CALLBACK_URL=https://ecomerce-next-front--e-comerce-leon.us-central1.hosted.app/pos/aplazo/callback
APLAZO_INSTORE_TIMEOUT_MS=15000
APLAZO_INSTORE_DEFAULT_COMM_CHANNEL=q
```

### Importante sobre deploy y Secret Manager
Estas variables **no deberían ir como secrets** si son solo configuración:

- `APLAZO_ONLINE_CANCEL_PATH`
- `APLAZO_INSTORE_RESEND_CHECKOUT_PATH`
- `APLAZO_INSTORE_GET_QR_PATH`
- URLs
- paths
- timeouts
- flags

Como secrets solo deberían quedar:

- `APLAZO_ONLINE_API_TOKEN`
- `APLAZO_INSTORE_API_TOKEN`
- `APLAZO_ONLINE_WEBHOOK_SECRET`
- `APLAZO_INSTORE_WEBHOOK_SECRET`
- opcionalmente Merchant IDs, si quieres manejarlos así

---

## 6. Modelo interno recomendado

Usar una entidad interna común tipo `PaymentAttempt`.

### Campos recomendados
- `provider`: `stripe | aplazo`
- `flowType`: `online | in_store`
- `status`
- `paymentMethodCode`
- `amount`
- `currency`
- `providerLoanId`
- `providerReference`
- `providerStatus`
- `redirectUrl`
- `metadata`
- `rawCreateRequestSanitized`
- `rawCreateResponseSanitized`
- `rawLastWebhookSanitized`
- `paidAt`
- `failedAt`
- `canceledAt`
- `expiredAt`

### Regla clave para Aplazo
- `providerReference = cartId`
- `providerLoanId = loanId`

No conviene seguir tratando `providerPaymentId` como eje principal en Aplazo si el contrato real gira sobre `cartId` y `loanId`.

---

## 7. Estados internos recomendados

### PaymentStatus
- `created`
- `pending_provider`
- `pending_customer`
- `authorized`
- `paid`
- `failed`
- `canceled`
- `expired`
- `refunded`
- `partially_refunded`

### Mapeo recomendado Aplazo → PaymentStatus
- `Activo` / `ACTIVE` → `paid`
- `No confirmado` → `pending_customer`
- `Cancelado` → `canceled`
- `Devuelto` → `refunded`
- `Partially refunded` → `partially_refunded`
- `Failed` / `Rejected` → `failed`
- `Expired` → `expired`

> Recomendación práctica: tratar `Activo` como `paid` a nivel negocio, porque la documentación de Aplazo lo describe como que el usuario ya pagó la primera parcialidad y el préstamo quedó activo.

---

## 8. Flujo Online correcto

## 8.1 Crear pago online

### Endpoint interno recomendado
```http
POST /api/payments/aplazo/online/create
```

### Flujo backend
1. Validar orden/carrito
2. Recalcular total en backend
3. Crear `PaymentAttempt`
4. Autenticar con Aplazo (`POST /auth`)
5. Construir payload real de `/loan`
6. Hacer `POST /loan`
7. Guardar:
   - `providerLoanId`
   - `providerReference` (`cartId`)
   - `redirectUrl` (la `url` que devuelva Aplazo)
8. Responder al frontend con `redirectUrl`

### Payload esperado
Con lo públicamente confirmado, el payload online de Aplazo gira alrededor de:

- `totalPrice`
- `shopId`
- `cartId`
- `successUrl`
- `errorUrl`
- información del comprador
- `shipping`
- `taxes`
- descuentos
- productos

### Punto importante sobre `errorUrl`
Con la información pública disponible, lo más seguro es:

- mapear `errorUrl` con `failureUrl` de tu sistema
- **no asumir** que Aplazo acepta `cancelUrl` como campo independiente dentro de `/loan`

`cancelUrl` puede existir en tu lógica interna o frontend, pero no conviene enviarlo a ciegas si el contrato no lo confirma expresamente.

### Sobre `products[]`
Aquí sigue pendiente validar con el Postman privado:

- nombre exacto del array
- nombre exacto de campos por producto
- si requieren SKU
- si requieren marca
- si requieren categoría
- si requieren imagen
- si precio va en decimal o entero
- si necesitan subtotal por producto

Recomendación: dejar un builder separado `buildOnlineAplazoPayload()` con TODOs puntuales solo ahí.

---

## 8.2 Obtener estatus online

### Endpoint Aplazo
```http
GET /v1/loan/status
```

### Host
- Sandbox: `https://merchant.aplazo.net/api`
- Prod: `https://merchant.aplazo.mx/api`

### Regla
Consultar por **uno solo**:
- `loanId`, o
- `cartId`

### Recomendación de implementación
- Si tienes `providerLoanId`, consulta por `loanId`
- Si no, consulta por `cartId = providerReference`

---

## 8.3 Cancelación online

### Consideración
El host de cancelación online no es el mismo que create/status. Usa `refunds-bifrost`.

### Host
- Sandbox: `https://refunds-bifrost.aplazo.net/api`
- Prod: `https://refunds-bifrost.aplazo.mx/api`

### Observación
El path exacto debe seguir siendo configurable si tu Postman privado todavía no lo fija al 100%.

---

## 8.4 Refund online

### Endpoint
```http
POST /loan/refund-from-cart
```

### Host
- Sandbox/Prod en `merchant.aplazo.*`

### Refund status
```http
GET /v1/merchant/refund/status
```

### Recomendación
No marcar refund como exitoso “a ciegas”. Mapear la respuesta del proveedor.

---

## 9. Flujo In-Store correcto

## 9.1 Crear pago in-store

### Endpoint interno recomendado
```http
POST /api/payments/aplazo/in-store/create
```

### Endpoint Aplazo
```http
POST /api/pos/loan
```

### Payload confirmado parcialmente
La documentación pública confirma que el payload in-store usa al menos:

- `shopId`
- `cartId`
- `webhookUrl`
- `products`
- `commChannel`

### Comm channel
Valores conocidos:
- `q`
- `w`
- `s`

En tu config puedes dejar:
```env
APLAZO_INSTORE_DEFAULT_COMM_CHANNEL=q
```

### Respuesta esperada
Mapear lo que llegue a:
- `providerLoanId`
- `providerReference` (`cartId`)
- `paymentLink` si lo devuelve
- `qrString` si lo devuelve
- `qrImageUrl` si lo devuelve

---

## 9.2 Obtener estatus in-store

### Endpoint
```http
GET /api/pos/loan/{cartId}
```

### Regla
Usar `providerReference` como `cartId`.

---

## 9.3 Cancelación in-store

### Endpoint
```http
POST /api/pos/loan/cancel
```

### Regla
Cancelar intentos abiertos si el flujo POS ya no se completará.

---

## 9.4 Refund in-store

### Endpoint
```http
POST /api/pos/loan/refund
```

### Refund status
```http
GET /api/pos/loan/refund/{cartId}
```

---

## 9.5 Registro de branch/store

### Endpoint
```http
POST /merchant/create-branch
```

### Host
- Sandbox: `https://merchant.aplazo.net`
- Prod: `https://merchant.aplazo.mx`

### Recomendación
Mapear si tus `sucursales` internas necesitan un `branchId` de Aplazo.

---

## 10. Webhook correcto

## 10.1 Qué es el webhook
No lo “da” Aplazo: **tú defines una URL pública de tu backend** y se la mandas a Aplazo en la creación del pago.

Ejemplo:
```text
https://us-central1-e-comerce-leon.cloudfunctions.net/api/api/webhooks/aplazo
```

---

## 10.2 Payload conocido del webhook
La documentación pública muestra que el webhook incluye al menos:

```json
{
  "status": "Activo",
  "loanId": 123456,
  "cartId": "cart-123",
  "merchantId": 3683
}
```

---

## 10.3 Validación recomendada
La documentación pública no deja claro un esquema de firma criptográfica tipo Stripe.

Lo más razonable es:

- validar `Authorization` header
- compararlo contra:
  - `Bearer <APLAZO_*_WEBHOOK_SECRET>`
  - o `Basic <...>` si así lo configuras
- opcionalmente whitelisting de IP

### Recomendación técnica
No exigir `x-aplazo-signature` salvo que tu Postman privado muestre evidencia de eso.

---

## 10.4 Regla de negocio
El webhook debe ser la fuente principal de confirmación.

### No hacer
- No confirmar el pago solo porque el usuario regresó a `successUrl`

### Sí hacer
- Parsear webhook
- Deduplicar
- Resolver `PaymentAttempt`
- Pasar por `PaymentFinalizerService`
- Aplicar `exactly-once`

---

## 11. Finalización del pago (exactly-once)

`PaymentFinalizerService` debe ser la **única pieza autorizada** para cerrar pagos.

### Ecommerce
- actualizar pago
- actualizar orden
- no tocar stock de nuevo si ya se apartó al crear la orden

### POS
- actualizar pago
- actualizar `ventasPos`
- descontar inventario exactamente una vez
- generar ticket/comprobante si el módulo ya existe

### Reglas obligatorias
- dedupe por evento
- compare-and-set o lock por `paymentAttemptId`
- nunca doble finalización

---

## 12. Reconciliación

Debe existir un job/scheduler para:

- revisar pagos pendientes
- consultar estatus al proveedor
- marcar expirados
- rescatar webhooks huérfanos
- detectar divergencias entre pago, orden y POS

### Endpoint admin útil
```http
POST /api/admin/payments/aplazo/:paymentAttemptId/reconcile
```

---

## 13. Qué debe hacerse en `aplazo.provider.ts`

## 13.1 Corregir autenticación
### Online
Implementar `authenticateOnline()`:
- usar `merchantId` y `apiToken`
- `POST /auth`
- leer Bearer
- regresarlo en headers

### In-Store
Meter headers:
- `api_token`
- `merchant_id`

---

## 13.2 Dejar de usar payload genérico
Eliminar `buildGenericPayload()` como fuente real de contrato.

Crear:
- `buildOnlineAplazoPayload()`
- `buildInStoreAplazoPayload()`

---

## 13.3 Corregir mapeo de status
Soportar explícitamente:
- `Activo`
- `No confirmado`
- `Cancelado`
- `Devuelto`

---

## 13.4 Corregir `getStatus()`
### Online
Consultar por:
- `loanId`, o
- `cartId`

### In-Store
Construir path con `{cartId}`

---

## 13.5 Corregir `parseWebhook()`
Leer primero:
- `status`
- `loanId`
- `cartId`
- `merchantId`

Mapear:
- `providerLoanId <- loanId`
- `providerReference <- cartId`

Validar `Authorization` si hay secret configurado.

---

## 14. Cómo probar credenciales en Postman

## 14.1 Online
### Request
```http
POST https://api.aplazo.net/api/auth
Content-Type: application/json
```

### Body
```json
{
  "apiToken": "<APLAZO_ONLINE_API_TOKEN>",
  "merchantId": 3683
}
```

### Resultado esperado
- 200 OK
- token Bearer o Authorization útil para request posterior

---

## 14.2 In-Store
### Request
```http
POST https://api.aplazo.net/api/pos/loan
Content-Type: application/json
api_token: <APLAZO_INSTORE_API_TOKEN>
merchant_id: 3684
```

### Resultado esperado
- 200 o error de validación del body
- pero **no** error de autenticación

Si da 401/403, las credenciales están mal.

---

## 15. Errores comunes

### `APLAZO_DISABLED`
Pasa cuando tienes:
```env
APLAZO_ENABLED=false
```
o:
```env
APLAZO_ONLINE_ENABLED=false
```

### Secret Manager 404
Pasa cuando intentas desplegar variables no sensibles como secrets, por ejemplo:
- `APLAZO_ONLINE_CANCEL_PATH`
- `APLAZO_INSTORE_RESEND_CHECKOUT_PATH`
- `APLAZO_INSTORE_GET_QR_PATH`

Eso debe ir como `process.env`, no como `defineSecret`.

---

## 16. Qué sigue pendiente de confirmar con Postman privado

Aunque la integración ya puede avanzar mucho, todavía conviene confirmar en el Postman privado:

- path exacto de `APLAZO_ONLINE_CANCEL_PATH`
- path exacto de `APLAZO_INSTORE_RESEND_CHECKOUT_PATH`
- path exacto de `APLAZO_INSTORE_GET_QR_PATH`
- esquema exacto de `products[]` online
- si `/loan` requiere campos adicionales por producto
- si `errorUrl` necesita algo extra según canal o contrato privado

---

## 17. Conclusión

La forma correcta de implementar Aplazo en backend es:

1. tratarlo como provider separado de Stripe
2. respetar que **online** e **in-store** usan contratos distintos
3. usar backend para create/auth/status/refund
4. usar `cartId` y `loanId` como referencias reales
5. confirmar pago por webhook/reconcile, no por redirect
6. proteger finalización con exactly-once
7. dejar como TODO solamente los puntos que sí dependen del Postman privado

Con esto, la integración queda bien encaminada y lista para aterrizarse en `aplazo.provider.ts`, `aplazo.contract.v1.ts` y la capa común de pagos.
