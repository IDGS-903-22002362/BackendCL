# Guia frontend: inventario por talla (endpoints nuevos y modificados)

Ultima actualizacion: 2026-03-09

## 1) Regla central (fuente de verdad)

La aplicacion decide si un producto maneja inventario por talla con esta regla:

- `tallaIds.length > 0` -> inventario por talla obligatorio.
- `tallaIds.length === 0` -> inventario global (sin talla).

Efectos:

- Si un producto tiene `tallaIds` y no mandas `inventarioPorTalla`, el backend completa todas las tallas con `0`.
- Si mandas una talla fuera de `tallaIds`, responde `400`.
- Si el producto no usa tallas y mandas `tallaId`, responde `400`.

## 2) Matriz rapida de autenticacion

- `GET /api/productos/:id/stock` -> Publico
- `PUT /api/productos/:id/stock` -> Bearer (admin/empleado)
- `PUT /api/productos/:id/inventario-tallas` -> Bearer (admin/empleado)
- `GET /api/tallas/:id/inventario` -> Publico
- `DELETE /api/tallas/:id` -> Sin auth en ruta (actualmente), pero ahora puede regresar `409`

## 3) Endpoints nuevos/modificados

### 3.1 GET `/api/productos/:id/stock` (modificado)

Devuelve stock normalizado.

Ejemplo de respuesta (`200`):

```json
{
  "success": true,
  "data": {
    "productoId": "prod_12345",
    "tallaIds": ["s", "m", "l", "xl"],
    "existencias": 15,
    "inventarioPorTalla": [
      { "tallaId": "s", "cantidad": 3 },
      { "tallaId": "m", "cantidad": 12 },
      { "tallaId": "l", "cantidad": 0 },
      { "tallaId": "xl", "cantidad": 0 }
    ]
  }
}
```

Notas frontend:

- En producto sin tallas: `tallaIds: []`, `inventarioPorTalla: []`, `existencias` global.
- En producto con tallas: `existencias` siempre es la suma de `inventarioPorTalla`.

---

### 3.2 PUT `/api/productos/:id/stock` (modificado)

Actualiza stock puntual (global o por una talla).

Body:

```json
{
  "cantidadNueva": 15,
  "tallaId": "m",
  "tipo": "ajuste",
  "motivo": "Conteo fisico",
  "referencia": "INV-2026-001"
}
```

Reglas:

- `cantidadNueva` entero `>= 0`.
- Si el producto tiene `tallaIds`, `tallaId` es obligatorio.
- Si el producto no tiene tallas, no enviar `tallaId`.

Respuesta (`200`):

```json
{
  "success": true,
  "message": "Stock actualizado exitosamente",
  "data": {
    "productoId": "prod_12345",
    "tallaId": "m",
    "cantidadAnterior": 8,
    "cantidadNueva": 15,
    "diferencia": 7,
    "existencias": 20,
    "inventarioPorTalla": [
      { "tallaId": "s", "cantidad": 3 },
      { "tallaId": "m", "cantidad": 15 },
      { "tallaId": "l", "cantidad": 2 }
    ],
    "stockMinimoGlobal": 5,
    "stockMinimoPorTalla": [],
    "alertaStockBajo": {
      "activo": false,
      "totalAlertas": 0,
      "maxDeficit": 0
    },
    "movimientoId": "mov_abc123",
    "createdAt": "2026-03-09T12:00:00.000Z"
  }
}
```

Errores comunes (`400`):

- `Se requiere tallaId para actualizar stock por talla en este producto`
- `La talla "xxl" no pertenece al producto prod_12345`
- `Este producto no maneja inventario por talla; actualiza stock general sin tallaId`

---

### 3.3 PUT `/api/productos/:id/inventario-tallas` (nuevo)

Reemplazo total del inventario por talla.

Body:

```json
{
  "inventarioPorTalla": [
    { "tallaId": "s", "cantidad": 3 },
    { "tallaId": "m", "cantidad": 12 }
  ],
  "motivo": "Conteo fisico por tallas",
  "referencia": "INV-2026-150"
}
```

Semantica:

- Es reemplazo completo.
- Tallas omitidas se guardan con `0`.
- Registra movimientos de ajuste por cada talla que cambio.

Respuesta (`200`):

```json
{
  "success": true,
  "message": "Inventario por talla actualizado exitosamente",
  "data": {
    "productoId": "prod_12345",
    "tallaIds": ["s", "m", "l", "xl"],
    "inventarioPorTalla": [
      { "tallaId": "s", "cantidad": 3 },
      { "tallaId": "m", "cantidad": 12 },
      { "tallaId": "l", "cantidad": 0 },
      { "tallaId": "xl", "cantidad": 0 }
    ],
    "existencias": 15,
    "cambios": [
      {
        "tallaId": "m",
        "cantidadAnterior": 7,
        "cantidadNueva": 12,
        "diferencia": 5,
        "movimientoId": "mov_001"
      },
      {
        "tallaId": "l",
        "cantidadAnterior": 4,
        "cantidadNueva": 0,
        "diferencia": -4,
        "movimientoId": "mov_002"
      }
    ]
  }
}
```

Errores comunes (`400`):

- `Este producto no maneja inventario por talla; no se puede usar inventario-tallas`
- `La talla "xxl" no pertenece al producto y no puede usarse en inventarioPorTalla`

---

### 3.4 GET `/api/tallas/:id/inventario` (nuevo)

Consulta inventario agregado para una talla.

Respuesta (`200`):

```json
{
  "success": true,
  "count": 2,
  "data": {
    "talla": {
      "id": "m",
      "codigo": "M",
      "descripcion": "Mediana",
      "orden": 2
    },
    "resumen": {
      "totalProductos": 2,
      "totalUnidades": 18
    },
    "productos": [
      {
        "productoId": "prod_jersey_001",
        "clave": "JER-001",
        "descripcion": "Jersey Local",
        "cantidad": 12,
        "existencias": 20
      },
      {
        "productoId": "prod_jersey_002",
        "clave": "JER-002",
        "descripcion": "Jersey Visitante",
        "cantidad": 6,
        "existencias": 12
      }
    ]
  }
}
```

Error `404` si la talla no existe.

---

### 3.5 DELETE `/api/tallas/:id` (modificado)

Ahora bloquea eliminacion cuando la talla esta en uso.

Nuevo caso:

- `409 Conflict`:
  - `No se puede eliminar la talla "m" porque esta en uso por 3 producto(s)`

## 4) Endpoints existentes con comportamiento afectado

Estos endpoints no son nuevos, pero ahora dependen de la misma regla (`tallaIds.length > 0`):

- `POST /api/productos` y `PUT /api/productos/:id`
  - Si hay `tallaIds`, el backend normaliza/completa `inventarioPorTalla`.
  - Si mandas tallas fuera de `tallaIds`, responde `400`.
  - Si no hay tallas y mandas `inventarioPorTalla`, responde `400`.

- `POST /api/carrito/items`
  - Si el producto tiene tallas, `tallaId` es obligatorio.
  - Si no tiene tallas, enviar `tallaId` provoca error.

- `POST /api/carrito/checkout` y `POST /api/ordenes`
  - La validacion de stock se hace por variante (`productoId + tallaId`) cuando aplica.
  - Ya no pasa una orden solo porque `existencias` global alcance.

- `POST /api/inventario/movimientos` y `POST /api/inventario/ajustes`
  - Si el producto usa tallas, `tallaId` obligatorio.
  - Si no usa tallas, `tallaId` no permitido.

## 5) Checklist frontend (recomendado)

1. Guardar y manejar variantes de carrito por clave `productoId + tallaId`.
2. Para productos con tallas, no permitir agregar al carrito sin seleccionar talla.
3. Al editar inventario por tallas en admin, usar `PUT /api/productos/:id/inventario-tallas` para cambios masivos.
4. Manejar explicitamente errores `400` de negocio y `409` en eliminar talla.
5. No confiar en `existencias` global para checkout de productos con talla; usar seleccion de talla siempre.

## 6) Ejemplos rapidos (frontend)

### Actualizar inventario masivo por talla

```ts
await fetch(`/api/productos/${productoId}/inventario-tallas`, {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify({
    inventarioPorTalla: [
      { tallaId: "s", cantidad: 30 },
      { tallaId: "m", cantidad: 3 }
    ],
    motivo: "Ajuste mensual",
    referencia: "INV-2026-200"
  })
});
```

### Obtener panel por talla

```ts
const res = await fetch(`/api/tallas/m/inventario`);
const json = await res.json();
// json.data.resumen.totalUnidades
// json.data.productos[]
```
