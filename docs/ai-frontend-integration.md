# Guia de integracion frontend del modulo AI

Esta guia documenta el comportamiento real del backend para todos los endpoints bajo `/api/ai`. El objetivo es que frontend pueda consumir chat, sesiones, uploads y virtual try-on sin depender de supuestos del Swagger.

## 1. Base URL y autenticacion

Base URL local:

```text
http://localhost:3000/api
```

Base URL productiva esperada:

```text
https://us-central1-e-comerce-leon.cloudfunctions.net/api
```

Todos los endpoints de esta guia requieren:

```http
Authorization: Bearer <jwt-del-backend>
```

Importante:

- Los endpoints AI no aceptan directamente un Firebase ID token.
- Primero debes intercambiar el Firebase ID token por el JWT propio del backend usando `POST /api/auth/register-or-login`.
- Ese JWT propio es el que despues se envia a `/api/ai/*`.

### Flujo real para obtener el token correcto

```ts
type BackendAuthResponse = {
  success: boolean;
  token: string;
  usuario: {
    uid: string;
    email: string;
    rol: "CLIENTE" | "EMPLEADO" | "ADMIN";
    nombre: string;
  };
};

export async function getBackendJwt(firebaseIdToken: string) {
  const res = await fetch("http://localhost:3000/api/auth/register-or-login", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${firebaseIdToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const json = (await res.json()) as BackendAuthResponse | { success?: boolean; message?: string };

  if (!res.ok || !("token" in json)) {
    throw new Error("No se pudo obtener el JWT del backend");
  }

  return json.token;
}
```

### Header opcional `x-request-id`

El backend genera o reutiliza `x-request-id` en todas las respuestas.

Uso recomendado:

- Si frontend ya tiene un ID de trazabilidad, envialo en el request.
- Si no lo envias, el backend generara uno y lo devolvera en la respuesta.

```ts
const requestId = crypto.randomUUID();

const res = await fetch("http://localhost:3000/api/ai/chat/sessions", {
  method: "GET",
  headers: {
    Authorization: `Bearer ${backendJwt}`,
    "x-request-id": requestId,
  },
});

console.log(res.headers.get("x-request-id"));
```

## 2. Flujo recomendado de integracion

1. Obtener el JWT del backend con `POST /api/auth/register-or-login`.
2. Crear una sesion AI con `POST /api/ai/chat/sessions`.
3. Guardar el `sessionId`.
4. Listar o recuperar la sesion cuando necesites recargar historial.
5. Enviar mensajes al agente con `POST /api/ai/chat/messages`.
6. Si vas a usar try-on, subir primero una imagen con `POST /api/ai/files/upload`.
7. Guardar el `asset.id` devuelto por upload como `userImageAssetId`.
8. Crear el job de try-on con `POST /api/ai/tryon/jobs`.
9. Consultar el estado con `GET /api/ai/tryon/jobs/:id`.
10. Cuando el job quede `completed`, pedir la URL firmada con `GET /api/ai/tryon/jobs/:id/download`.
11. Los endpoints `/api/ai/admin/*` dejalos solo para panel interno y usuarios `ADMIN`.

## 3. Helpers TypeScript reutilizables

```ts
const API_BASE_URL = "http://localhost:3000/api";

export async function apiFetch<T>(
  path: string,
  jwt: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${jwt}`);

  if (!headers.has("x-request-id")) {
    headers.set("x-request-id", crypto.randomUUID());
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = json?.message || "Request fallido";
    throw new Error(message);
  }

  return json as T;
}
```

## 4. Formato de respuestas y errores

### Respuestas exitosas mas comunes

Lista:

```json
{
  "success": true,
  "count": 2,
  "data": []
}
```

Objeto:

```json
{
  "success": true,
  "data": {}
}
```

### Errores de validacion Zod

```json
{
  "success": false,
  "message": "Validacion fallida",
  "errors": [
    {
      "campo": "message",
      "mensaje": "String must contain at least 1 character(s)",
      "codigo": "too_small"
    }
  ]
}
```

### Errores generales desde controladores

```json
{
  "success": false,
  "message": "Sesion AI no encontrada"
}
```

### Errores del auth middleware heredado

Este modulo AI esta protegido por `authMiddleware`, y ese middleware no usa siempre el mismo shape que el resto de la API. En varios casos responde solo:

```json
{
  "message": "No autorizado. Token requerido"
}
```

En frontend conviene manejar ambos formatos:

- `{ success: false, message }`
- `{ message }`

### Status codes a esperar

- `400`: body o params invalidos, upload invalido, job no creable
- `401`: token ausente, invalido o expirado
- `403`: recurso ajeno o endpoint admin sin permisos
- `404`: sesion o job inexistente
- `409`: descarga pedida antes de que el try-on termine
- `429`: rate limit por IP

## 5. Rate limits y restricciones

La limitacion actual se hace por IP, no por usuario.

Configuracion base:

- ventana: `AI_RATE_LIMIT_WINDOW_MS`
- maximo global: `AI_RATE_LIMIT_MAX`

Derivados actuales:

- chat: `AI_RATE_LIMIT_MAX` por ventana
- upload: `max(3, floor(AI_RATE_LIMIT_MAX / 3))`
- try-on: `max(5, floor(AI_RATE_LIMIT_MAX / 2))`

Valores por defecto si no cambias variables de entorno:

- chat: `30` requests por `60000 ms`
- upload: `10` requests por `60000 ms`
- try-on: `15` requests por `60000 ms`

Cuando ocurre `429`, el backend agrega:

```http
Retry-After: <segundos>
```

Respuesta:

```json
{
  "success": false,
  "message": "Demasiadas solicitudes. Intenta nuevamente en unos segundos"
}
```

## 6. Endpoints de usuario

### POST `/api/ai/chat/sessions`

Crea una nueva sesion de chat para el usuario autenticado.

Quien puede usarlo:

- `CLIENTE`
- `EMPLEADO`
- `ADMIN`

Headers:

```http
Authorization: Bearer <jwt-del-backend>
Content-Type: application/json
```

Body:

```ts
type CreateAiSessionBody = {
  channel?: string; // default real: "app"
  title?: string;   // si no se envia, backend guarda "Nueva conversacion"
};
```

Ejemplo:

```ts
type CreateAiSessionResponse = {
  success: true;
  data: AiSession;
};

export async function createAiSession(jwt: string) {
  return apiFetch<CreateAiSessionResponse>("/ai/chat/sessions", jwt, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: "app",
      title: "Ayuda con jerseys",
    }),
  });
}
```

Respuesta exitosa `201`:

```json
{
  "success": true,
  "data": {
    "id": "session_123",
    "userId": "uid_123",
    "role": "CLIENTE",
    "channel": "app",
    "title": "Ayuda con jerseys",
    "status": "active",
    "summary": "",
    "lastMessageAt": "<Timestamp Firestore serializado>",
    "createdAt": "<Timestamp Firestore serializado>",
    "updatedAt": "<Timestamp Firestore serializado>"
  }
}
```

Errores comunes:

- `400` body invalido
- `401` token invalido o ausente
- `429` exceso de requests

Notas frontend:

- Guarda `data.id` como `sessionId`.
- Si no mandas `title`, la sesion queda como `"Nueva conversacion"`.

---

### GET `/api/ai/chat/sessions`

Lista hasta 50 sesiones del usuario autenticado, ordenadas por `updatedAt desc`.

Quien puede usarlo:

- `CLIENTE`
- `EMPLEADO`
- `ADMIN`

Ejemplo:

```ts
type ListAiSessionsResponse = {
  success: true;
  count: number;
  data: AiSession[];
};

export async function listAiSessions(jwt: string) {
  return apiFetch<ListAiSessionsResponse>("/ai/chat/sessions", jwt, {
    method: "GET",
  });
}
```

Respuesta exitosa `200`:

```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": "session_123",
      "userId": "uid_123",
      "role": "CLIENTE",
      "channel": "app",
      "title": "Ayuda con jerseys",
      "status": "active",
      "summary": "Resumen parcial...",
      "lastMessageAt": "<Timestamp Firestore serializado>",
      "createdAt": "<Timestamp Firestore serializado>",
      "updatedAt": "<Timestamp Firestore serializado>"
    }
  ]
}
```

Errores comunes:

- `401`
- `429`

Notas frontend:

- Este endpoint es el punto de entrada para rehidratar sidebar o historial.

---

### GET `/api/ai/chat/sessions/:id`

Obtiene detalle completo de una sesion, incluyendo mensajes y tool calls persistidos.

Quien puede usarlo:

- El dueño de la sesion
- `ADMIN`

Params:

```ts
type SessionIdParam = {
  id: string;
};
```

Ejemplo:

```ts
type GetAiSessionDetailResponse = {
  success: true;
  data: {
    session: AiSession;
    messages: AiMessage[];
    toolCalls: AiToolCall[];
  };
};

export async function getAiSessionDetail(jwt: string, sessionId: string) {
  return apiFetch<GetAiSessionDetailResponse>(`/ai/chat/sessions/${sessionId}`, jwt, {
    method: "GET",
  });
}
```

Respuesta exitosa `200`:

```json
{
  "success": true,
  "data": {
    "session": {
      "id": "session_123",
      "status": "active"
    },
    "messages": [
      {
        "id": "msg_1",
        "sessionId": "session_123",
        "userId": "uid_123",
        "role": "user",
        "content": "Quiero un jersey local",
        "createdAt": "<Timestamp Firestore serializado>"
      },
      {
        "id": "msg_2",
        "sessionId": "session_123",
        "userId": "uid_123",
        "role": "assistant",
        "content": "Te ayudo a buscarlo",
        "model": "gemini-2.5-pro-preview-05-06",
        "latencyMs": 1320,
        "createdAt": "<Timestamp Firestore serializado>"
      }
    ],
    "toolCalls": [
      {
        "id": "tool_1",
        "sessionId": "session_123",
        "messageId": "msg_1",
        "toolName": "search_products",
        "status": "success",
        "createdAt": "<Timestamp Firestore serializado>"
      }
    ]
  }
}
```

Errores comunes:

- `400` param invalido
- `403` sesion ajena
- `404` sesion inexistente
- `429` exceso de requests

Notas frontend:

- Usa este endpoint para reconstruir el hilo si el usuario recarga la pagina.
- `toolCalls` sirve para auditoria o vistas avanzadas, no es obligatorio mostrarlo en UI.

---

### POST `/api/ai/chat/messages`

Envia un mensaje al agente AI. Puede responder como JSON normal o como SSE.

Quien puede usarlo:

- `CLIENTE`
- `EMPLEADO`
- `ADMIN`

Body:

```ts
type SendAiMessageBody = {
  sessionId: string;
  message: string; // 1..4000 caracteres
  attachments?: Array<{
    assetId: string;
  }>; // maximo 3
  stream?: boolean;
};
```

Activacion del modo SSE:

- `Accept: text/event-stream`
- o `?stream=true`
- o `body.stream === true`

Importante:

- Como es un `POST` autenticado, no uses `EventSource`.
- Usa `fetch` y consume `response.body` con `ReadableStream`.
- El backend actual emite pseudo-streaming: primero un estado, luego el resultado final completo.

#### Respuesta JSON normal

Ejemplo:

```ts
type SendAiMessageJsonResponse = {
  success: true;
  data: {
    text: string;
    toolCalls: Array<{
      id: string;
      toolName: string;
      status: string;
    }>;
    model: string;
    latencyMs: number;
  };
};

export async function sendAiMessageJson(
  jwt: string,
  body: Omit<SendAiMessageBody, "stream">,
) {
  return apiFetch<SendAiMessageJsonResponse>("/ai/chat/messages", jwt, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
```

Body de ejemplo:

```json
{
  "sessionId": "session_123",
  "message": "Buscame jerseys negros disponibles en talla m"
}
```

Respuesta exitosa `200`:

```json
{
  "success": true,
  "data": {
    "text": "Encontre opciones disponibles para ti.",
    "toolCalls": [
      {
        "id": "tool_1",
        "toolName": "search_products",
        "status": "success"
      }
    ],
    "model": "gemini-2.5-pro-preview-05-06",
    "latencyMs": 1460
  }
}
```

#### Respuesta SSE

Eventos emitidos hoy:

- `status` con `{"status":"processing"}`
- `final` con el resultado final completo
- `done` con `{}`

Ejemplo real de consumo:

```ts
type AiSseHandlers = {
  onStatus?: (payload: { status: string }) => void;
  onFinal?: (payload: {
    text: string;
    toolCalls: Array<{ id: string; toolName: string; status: string }>;
    model: string;
    latencyMs: number;
  }) => void;
};

export async function sendAiMessageSse(
  jwt: string,
  body: Omit<SendAiMessageBody, "stream">,
  handlers: AiSseHandlers,
) {
  const res = await fetch(`${API_BASE_URL}/ai/chat/messages?stream=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "x-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify({
      ...body,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    throw new Error("No se pudo abrir el stream AI");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const chunk = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const lines = chunk.split("\n");
      const event = lines.find((line) => line.startsWith("event:"))?.replace("event:", "").trim();
      const dataLine = lines.find((line) => line.startsWith("data:"))?.replace("data:", "").trim();

      if (event && dataLine) {
        const payload = JSON.parse(dataLine);

        if (event === "status") {
          handlers.onStatus?.(payload);
        }

        if (event === "final") {
          handlers.onFinal?.(payload);
        }

        if (event === "done") {
          return;
        }
      }

      separatorIndex = buffer.indexOf("\n\n");
    }
  }
}
```

Errores comunes:

- `400` body invalido
- `401` token invalido o ausente
- `429` exceso de requests
- `500` si el orquestador falla

Notas frontend:

- `attachments` esta aceptado por validacion, pero hoy el controlador no lo propaga al orquestador. Tratalo como campo reservado, sin efecto observable actual.
- El mensaje del usuario si se persiste en la sesion.
- La respuesta final incluye `toolCalls`, util para debug o trazabilidad.

---

### POST `/api/ai/files/upload`

Sube una imagen privada para el flujo de virtual try-on.

Quien puede usarlo:

- `CLIENTE`
- `EMPLEADO`
- `ADMIN`

Tipo de request:

```http
Content-Type: multipart/form-data
```

Campos:

```ts
type UploadAiFileForm = {
  file: File;       // obligatorio
  sessionId?: string; // opcional
};
```

Restricciones reales:

- solo `image/jpeg`, `image/png`, `image/webp`
- maximo `AI_UPLOAD_MAX_MB` megabytes; default `10 MB`
- maximo `AI_UPLOAD_MAX_FILES`; default `1`
- dimensiones minimas:
  - ancho `AI_UPLOAD_MIN_WIDTH`; default `512`
  - alto `AI_UPLOAD_MIN_HEIGHT`; default `512`

Ejemplo:

```ts
type UploadAiFileResponse = {
  success: true;
  data: TryOnAsset;
};

export async function uploadAiUserImage(
  jwt: string,
  file: File,
  sessionId?: string,
) {
  const formData = new FormData();
  formData.append("file", file);

  if (sessionId) {
    formData.append("sessionId", sessionId);
  }

  const res = await fetch(`${API_BASE_URL}/ai/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "x-request-id": crypto.randomUUID(),
    },
    body: formData,
  });

  const json = (await res.json()) as UploadAiFileResponse | { success?: boolean; message?: string };
  if (!res.ok || !("data" in json)) {
    throw new Error(json?.message || "No se pudo subir la imagen");
  }

  return json;
}
```

Respuesta exitosa `201`:

```json
{
  "success": true,
  "data": {
    "id": "asset_123",
    "userId": "uid_123",
    "sessionId": "session_123",
    "kind": "user_upload",
    "bucket": "e-comerce-leon-ai-private",
    "objectPath": "ai/uploads/uid_123/foto.png",
    "mimeType": "image/png",
    "fileName": "foto.png",
    "sizeBytes": 345678,
    "width": 1024,
    "height": 1024,
    "sha256": "hash",
    "createdAt": "<Timestamp Firestore serializado>",
    "updatedAt": "<Timestamp Firestore serializado>"
  }
}
```

Errores comunes:

- `400` falta `file`
- `400` tipo no permitido
- `400` imagen corrupta
- `400` imagen demasiado pequena
- `400` `sessionId` ajeno al usuario
- `401`
- `429`

Notas frontend:

- Guarda `data.id`. Ese valor se usara como `userImageAssetId` al crear el try-on job.
- Si mandas `sessionId`, debe pertenecer al usuario autenticado.

---

### POST `/api/ai/tryon/jobs`

Crea un job asincrono de virtual try-on. El job se guarda inicialmente como `queued`.

Quien puede usarlo:

- `CLIENTE`
- `EMPLEADO`
- `ADMIN`

Body:

```ts
type CreateTryOnJobBody = {
  sessionId: string;
  productId: string;
  variantId?: string;
  sku?: string;
  userImageAssetId: string;
  consentAccepted: true;
};
```

Dependencias reales:

- la sesion debe existir y pertenecer al usuario
- el asset debe existir y pertenecer al usuario
- el asset debe ser de tipo `user_upload`
- el producto debe existir
- el producto debe tener una imagen oficial utilizable

Ejemplo:

```ts
type CreateTryOnJobResponse = {
  success: true;
  data: TryOnJob;
};

export async function createTryOnJob(
  jwt: string,
  body: CreateTryOnJobBody,
) {
  return apiFetch<CreateTryOnJobResponse>("/ai/tryon/jobs", jwt, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
```

Body de ejemplo:

```json
{
  "sessionId": "session_123",
  "productId": "prod_123",
  "userImageAssetId": "asset_123",
  "consentAccepted": true
}
```

Respuesta exitosa `201`:

```json
{
  "success": true,
  "data": {
    "id": "job_123",
    "userId": "uid_123",
    "sessionId": "session_123",
    "productId": "prod_123",
    "inputUserImageAssetId": "asset_123",
    "inputUserImageUrl": "gs://e-comerce-leon-ai-private/ai/uploads/uid_123/foto.png",
    "inputProductImageUrl": "gs://bucket/productos/jersey.png",
    "status": "queued",
    "consentAccepted": true,
    "requestedByRole": "CLIENTE",
    "createdAt": "<Timestamp Firestore serializado>",
    "updatedAt": "<Timestamp Firestore serializado>"
  }
}
```

Errores comunes:

- `400` body invalido
- `400` `consentAccepted` distinto de `true`
- `400` sesion invalida
- `400` asset invalido
- `400` producto sin imagen utilizable
- `401`
- `429`

Notas frontend:

- No esperes el resultado final aqui. Este endpoint solo encola el job.
- Guarda `data.id` como `jobId`.
- Luego consulta estado periodicamente.

---

### GET `/api/ai/tryon/jobs`

Lista hasta 50 jobs de try-on del usuario autenticado, ordenados por `createdAt desc`.

Quien puede usarlo:

- `CLIENTE`
- `EMPLEADO`
- `ADMIN`

Ejemplo:

```ts
type ListTryOnJobsResponse = {
  success: true;
  count: number;
  data: TryOnJob[];
};

export async function listTryOnJobs(jwt: string) {
  return apiFetch<ListTryOnJobsResponse>("/ai/tryon/jobs", jwt, {
    method: "GET",
  });
}
```

Respuesta exitosa `200`:

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": "job_123",
      "status": "processing",
      "productId": "prod_123",
      "sessionId": "session_123",
      "createdAt": "<Timestamp Firestore serializado>",
      "updatedAt": "<Timestamp Firestore serializado>"
    }
  ]
}
```

Errores comunes:

- `401`
- `429`

Notas frontend:

- Ideal para una vista de historial de try-ons.

---

### GET `/api/ai/tryon/jobs/:id`

Obtiene el estado actual de un job de try-on.

Quien puede usarlo:

- El dueño del job
- `ADMIN`

Ejemplo:

```ts
type GetTryOnJobResponse = {
  success: true;
  data: TryOnJob;
};

export async function getTryOnJob(jwt: string, jobId: string) {
  return apiFetch<GetTryOnJobResponse>(`/ai/tryon/jobs/${jobId}`, jwt, {
    method: "GET",
  });
}
```

Respuesta exitosa `200`:

```json
{
  "success": true,
  "data": {
    "id": "job_123",
    "userId": "uid_123",
    "sessionId": "session_123",
    "productId": "prod_123",
    "status": "completed",
    "outputAssetId": "asset_out_123",
    "outputImageUrl": "gs://e-comerce-leon-ai-private/ai/tryon-results/uid_123/session_123/job_123.png",
    "completedAt": "<Timestamp Firestore serializado>",
    "createdAt": "<Timestamp Firestore serializado>",
    "updatedAt": "<Timestamp Firestore serializado>"
  }
}
```

Errores comunes:

- `400` param invalido
- `403` job ajeno
- `404` job inexistente
- `429`

Notas frontend:

- Haz polling hasta que `status` sea `completed` o `failed`.
- Si queda `failed`, revisa `errorCode` y `errorMessage` si vienen presentes.

Ejemplo de polling:

```ts
export async function pollTryOnUntilFinished(
  jwt: string,
  jobId: string,
  intervalMs = 4000,
  timeoutMs = 120000,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await getTryOnJob(jwt, jobId);
    const job = result.data;

    if (job.status === "completed" || job.status === "failed") {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Timeout esperando el resultado del try-on");
}
```

---

### GET `/api/ai/tryon/jobs/:id/download`

Devuelve una URL firmada temporal para descargar el resultado del try-on.

Quien puede usarlo:

- El dueño del job
- `ADMIN`

Condicion obligatoria:

- El job debe existir
- Debe pertenecer al usuario o el usuario debe ser `ADMIN`
- Debe estar en estado `completed`

Ejemplo:

```ts
type GetTryOnDownloadLinkResponse = {
  success: true;
  data: {
    jobId: string;
    url: string;
    expiresInSec: number;
  };
};

export async function getTryOnDownloadLink(jwt: string, jobId: string) {
  return apiFetch<GetTryOnDownloadLinkResponse>(`/ai/tryon/jobs/${jobId}/download`, jwt, {
    method: "GET",
  });
}
```

Respuesta exitosa `200`:

```json
{
  "success": true,
  "data": {
    "jobId": "job_123",
    "url": "https://storage.googleapis.com/...",
    "expiresInSec": 900
  }
}
```

Errores comunes:

- `400` param invalido
- `403` job ajeno
- `404` job inexistente
- `409` el resultado aun no esta disponible
- `429`

Respuesta tipica `409`:

```json
{
  "success": false,
  "message": "El resultado del try-on aun no esta disponible"
}
```

Notas frontend:

- Pide esta URL solo cuando el job ya este `completed`.
- La URL es temporal; si expira, vuelve a pedirla.

## 7. Endpoints admin

Estos endpoints son solo para usuarios con rol `ADMIN`. `EMPLEADO` y `CLIENTE` recibiran `403`.

### GET `/api/ai/admin/metrics`

Devuelve metricas agregadas del modulo AI.

Ejemplo:

```ts
type GetAiAdminMetricsResponse = {
  success: true;
  data: {
    sessions: number;
    messages: number;
    toolCalls: number;
    tryOnJobs: number;
  };
};

export async function getAiAdminMetrics(jwt: string) {
  return apiFetch<GetAiAdminMetricsResponse>("/ai/admin/metrics", jwt, {
    method: "GET",
  });
}
```

Respuesta exitosa `200`:

```json
{
  "success": true,
  "data": {
    "sessions": 12,
    "messages": 340,
    "toolCalls": 126,
    "tryOnJobs": 18
  }
}
```

Errores comunes:

- `401`
- `403`

---

### GET `/api/ai/admin/jobs`

Lista hasta 50 jobs recientes de try-on sin filtrar por usuario.

Ejemplo:

```ts
type ListAiAdminJobsResponse = {
  success: true;
  count: number;
  data: TryOnJob[];
};

export async function listAiAdminJobs(jwt: string) {
  return apiFetch<ListAiAdminJobsResponse>("/ai/admin/jobs", jwt, {
    method: "GET",
  });
}
```

Respuesta exitosa `200`:

```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": "job_123",
      "userId": "uid_123",
      "status": "completed",
      "createdAt": "<Timestamp Firestore serializado>"
    },
    {
      "id": "job_124",
      "userId": "uid_456",
      "status": "failed",
      "errorCode": "VERTEX_TIMEOUT",
      "errorMessage": "Tiempo agotado",
      "createdAt": "<Timestamp Firestore serializado>"
    }
  ]
}
```

Errores comunes:

- `401`
- `403`

Notas frontend:

- Usalo para dashboard interno, monitoreo o soporte.
- No lo mezcles con la experiencia de usuario final.

## 8. Contratos y modelos utiles

Los siguientes contratos reflejan los modelos actuales del backend. No todos los campos son obligatorios en todas las respuestas, pero estos son los nombres reales.

```ts
export type AiSessionStatus = "active" | "archived" | "closed";
export type AiMessageRole = "user" | "assistant" | "system" | "tool";
export type AiToolCallStatus = "success" | "error" | "denied";
export type TryOnJobStatus = "queued" | "processing" | "completed" | "failed";
export type TryOnAssetKind = "user_upload" | "product_image" | "output_image";

export type AiAttachment = {
  assetId: string;
  url?: string;
  mimeType: string;
  kind: TryOnAssetKind | "generic";
};

export type AiSession = {
  id?: string;
  userId: string;
  role: "CLIENTE" | "EMPLEADO" | "ADMIN";
  channel: string;
  title: string;
  status: AiSessionStatus;
  summary?: string;
  lastMessageAt?: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};

export type AiMessage = {
  id?: string;
  sessionId: string;
  userId: string;
  role: AiMessageRole;
  content: string;
  model?: string;
  attachments?: AiAttachment[];
  toolCallIds?: string[];
  latencyMs?: number;
  tokenUsage?: {
    promptTokens?: number;
    responseTokens?: number;
    totalTokens?: number;
  };
  createdAt: unknown;
};

export type AiToolCall = {
  id?: string;
  sessionId: string;
  messageId: string;
  userId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: AiToolCallStatus;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt: unknown;
};

export type TryOnAsset = {
  id?: string;
  userId: string;
  sessionId?: string;
  jobId?: string;
  productId?: string;
  variantId?: string;
  sku?: string;
  kind: TryOnAssetKind;
  bucket: string;
  objectPath: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  sha256?: string;
  createdAt: unknown;
  updatedAt: unknown;
};

export type TryOnJob = {
  id?: string;
  userId: string;
  sessionId: string;
  productId: string;
  variantId?: string;
  sku?: string;
  inputUserImageAssetId: string;
  inputUserImageUrl?: string;
  inputProductImageUrl: string;
  outputAssetId?: string;
  outputImageUrl?: string;
  status: TryOnJobStatus;
  consentAccepted: boolean;
  requestedByRole: "CLIENTE" | "EMPLEADO" | "ADMIN";
  errorCode?: string;
  errorMessage?: string;
  providerJobId?: string;
  createdAt: unknown;
  updatedAt: unknown;
  completedAt?: unknown;
};
```

## 9. Notas de integracion importantes

- `POST /api/ai/chat/messages` acepta `attachments`, pero hoy el controlador no los pasa al servicio AI. No bases ninguna funcionalidad critica en ese campo todavia.
- El backend persiste sesiones, mensajes, tool calls y try-on jobs en Firestore.
- Los jobs de try-on son asincronos. La secuencia correcta es:
  - upload
  - create job
  - polling a status
  - pedir download link
- La descarga final siempre es por URL firmada temporal, no por archivo embebido en la respuesta.
- Los endpoints admin usan `requireAiAdmin`, asi que `EMPLEADO` no entra aunque el modulo AI le habilite otras capacidades internas dentro del chat.

## 10. Checklist rapido para frontend

- Obtener Firebase ID token.
- Intercambiarlo por JWT del backend con `POST /api/auth/register-or-login`.
- Guardar el JWT del backend y usarlo en `Authorization`.
- Crear y persistir `sessionId`.
- Elegir si el chat consumira JSON o SSE.
- Si usas SSE, leer `ReadableStream` con `fetch`, no `EventSource`.
- Si usas try-on, subir imagen y guardar `asset.id`.
- Crear el job y persistir `jobId`.
- Hacer polling de estado hasta `completed` o `failed`.
- Pedir la URL de descarga solo cuando el job ya este listo.
- Manejar ambos formatos de error: `{ success: false, message }` y `{ message }`.
