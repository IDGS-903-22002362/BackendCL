# Integración Frontend: Recoger en Tienda Física (PICKUP)

Este documento describe los cambios que el frontend debe implementar para soportar `PICKUP` como alternativa a `DELIVERY` sin romper el flujo actual de envío a domicilio, Stripe, Aplazo, carrito y órdenes.

## Resumen

El backend ahora soporta dos métodos de fulfillment:

- `DELIVERY`: flujo actual de envío a domicilio.
- `PICKUP`: compra en línea y recolección en una sucursal física.

Para órdenes existentes o payloads que no envían `fulfillmentMethod`, el backend asume `DELIVERY`.

## Rutas Nuevas

Base local:

```txt
http://localhost:3000/api
```

Producción:

```txt
https://us-central1-e-comerce-leon.cloudfunctions.net/api/api
```

### Sucursales públicas

Listar sucursales activas con pickup habilitado:

```http
GET /api/pickup-locations
```

Respuesta:

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": "loc_123",
      "name": "Tienda Estadio León",
      "address": "Blvd. Adolfo López Mateos 1810",
      "city": "León",
      "state": "Guanajuato",
      "postalCode": "37500",
      "country": "MX",
      "phone": "4771234567",
      "active": true,
      "pickupEnabled": true,
      "pickupInstructions": "Presenta tu código en mostrador.",
      "estimatedPreparationMinutes": 120
    }
  ]
}
```

Obtener detalle:

```http
GET /api/pickup-locations/{id}
```

### Validar disponibilidad pickup

Antes de permitir checkout con pickup, validar el carrito contra la sucursal seleccionada:

```http
POST /api/pickup-locations/{id}/availability
Content-Type: application/json
```

Body:

```json
{
  "cartId": "cart_abc123"
}
```

Respuesta:

```json
{
  "success": true,
  "data": {
    "canPickup": true,
    "pickupLocationId": "loc_123",
    "inventoryScope": "global",
    "availableItems": [
      {
        "productoId": "prod_1",
        "tallaId": "m",
        "requestedQuantity": 1,
        "availableQuantity": 4,
        "available": true
      }
    ],
    "unavailableItems": []
  }
}
```

Nota: `inventoryScope` actualmente es `"global"` porque el backend todavía no maneja inventario por sucursal.

## Checkout

La ruta existente sigue siendo:

```http
POST /api/carrito/checkout
Authorization: Bearer {token}
Content-Type: application/json
```

### Checkout DELIVERY

El flujo actual se mantiene. El frontend puede seguir enviando el payload existente. Recomendado enviar `fulfillmentMethod: "DELIVERY"` explícitamente para claridad.

```json
{
  "fulfillmentMethod": "DELIVERY",
  "direccionEnvio": {
    "nombre": "Juan Pérez",
    "telefono": "4771234567",
    "calle": "Blvd. Adolfo López Mateos",
    "numero": "1234",
    "numeroInterior": "4B",
    "colonia": "Centro",
    "ciudad": "León",
    "estado": "Guanajuato",
    "codigoPostal": "37000",
    "referencias": "Frente al Estadio León"
  },
  "metodoPago": "TARJETA",
  "costoEnvio": 99,
  "notas": "Entregar en horario de oficina"
}
```

Reglas frontend para `DELIVERY`:

- Mostrar y exigir dirección de envío.
- Mostrar costo de envío si aplica.
- Continuar con Stripe/Aplazo como hasta ahora.

### Checkout PICKUP

Para recoger en tienda:

```json
{
  "fulfillmentMethod": "PICKUP",
  "pickupLocationId": "loc_123",
  "pickupContact": {
    "name": "Juan Pérez",
    "phone": "4771234567",
    "email": "juan@example.com"
  },
  "metodoPago": "TARJETA",
  "notas": "Recoge mi hermano"
}
```

Reglas frontend para `PICKUP`:

- No pedir dirección de envío.
- No cobrar ni enviar `costoEnvio` positivo.
- Exigir una sucursal seleccionada.
- Exigir nombre de contacto.
- Teléfono y correo son opcionales para backend, pero recomendados para operación.
- Validar disponibilidad antes de crear la orden.
- Después de crear la orden, iniciar el pago con Stripe o Aplazo usando las rutas actuales.

Errores esperados:

```json
{
  "success": false,
  "message": "Validación fallida",
  "errors": [
    {
      "campo": "pickupLocationId",
      "mensaje": "La sucursal de pickup es requerida para PICKUP",
      "codigo": "custom"
    }
  ]
}
```

## Pagos

No cambia la integración principal de Stripe ni Aplazo.

Después de crear una orden `PICKUP`:

- Si `metodoPago` es `TARJETA`, usar el flujo actual de Stripe.
- Si `metodoPago` es `APLAZO`, usar el flujo actual de Aplazo.

Cuando el webhook confirme el pago, el backend:

- Cambia la orden a pagada.
- Genera código de recolección si aún no existe.
- Guarda `pickupCodeLast4`, `pickupQrPayload`, `pickupExpiresAt`.
- Deja la orden lista para operación staff.

Importante: el backend no devuelve el código completo en listados normales. El frontend cliente debe mostrar los datos que vengan en el detalle de la orden, especialmente:

- `fulfillmentMethod`
- `fulfillmentStatus`
- `pickupLocation`
- `pickupInstructions`
- `pickupCodeLast4`
- `pickupQrPayload`
- `readyForPickupAt`
- `pickupExpiresAt`

## Estados Para UI

Campos principales:

```ts
type FulfillmentMethod = "DELIVERY" | "PICKUP";

type FulfillmentStatus =
  | "PENDING_PAYMENT"
  | "PAID"
  | "PREPARING"
  | "READY_FOR_PICKUP"
  | "PICKED_UP"
  | "EXPIRED"
  | "CANCELED";
```

Sugerencia de textos:

| Estado | Texto cliente |
| --- | --- |
| `PENDING_PAYMENT` | Pendiente de pago |
| `PAID` | Pago confirmado |
| `PREPARING` | Estamos preparando tu pedido |
| `READY_FOR_PICKUP` | Listo para recoger |
| `PICKED_UP` | Pedido recogido |
| `EXPIRED` | Recolección expirada |
| `CANCELED` | Pedido cancelado |

Para `DELIVERY`, conservar la UI basada en `estado`, guía, transportista y tracking.

Para `PICKUP`, priorizar `fulfillmentStatus` y no mostrar componentes de paquetería.

## UI Requerida

### Checkout

Agregar selector de método de entrega:

- Envío a domicilio.
- Recoger en tienda.

Si el usuario elige `Recoger en tienda`:

1. Cargar `GET /api/pickup-locations`.
2. Mostrar sucursales disponibles.
3. Permitir seleccionar una.
4. Mostrar dirección, horarios/instrucciones y tiempo estimado.
5. Solicitar contacto de recolección.
6. Validar disponibilidad con `POST /api/pickup-locations/{id}/availability`.
7. Crear checkout con `fulfillmentMethod: "PICKUP"`.

### Detalle de orden cliente

Si `fulfillmentMethod === "PICKUP"`:

- Mostrar sucursal de recolección.
- Mostrar instrucciones.
- Mostrar estado pickup.
- Mostrar fecha de expiración si existe.
- Mostrar QR si `pickupQrPayload` existe.
- Mostrar últimos 4 caracteres del código (`pickupCodeLast4`) como referencia.
- No mostrar guía, transportista ni costo de envío.

### Admin/staff

Endpoints protegidos:

```http
GET /api/admin/pickup-orders
GET /api/admin/pickup-orders/{id}
POST /api/admin/pickup-orders/{id}/prepare
POST /api/admin/pickup-orders/{id}/ready
POST /api/admin/pickup-orders/{id}/verify-code
POST /api/admin/pickup-orders/{id}/complete
POST /api/admin/pickup-orders/{id}/expire
```

Verificar código:

```json
{
  "code": "ABCD-1234",
  "pickupLocationId": "loc_123"
}
```

Completar entrega:

```json
{
  "code": "ABCD-1234",
  "pickupLocationId": "loc_123",
  "pickedUpBy": "Juan Pérez"
}
```

## Checklist Frontend

- [ ] Agregar selector `DELIVERY` / `PICKUP` en checkout.
- [ ] Cargar sucursales públicas.
- [ ] Validar disponibilidad pickup antes de checkout.
- [ ] No pedir dirección ni cobrar envío en `PICKUP`.
- [ ] Enviar `pickupLocationId` y `pickupContact`.
- [ ] Mantener flujo Stripe/Aplazo existente.
- [ ] Actualizar detalle de orden para mostrar datos pickup.
- [ ] Ocultar guía/tracking en órdenes `PICKUP`.
- [ ] Agregar vistas staff/admin para preparar, marcar listo, verificar código y entregar.
- [ ] Manejar errores de sucursal inactiva, pickup deshabilitado y carrito sin stock.

## Pruebas Manuales Recomendadas

1. Crear una sucursal pickup desde admin.
2. Listar sucursales en checkout.
3. Seleccionar pickup y validar disponibilidad del carrito.
4. Crear orden `PICKUP`.
5. Confirmar que `total` no incluye envío.
6. Pagar con Stripe.
7. Verificar que la orden tenga `fulfillmentStatus: "PAID"`.
8. Staff marca `PREPARING`.
9. Staff marca `READY_FOR_PICKUP`.
10. Verificar código correcto e incorrecto.
11. Completar entrega.
12. Confirmar que no se puede completar dos veces.
13. Crear checkout `DELIVERY` y confirmar que sigue funcionando igual.

