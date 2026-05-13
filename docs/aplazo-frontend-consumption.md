# Aplazo Frontend Consumption Guide

Guía para consumir desde frontend los endpoints de Aplazo Online:

- Cliente solicita devolución y consulta estatus.
- Admin revisa solicitudes pendientes, aprueba o rechaza.
- Si admin aprueba, backend llama al refund de Aplazo.
- Admin puede cancelar pagos Aplazo todavía no confirmados.
- Admin puede consultar el estado de refunds en Aplazo.

Stripe no usa estos endpoints. Para Stripe se mantienen los flujos documentados en la guía Stripe.

## Base URL y Auth

Usa la URL pública del backend:

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL;
```

Todas las llamadas autenticadas deben enviar:

```http
Authorization: Bearer <firebase_id_token>
Content-Type: application/json
```

Roles:

- Cliente: puede crear y consultar sus solicitudes Aplazo.
- `ADMIN`: puede listar, aprobar y rechazar solicitudes; también cancelar intentos Aplazo.
- `EMPLEADO`: puede listar solicitudes admin y consultar refund status, pero no aprobar/rechazar.

Formato de error estándar:

```json
{
  "ok": false,
  "error": {
    "code": "REFUND_REQUEST_ALREADY_OPEN",
    "message": "Mensaje legible",
    "details": {}
  }
}
```

## Estados

Estados visibles para solicitudes de devolución:

- `pending`: cliente solicitó devolución y espera revisión.
- `approved`: admin aprobó; si Aplazo falló, puede quedar aprobado con error para reintento.
- `rejected`: admin rechazó la solicitud.
- `processed`: Aplazo recibió/procesó el refund desde backend.

Estados visibles del pago:

- `pending_customer`: pago pendiente en Aplazo.
- `canceled`: pago cancelado.
- `paid`: pago confirmado.
- `partially_refunded`: reembolso parcial aplicado.
- `refunded`: reembolso total aplicado.

## 1. Cliente: crear solicitud de devolución

El cliente inicia la devolución por `orderId` y motivo. El backend resuelve el pago Aplazo Online pagado de esa orden.

```http
POST /api/payments/aplazo/refund-requests
```

Body:

```json
{
  "orderId": "orden_123",
  "reason": "La talla no era correcta"
}
```

Ejemplo frontend:

```ts
type AplazoRefundRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "processed";

type AplazoRefundRequest = {
  id: string;
  provider: "aplazo";
  orderId: string;
  paymentAttemptId: string;
  userId: string;
  reason: string;
  status: AplazoRefundRequestStatus;
  refundAmount?: number;
  refundAmountMinor?: number;
  providerRefundId?: string;
  providerStatus?: string;
  rejectionReason?: string;
  createdAt?: string;
  updatedAt?: string;
  approvedAt?: string;
  processedAt?: string;
  rejectedAt?: string;
};

type AplazoRefundRequestResponse = {
  ok: true;
  data: AplazoRefundRequest;
};

export async function createAplazoRefundRequest(params: {
  apiUrl: string;
  idToken: string;
  orderId: string;
  reason: string;
}) {
  const res = await fetch(`${params.apiUrl}/api/payments/aplazo/refund-requests`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      orderId: params.orderId,
      reason: params.reason,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw data;
  }

  return data as AplazoRefundRequestResponse;
}
```

Respuesta exitosa:

```json
{
  "ok": true,
  "data": {
    "id": "refund_req_123",
    "provider": "aplazo",
    "orderId": "orden_123",
    "paymentAttemptId": "pay_attempt_123",
    "userId": "uid_123",
    "reason": "La talla no era correcta",
    "status": "pending",
    "createdAt": "2026-05-05T19:00:00.000Z"
  }
}
```

Restricciones aplicadas por backend:

- El usuario autenticado debe ser dueño de la orden.
- La orden debe tener un pago Aplazo Online.
- El pago debe estar `paid` o `partially_refunded` con saldo disponible.
- No debe existir una solicitud `pending` o `approved` para el mismo pago.
- El pago no debe estar completamente `refunded`.

Errores esperados:

- `PAYMENT_FORBIDDEN`: orden de otro usuario.
- `PAYMENT_ATTEMPT_NOT_FOUND`: no hay pago Aplazo Online para la orden.
- `PAYMENT_NOT_PAID_USE_CANCEL`: el pago no está confirmado.
- `PAYMENT_ALREADY_REFUNDED`: el pago ya está totalmente reembolsado.
- `REFUND_REQUEST_ALREADY_OPEN`: ya existe solicitud pendiente o aprobada.

UX recomendada:

- Mostrar "Solicitar devolución" solo en órdenes pagadas con Aplazo.
- Pedir motivo obligatorio.
- Después de crear, mostrar badge `pending`.
- Si ya existe solicitud abierta, mostrar el estado existente en vez de permitir otra.

## 2. Cliente: consultar solicitudes

Lista las solicitudes del usuario autenticado. Puede filtrarse por `orderId`.

```http
GET /api/payments/aplazo/refund-requests
```

Query opcional:

```http
?orderId=orden_123
```

Ejemplo frontend:

```ts
type AplazoRefundRequestListResponse = {
  ok: true;
  count: number;
  data: AplazoRefundRequest[];
};

export async function listAplazoRefundRequests(params: {
  apiUrl: string;
  idToken: string;
  orderId?: string;
}) {
  const url = new URL(`${params.apiUrl}/api/payments/aplazo/refund-requests`);
  if (params.orderId) {
    url.searchParams.set("orderId", params.orderId);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.idToken}`,
    },
  });

  const data = await res.json();
  if (!res.ok) {
    throw data;
  }

  return data as AplazoRefundRequestListResponse;
}
```

Consulta individual:

```http
GET /api/payments/aplazo/refund-requests/{refundRequestId}
```

## 3. Admin: listar solicitudes pendientes

El panel admin usa este endpoint para revisar solicitudes.

```http
GET /api/admin/payments/aplazo/refund-requests
```

Query opcional:

```http
?status=pending
```

Ejemplo frontend admin:

```ts
export async function listAdminAplazoRefundRequests(params: {
  apiUrl: string;
  idToken: string;
  status?: AplazoRefundRequestStatus;
}) {
  const url = new URL(
    `${params.apiUrl}/api/admin/payments/aplazo/refund-requests`,
  );
  if (params.status) {
    url.searchParams.set("status", params.status);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.idToken}`,
    },
  });

  const data = await res.json();
  if (!res.ok) {
    throw data;
  }

  return data as AplazoRefundRequestListResponse;
}
```

UX recomendada:

- Vista por defecto: `status=pending`.
- Mostrar orden, cliente, motivo, fecha y estado.
- Para solicitudes `approved` con `lastProcessingError`, mostrar acción de reintento de aprobación/procesamiento.

## 4. Admin: aprobar y procesar refund Aplazo

Admin define el monto a devolver en centavos. Al aprobar, backend valida saldo, llama al endpoint de refund de Aplazo Online y marca la solicitud como `processed` si la operación termina correctamente.

```http
POST /api/admin/payments/aplazo/refund-requests/{refundRequestId}/approve
```

Body:

```json
{
  "refundAmountMinor": 10000,
  "reason": "Aprobado por soporte"
}
```

`refundAmountMinor` usa centavos. Ejemplo: `10000` = `$100.00 MXN`.

Ejemplo frontend admin:

```ts
export async function approveAplazoRefundRequest(params: {
  apiUrl: string;
  idToken: string;
  refundRequestId: string;
  refundAmountMinor: number;
  reason?: string;
}) {
  const res = await fetch(
    `${params.apiUrl}/api/admin/payments/aplazo/refund-requests/${params.refundRequestId}/approve`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refundAmountMinor: params.refundAmountMinor,
        reason: params.reason,
      }),
    },
  );

  const data = await res.json();
  if (!res.ok) {
    throw data;
  }

  return data as AplazoRefundRequestResponse;
}
```

Respuesta exitosa:

```json
{
  "ok": true,
  "data": {
    "id": "refund_req_123",
    "status": "processed",
    "refundAmountMinor": 10000,
    "refundAmount": 100,
    "providerRefundId": "25083",
    "providerStatus": "REQUESTED",
    "processedAt": "2026-05-05T19:10:00.000Z"
  }
}
```

Restricciones aplicadas por backend:

- Solo `ADMIN`.
- `APLAZO_REFUNDS_ENABLED` debe estar habilitado.
- La solicitud debe estar `pending` o `approved`.
- El pago debe ser Aplazo Online.
- El pago debe estar `paid` o `partially_refunded`.
- `refundAmountMinor` debe ser mayor a `0`.
- El monto no puede exceder el saldo reembolsable.
- Si ya hay un refund `processing`, se rechaza para evitar doble refund.

Si Aplazo falla:

- La solicitud queda `approved`.
- Se guarda `lastProcessingError` saneado.
- El pago local no se marca como reembolsado.
- Admin puede reintentar el mismo endpoint después.

Errores esperados:

- `PAYMENT_REFUND_UNSUPPORTED`: refunds Aplazo deshabilitados.
- `REFUND_REQUEST_NOT_APPROVABLE`: la solicitud ya fue rechazada o procesada.
- `REFUND_AMOUNT_INVALID`: monto inválido o `<= 0`.
- `REFUND_AMOUNT_EXCEEDS_AVAILABLE`: monto mayor al saldo disponible.
- `REFUND_ALREADY_PROCESSING`: ya hay un refund en proceso.
- `PAYMENT_ALREADY_REFUNDED`: pago totalmente reembolsado.
- `APLAZO_REFUND_FAILED`: Aplazo falló; solicitud queda `approved`.
- `PAYMENT_FORBIDDEN`: usuario sin rol `ADMIN`.

UX recomendada:

- Convertir pesos a centavos antes de enviar.
- Deshabilitar el botón durante la aprobación.
- Si falla con `APLAZO_REFUND_FAILED`, dejar la solicitud visible como aprobada con opción de reintento.
- Después de `processed`, refrescar detalle de pago y opcionalmente consultar refund status.

## 5. Admin: rechazar solicitud

Rechaza una solicitud pendiente. No llama a Aplazo.

```http
POST /api/admin/payments/aplazo/refund-requests/{refundRequestId}/reject
```

Body:

```json
{
  "reason": "La solicitud está fuera de la política de devoluciones"
}
```

Ejemplo frontend admin:

```ts
export async function rejectAplazoRefundRequest(params: {
  apiUrl: string;
  idToken: string;
  refundRequestId: string;
  reason: string;
}) {
  const res = await fetch(
    `${params.apiUrl}/api/admin/payments/aplazo/refund-requests/${params.refundRequestId}/reject`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: params.reason }),
    },
  );

  const data = await res.json();
  if (!res.ok) {
    throw data;
  }

  return data as AplazoRefundRequestResponse;
}
```

Errores esperados:

- `REFUND_REQUEST_NOT_REJECTABLE`: solo solicitudes `pending` pueden rechazarse.
- `PAYMENT_FORBIDDEN`: usuario sin rol `ADMIN`.

## 6. Admin: cancelar un pago Aplazo no confirmado

Cancela un intento Aplazo Online solo cuando todavía está `NO CONFIRMADO`.

```http
POST /api/admin/payments/aplazo/{paymentAttemptId}/cancel
```

Body:

```json
{
  "reason": "checkout abandoned"
}
```

Ejemplo frontend admin:

```ts
type AplazoCancelResponse = {
  ok: true;
  paymentAttemptId: string;
  provider: "aplazo";
  status: string;
  providerStatus?: string;
};

export async function cancelAplazoPayment(params: {
  apiUrl: string;
  idToken: string;
  paymentAttemptId: string;
  reason?: string;
}) {
  const res = await fetch(
    `${params.apiUrl}/api/admin/payments/aplazo/${params.paymentAttemptId}/cancel`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: params.reason }),
    },
  );

  const data = await res.json();
  if (!res.ok) {
    throw data;
  }

  return data as AplazoCancelResponse;
}
```

Errores esperados:

- `PAYMENT_FORBIDDEN`: el usuario no es `ADMIN`.
- `PAYMENT_CANCEL_NOT_ALLOWED`: el pago ya está ACTIVO/pagado o no está en estado cancelable.
- `PAYMENT_VALIDATION_ERROR`: el intento no es Aplazo o faltan datos de referencia.

## 7. Admin: consultar estado de refunds en Aplazo

Sincroniza el estado de refunds con Aplazo y devuelve el refund seleccionado o el más reciente.

```http
GET /api/admin/payments/aplazo/{paymentAttemptId}/refund/status
```

Query opcional:

```http
?refundId=25083
```

Ejemplo frontend admin:

```ts
type AplazoRefundStatusResponse = {
  ok: true;
  paymentAttemptId: string;
  provider: "aplazo";
  status: string;
  refundState?: string;
  providerStatus?: string;
  refundId?: string;
  refundAmount?: number;
  totalRefundedAmount: number;
  currency: string;
  refunds: Array<{
    id?: string;
    status?: string;
    refundState?: string;
    refundDate?: string;
    amount?: number;
  }>;
};

export async function getAplazoRefundStatus(params: {
  apiUrl: string;
  idToken: string;
  paymentAttemptId: string;
  refundId?: string;
}) {
  const url = new URL(
    `${params.apiUrl}/api/admin/payments/aplazo/${params.paymentAttemptId}/refund/status`,
  );
  if (params.refundId) {
    url.searchParams.set("refundId", params.refundId);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.idToken}`,
    },
  });

  const data = await res.json();
  if (!res.ok) {
    throw data;
  }

  return data as AplazoRefundStatusResponse;
}
```

Respuesta exitosa:

```json
{
  "ok": true,
  "paymentAttemptId": "pay_attempt_123",
  "provider": "aplazo",
  "status": "partially_refunded",
  "refundState": "processing",
  "providerStatus": "PROCESSING",
  "refundId": "25083",
  "refundAmount": 10,
  "totalRefundedAmount": 120,
  "currency": "MXN",
  "refunds": [
    {
      "id": "25083",
      "status": "PROCESSING",
      "refundState": "processing",
      "refundDate": "2024-12-19T17:49:33.910913",
      "amount": 10
    }
  ]
}
```

Errores esperados:

- `PAYMENT_FORBIDDEN`: usuario no es `ADMIN` ni `EMPLEADO`.
- `PAYMENT_VALIDATION_ERROR`: intento no es Aplazo.
- `PAYMENT_REFUND_UNSUPPORTED`: proveedor/config no soporta consulta.
- `PAYMENT_ATTEMPT_NOT_FOUND`: intento no encontrado.

## Endpoint admin directo de refund

Existe este endpoint operativo:

```http
POST /api/admin/payments/aplazo/{paymentAttemptId}/refund
```

Para UX normal, preferir el flujo de solicitudes:

1. Cliente crea `POST /api/payments/aplazo/refund-requests`.
2. Admin aprueba `POST /api/admin/payments/aplazo/refund-requests/{id}/approve`.
3. Backend llama a Aplazo y marca solicitud `processed`.

Usar el endpoint directo solo para herramientas internas o casos de soporte donde ya exista aprobación fuera del sistema.

## Flujos recomendados

### Flujo cliente: solicitud de devolución

1. Cliente abre detalle de orden Aplazo pagada.
2. Captura motivo.
3. Frontend llama `POST /api/payments/aplazo/refund-requests`.
4. UI muestra estado `pending`.
5. Cliente consulta su solicitud con `GET /api/payments/aplazo/refund-requests?orderId=...`.

### Flujo admin: revisión

1. Admin abre bandeja `GET /api/admin/payments/aplazo/refund-requests?status=pending`.
2. Revisa motivo y detalle de orden.
3. Si rechaza, llama `/reject` con motivo.
4. Si aprueba, captura monto y llama `/approve`.
5. UI refresca lista y detalle de pago.

### Flujo admin: reintento por fallo Aplazo

1. Solicitud queda `approved` con `lastProcessingError`.
2. Admin revisa error y saldo.
3. Admin vuelve a llamar `/approve` con el monto correcto.
4. Si Aplazo responde correctamente, solicitud pasa a `processed`.

### Flujo admin: cancelar pago no confirmado

1. Admin abre detalle de orden/pago.
2. UI verifica que el estado sea `pending_customer`.
3. Admin elige "Cancelar intento Aplazo".
4. Frontend llama `POST /cancel`.
5. UI refresca el detalle y muestra `canceled`.

## Helper de errores

```ts
export function getAplazoErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null
      ? (error as { error?: { code?: string } }).error?.code
      : undefined;

  switch (code) {
    case "REFUND_REQUEST_ALREADY_OPEN":
      return "Ya hay una solicitud de devolución en revisión para este pago.";
    case "REFUND_REQUEST_NOT_APPROVABLE":
      return "Esta solicitud no puede aprobarse en su estado actual.";
    case "REFUND_REQUEST_NOT_REJECTABLE":
      return "Esta solicitud ya no puede rechazarse.";
    case "PAYMENT_NOT_PAID_USE_CANCEL":
      return "Este pago aún no está confirmado. No se puede solicitar devolución.";
    case "REFUND_AMOUNT_INVALID":
      return "El monto del reembolso debe ser mayor a 0.";
    case "REFUND_AMOUNT_EXCEEDS_AVAILABLE":
      return "El monto excede el saldo disponible para reembolso.";
    case "REFUND_ALREADY_PROCESSING":
      return "Ya hay un reembolso en proceso para este pago.";
    case "PAYMENT_ALREADY_REFUNDED":
      return "Este pago ya fue reembolsado por completo.";
    case "APLAZO_REFUND_FAILED":
      return "Aplazo no pudo procesar el reembolso. Intenta más tarde o revisa soporte.";
    case "PAYMENT_CANCEL_NOT_ALLOWED":
      return "Este pago no puede cancelarse. Si ya está pagado, usa solicitud de devolución.";
    case "PAYMENT_REFUND_UNSUPPORTED":
      return "Los reembolsos Aplazo no están habilitados en este ambiente.";
    case "PAYMENT_FORBIDDEN":
      return "No tienes permisos para realizar esta operación.";
    default:
      return "No fue posible completar la operación de Aplazo.";
  }
}
```

## Checklist de integración frontend

- Usar Firebase ID token vigente.
- Cliente debe iniciar devolución por `orderId`, no por `paymentAttemptId`.
- Admin define `refundAmountMinor` al aprobar.
- Convertir montos de pesos a centavos antes de enviar `refundAmountMinor`.
- Deshabilitar botones mientras una request está en curso.
- Manejar errores por `error.code`, no por texto.
- Refrescar solicitud, orden y pago después de aprobar/rechazar.
- Consultar `GET /refund/status` después de un refund procesado si se quiere mostrar seguimiento fino de Aplazo.
