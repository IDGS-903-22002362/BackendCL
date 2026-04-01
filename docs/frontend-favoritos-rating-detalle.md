# Guia frontend para favoritos, puntuacion y detalle de producto

Esta guia documenta como consumir desde frontend los endpoints reales del backend para:

- favoritos
- puntuacion de producto
- detalle de producto

El objetivo es que frontend no dependa de supuestos del Swagger y tenga ejemplos listos para integrar con `fetch`.

## 1. Base URL y autenticacion

Base URL local:

```text
http://localhost:3000/api
```

Base URL productiva esperada:

```text
https://us-central1-e-comerce-leon.cloudfunctions.net/api
```

Importante:

- Los endpoints protegidos usan el JWT propio del backend.
- No envies directamente el Firebase ID token a `/api/favoritos` ni a `POST /api/productos/:id/calificacion`.
- Primero intercambia el Firebase ID token por el token del backend usando `POST /api/auth/register-or-login`.

### Helper para obtener el JWT del backend

```ts
export async function getBackendJwt(firebaseIdToken: string) {
  const res = await fetch("http://localhost:3000/api/auth/register-or-login", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${firebaseIdToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const json = await res.json();

  if (!res.ok || !json?.token) {
    throw new Error(json?.message || "No se pudo obtener el JWT del backend");
  }

  return json.token as string;
}
```

### Helper base para requests

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api";

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, init);
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw {
      status: res.status,
      body: json,
    };
  }

  return json as T;
}
```

## 2. Detalle de producto

### 2.1 Obtener detalle principal del producto

Endpoint:

```http
GET /api/productos/:id
```

Autenticacion:

- No obligatoria.
- Si envias `Authorization: Bearer <jwt-backend>`, la respuesta puede incluir contexto del usuario:
  - `isFavorito`
  - `ratingEligibility`
  - `myRating`

Ejemplo sin autenticacion:

```ts
export async function getProductDetail(productId: string) {
  return apiFetch<{
    success: boolean;
    data: {
      id: string;
      clave: string;
      descripcion: string;
      lineaId: string;
      categoriaId: string;
      precioPublico: number;
      precioCompra: number;
      existencias: number;
      proveedorId: string;
      tallaIds: string[];
      inventarioPorTalla: Array<{ tallaId: string; cantidad: number }>;
      stockMinimoGlobal: number;
      stockMinimoPorTalla: Array<{ tallaId: string; minimo: number }>;
      imagenes: string[];
      detalleIds: string[];
      ratingSummary: {
        average: number;
        count: number;
        updatedAt?: string;
      };
      activo: boolean;
      createdAt: string;
      updatedAt: string;
    };
  }>(`/productos/${productId}`);
}
```

Ejemplo autenticado:

```ts
export async function getProductDetailWithUserContext(
  productId: string,
  backendJwt: string,
) {
  return apiFetch<{
    success: boolean;
    data: {
      id: string;
      descripcion: string;
      imagenes: string[];
      precioPublico: number;
      ratingSummary: {
        average: number;
        count: number;
      };
      isFavorito?: boolean;
      ratingEligibility?: {
        canRate: boolean;
        reason: "eligible" | "purchase_required" | "not_delivered";
      };
      myRating?: {
        score: number;
        updatedAt: string;
      } | null;
    };
  }>(`/productos/${productId}`, {
    headers: {
      Authorization: `Bearer ${backendJwt}`,
    },
  });
}
```

Respuesta exitosa tipica:

```json
{
  "success": true,
  "data": {
    "id": "prod_12345",
    "descripcion": "Jersey Oficial Local 2024",
    "precioPublico": 1299.99,
    "imagenes": ["https://..."],
    "detalleIds": ["det_1", "det_2"],
    "ratingSummary": {
      "average": 4.5,
      "count": 10
    },
    "isFavorito": true,
    "ratingEligibility": {
      "canRate": true,
      "reason": "eligible"
    },
    "myRating": {
      "score": 5,
      "updatedAt": "2026-03-30T18:30:00Z"
    }
  }
}
```

Errores relevantes:

- `404` si el producto no existe
- `500` si ocurre un error interno

Recomendacion de UI:

- Si la vista es publica, puedes cargar el producto sin token.
- Si el usuario inicia sesion, vuelve a consultar el mismo endpoint con JWT para pintar favorito, elegibilidad y calificacion previa.

### 2.2 Obtener detalles secundarios del producto

Estos detalles salen de la subcoleccion `detalles` del producto y sirven para bullets, acordeones o secciones descriptivas.

Endpoint:

```http
GET /api/productos/:productoId/detalles
```

Ejemplo:

```ts
export async function getProductExtraDetails(productId: string) {
  return apiFetch<{
    success: boolean;
    count: number;
    data: Array<{
      id: string;
      descripcion: string;
      productoId: string;
      createdAt?: string;
      updatedAt?: string;
    }>;
  }>(`/productos/${productId}/detalles`);
}
```

Respuesta tipica:

```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": "det_abc123",
      "descripcion": "Tela 100% algodon, diseno oficial del club.",
      "productoId": "prod_12345"
    },
    {
      "id": "det_def456",
      "descripcion": "Corte regular fit.",
      "productoId": "prod_12345"
    }
  ]
}
```

Tambien existe el detalle individual:

```http
GET /api/productos/:productoId/detalles/:detalleId
```

Errores relevantes:

- `404` si el producto no existe o el detalle no pertenece al producto
- `409` si hay inconsistencia entre `detalleId` y `productoId`
- `500` si ocurre un error interno

## 3. Favoritos

Todos los endpoints de favoritos requieren JWT del backend.

### 3.1 Listar favoritos del usuario

Endpoint:

```http
GET /api/favoritos?limit=20&offset=0
```

Headers:

```http
Authorization: Bearer <jwt-backend>
```

Ejemplo:

```ts
export async function getFavorites(backendJwt: string, limit = 20, offset = 0) {
  return apiFetch<{
    success: boolean;
    count: number;
    meta: {
      limit: number;
      offset: number;
      returned: number;
    };
    data: Array<{
      id: string;
      usuarioId: string;
      createdAt: string;
      producto: {
        id: string;
        clave: string;
        descripcion: string;
        precioPublico: number;
        imagenes: string[];
      };
    }>;
  }>(`/favoritos?limit=${limit}&offset=${offset}`, {
    headers: {
      Authorization: `Bearer ${backendJwt}`,
    },
  });
}
```

Notas reales del backend:

- `limit` por default es `20`
- `offset` por default es `0`
- `limit` maximo permitido es `100`
- cada favorito devuelve solo la primera imagen del producto en `producto.imagenes`
- si un producto favorito esta inactivo, ya no aparece en el listado

### 3.2 Verificar si un producto esta en favoritos

Endpoint:

```http
GET /api/favoritos/check/:productoId
```

Ejemplo:

```ts
export async function checkFavorite(productId: string, backendJwt: string) {
  return apiFetch<{
    success: boolean;
    data: {
      esFavorito: boolean;
    };
  }>(`/favoritos/check/${productId}`, {
    headers: {
      Authorization: `Bearer ${backendJwt}`,
    },
  });
}
```

Respuesta:

```json
{
  "success": true,
  "data": {
    "esFavorito": true
  }
}
```

### 3.3 Agregar producto a favoritos

Endpoint:

```http
POST /api/favoritos
```

Body:

```json
{
  "productoId": "prod_12345"
}
```

Ejemplo:

```ts
export async function addFavorite(productId: string, backendJwt: string) {
  return apiFetch<{
    success: boolean;
    message: string;
    data: {
      id: string;
      usuarioId: string;
      productoId: string;
      createdAt: string;
    };
  }>("/favoritos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${backendJwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ productoId: productId }),
  });
}
```

Comportamiento real:

- responde `201` si el favorito se creo
- responde `200` si el producto ya estaba en favoritos
- responde `404` si el producto no existe
- responde `409` si el producto esta inactivo y no puede agregarse

Recomendacion de UI:

- trata `200` y `201` como operacion exitosa
- al terminar, actualiza estado local `isFavorito = true`

### 3.4 Eliminar producto de favoritos

Endpoint:

```http
DELETE /api/favoritos/:productoId
```

Ejemplo:

```ts
export async function removeFavorite(productId: string, backendJwt: string) {
  return apiFetch<{
    success: boolean;
    message: string;
  }>(`/favoritos/${productId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${backendJwt}`,
    },
  });
}
```

Respuesta tipica:

```json
{
  "success": true,
  "message": "Producto eliminado de favoritos"
}
```

Errores relevantes:

- `401` si no hay token o el token es invalido
- `404` si el producto no estaba en favoritos

## 4. Puntuacion de producto

### 4.1 Crear o actualizar calificacion

Endpoint:

```http
POST /api/productos/:id/calificacion
```

Autenticacion:

- Requiere JWT del backend

Body:

```json
{
  "score": 5
}
```

Reglas reales del backend:

- solo acepta enteros de `1` a `5`
- cada usuario tiene una sola calificacion por producto
- si ya califico, se actualiza la existente
- solo puede calificar quien tenga una orden del producto en estado `ENTREGADA`

Ejemplo:

```ts
export async function rateProduct(
  productId: string,
  score: 1 | 2 | 3 | 4 | 5,
  backendJwt: string,
) {
  return apiFetch<{
    success: boolean;
    message: string;
    data: {
      id: string;
      productId: string;
      userId: string;
      score: number;
      eligibleOrderId: string;
      eligibleDeliveredAt: string;
      createdAt: string;
      updatedAt: string;
    };
  }>(`/productos/${productId}/calificacion`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${backendJwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ score }),
  });
}
```

Comportamiento real:

- `201` cuando crea una calificacion nueva
- `200` cuando actualiza una existente
- `400` si `score` no cumple validacion
- `403` si el usuario no es elegible para calificar
- `404` si el producto no existe

Respuesta exitosa tipica:

```json
{
  "success": true,
  "message": "Calificacion registrada exitosamente",
  "data": {
    "id": "prod_12345__uid_abc",
    "productId": "prod_12345",
    "userId": "uid_abc",
    "score": 5,
    "eligibleOrderId": "order_123",
    "eligibleDeliveredAt": "2026-03-29T18:00:00Z",
    "createdAt": "2026-03-30T18:30:00Z",
    "updatedAt": "2026-03-30T18:30:00Z"
  }
}
```

Error de elegibilidad tipico:

```json
{
  "success": false,
  "message": "Solo puedes calificar productos que ya fueron entregados"
}
```

Recomendacion de UI:

- usa `ratingEligibility.canRate` del `GET /api/productos/:id` para decidir si muestras el widget de estrellas habilitado
- si `myRating` existe, inicializa el control con esa calificacion
- despues de guardar, vuelve a consultar `GET /api/productos/:id` para refrescar `ratingSummary` y `myRating`

## 5. Errores de validacion

Cuando falla validacion de `body`, `params` o `query`, el backend responde con este formato:

```json
{
  "success": false,
  "message": "Validacion fallida",
  "errors": [
    {
      "campo": "score",
      "mensaje": "La calificacion maxima es 5",
      "codigo": "too_big"
    }
  ]
}
```

Tambien existen endpoints que devuelven errores con esta forma:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Producto con ID prod_12345 no encontrado"
  }
}
```

En frontend conviene leer ambos formatos:

```ts
export function getApiErrorMessage(errorBody: any) {
  return (
    errorBody?.message ||
    errorBody?.error?.message ||
    "Ocurrio un error inesperado"
  );
}
```

## 6. Flujo recomendado en pantalla de producto

Orden sugerido:

1. Cargar `GET /api/productos/:id`.
2. Cargar `GET /api/productos/:id/detalles`.
3. Si el usuario esta autenticado, repetir `GET /api/productos/:id` con JWT del backend para obtener `isFavorito`, `ratingEligibility` y `myRating`.
4. Al tocar favorito, usar `POST /api/favoritos` o `DELETE /api/favoritos/:productoId`.
5. Al enviar puntuacion, usar `POST /api/productos/:id/calificacion`.
6. Despues de mutaciones, refrescar el detalle del producto para mantener consistente `ratingSummary`, `myRating` e `isFavorito`.

## 7. Resumen rapido de endpoints

Publicos:

- `GET /api/productos/:id`
- `GET /api/productos/:productoId/detalles`
- `GET /api/productos/:productoId/detalles/:detalleId`

Protegidos con JWT del backend:

- `GET /api/favoritos`
- `GET /api/favoritos/check/:productoId`
- `POST /api/favoritos`
- `DELETE /api/favoritos/:productoId`
- `POST /api/productos/:id/calificacion`
