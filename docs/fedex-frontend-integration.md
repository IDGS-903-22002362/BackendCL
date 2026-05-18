# Integracion FedEx en Frontend

Guia breve para consumir FedEx desde el frontend considerando el flujo actual de checkout, pagos Stripe/Aplazo, generacion de guia y reembolsos.

## Cambios nuevos: remitente FedEx controlado por backend

El backend ya tiene configurada la direccion origen/remitente de FedEx en secrets desplegados. El frontend no debe pedir, guardar ni enviar datos del remitente para el flujo normal de checkout.

Remitente activo en backend:

| Campo backend | Valor operativo |
| --- | --- |
| Contacto | La Guarida del Leon |
| Empresa | La Guarida del Leon |
| Telefono | 4777112626 |
| Direccion | Blvd. Adolfo Lopez Mateos, La Martinca |
| Ciudad | Leon de los Aldama |
| Estado | Guanajuato |
| CP | 37500 |
| Pais | MX |
| Residencial | false |

Impacto para frontend:

- En checkout, enviar solo la direccion destino del cliente.
- No exponer variables `FEDEX_SHIPPER_*` en `.env` del frontend.
- No agregar campos de origen/remitente en formularios de cliente.
- No mandar `origin` en `POST /api/carrito/shipping/fedex/quotes`.
- No recalcular costo de envio en frontend; usar siempre `options[].amount` devuelto por backend.
- Si existe una pantalla interna de pruebas que llama `POST /api/shipping/fedex/rates`, puede seguir enviando `origin`, pero no debe usarse para checkout real.

### Implementacion frontend recomendada

1. Revisar el formulario de direccion de envio y conservar solo datos del destinatario.
2. Al cotizar carrito, llamar `POST /api/carrito/shipping/fedex/quotes` con `direccionEnvio`.
3. Mostrar las opciones devueltas por backend y guardar `quoteId` mas `optionId`.
4. Al crear la orden, enviar `shippingQuoteId` y `selectedShippingOptionId`.
5. Despues del pago, consultar tracking; no intentar crear guia desde cliente.

Ejemplo de cotizacion desde checkout:

```ts
type DireccionEnvio = {
  calle?: string;
  numeroExterior?: string;
  numeroInterior?: string;
  colonia?: string;
  ciudad?: string;
  estado?: string;
  codigoPostal: string;
  pais?: string;
  telefono?: string;
  nombre?: string;
  referencias?: string;
};

async function cotizarFedExCheckout(
  token: string,
  direccionEnvio: DireccionEnvio,
) {
  const response = await fetch("/api/carrito/shipping/fedex/quotes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ direccionEnvio }),
  });

  if (!response.ok) {
    throw new Error("No fue posible cotizar el envio con FedEx");
  }

  return response.json();
}
```

Ejemplo de checkout con opcion FedEx seleccionada:

```ts
async function crearOrdenDeliveryFedEx(input: {
  token: string;
  direccionEnvio: DireccionEnvio;
  metodoPago: "TARJETA" | "APLAZO";
  quoteId: string;
  optionId: string;
}) {
  const response = await fetch("/api/carrito/checkout", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fulfillmentMethod: "DELIVERY",
      direccionEnvio: input.direccionEnvio,
      metodoPago: input.metodoPago,
      shippingQuoteId: input.quoteId,
      selectedShippingOptionId: input.optionId,
    }),
  });

  if (!response.ok) {
    throw new Error("No fue posible crear la orden con envio FedEx");
  }

  return response.json();
}
```

Checklist de migracion para estos cambios:

- Eliminar cualquier uso frontend de `FEDEX_SHIPPER_NAME`, `FEDEX_SHIPPER_CONTACT_NAME`, `FEDEX_SHIPPER_COMPANY_NAME`, `FEDEX_SHIPPER_PHONE`, `FEDEX_SHIPPER_STREET_1`, `FEDEX_SHIPPER_CITY`, `FEDEX_SHIPPER_STATE_OR_PROVINCE_CODE`, `FEDEX_SHIPPER_POSTAL_CODE`, `FEDEX_SHIPPER_COUNTRY_CODE` y similares.
- Eliminar inputs UI de "direccion origen", "remitente" o "shipper" en checkout cliente.
- Confirmar que el payload de cotizacion de carrito no incluya `origin`, `packages`, `shipper` ni `accountNumber`.
- Confirmar que el payload de checkout no incluya `costoEnvio`.
- En errores `422` o `502`, mostrar reintento o pedir cambiar direccion; no pedir al usuario corregir el remitente.

## Reglas base

- El frontend no debe llamar directo a FedEx. Siempre debe usar el backend.
- Para checkout con envio, usar la cotizacion de carrito, no enviar `costoEnvio` manual.
- La orden debe quedar con `fulfillmentMethod: DELIVERY`, `shipping.provider: FEDEX` y `shipping.status: QUOTE_SELECTED`.
- La confirmacion de pago por Stripe o Aplazo es la fuente que habilita la generacion de guia.
- Si `FEDEX_AUTO_CREATE_LABEL_ON_PAID` esta activo, el backend intenta crear la guia cuando el pago queda confirmado.
- Si el pago se cancela o reembolsa y hay guia FedEx activa, el backend intenta cancelar la guia antes de liberar la orden.
- Si la guia ya esta entregada, el backend no permite cancelar/reembolsar automaticamente esa orden.
- Para pickup en sucursal no se usa FedEx; el flujo debe mandar `fulfillmentMethod: PICKUP`.

## Flujo cliente recomendado

1. Capturar direccion de envio.
2. Validar direccion con FedEx si se quiere normalizar antes de cotizar.
3. Cotizar el carrito con `POST /api/carrito/shipping/fedex/quotes`.
4. Mostrar opciones devueltas por backend.
5. Guardar la opcion elegida por `optionId` o `serviceType`.
6. Crear la orden con `POST /api/carrito/checkout`.
7. Iniciar pago segun metodo elegido.
8. Esperar confirmacion del pago consultando los endpoints actuales de pagos.
9. Consultar tracking de la orden con `GET /api/orders/{orderId}/tracking`.

## APIs publicas o de cliente

| Uso | Endpoint | Auth | Cuando usar |
| --- | --- | --- | --- |
| Validar direccion | `POST /api/shipping/fedex/address/validate` | No obligatoria | Antes de cotizar, para detectar direccion invalida o normalizada. |
| Cotizacion generica FedEx | `POST /api/shipping/fedex/rates` | No obligatoria | Solo para pantallas genericas o pruebas controladas. |
| Cotizacion real del carrito | `POST /api/carrito/shipping/fedex/quotes` | Cliente autenticado | Checkout. Es la ruta que debe usarse para cobrar envio. |
| Crear orden desde carrito | `POST /api/carrito/checkout` | Cliente autenticado | Despues de elegir una cotizacion FedEx. |
| Tracking cliente | `GET /api/orders/{orderId}/tracking` | Cliente autenticado | Pantalla de detalle de compra o seguimiento. |

## Validacion de direccion

Endpoint:

`POST /api/shipping/fedex/address/validate`

Campos de entrada:

| Campo | Regla |
| --- | --- |
| `address.streetLines` | 1 a 3 lineas. |
| `address.city` | Opcional. |
| `address.stateOrProvinceCode` | Opcional. |
| `address.postalCode` | Obligatorio para MX. |
| `address.countryCode` | Codigo de 2 letras. |
| `address.residential` | Opcional. |

Respuesta util:

| Campo | Uso |
| --- | --- |
| `isValid` | Permite bloquear o advertir antes de cotizar. |
| `classification` | Tipo de direccion: residencial, negocio, mixta o desconocida. |
| `addressState` | Nivel de normalizacion. |
| `resolvedAddress` | Direccion normalizada por FedEx. |
| `changes` | Diferencias contra la direccion enviada. |
| `warnings` | Advertencias tecnicas. |
| `customerMessages` | Mensajes que pueden mostrarse al cliente. |

## Cotizacion generica FedEx

Endpoint:

`POST /api/shipping/fedex/rates`

Usarla solo si la pantalla no depende del carrito. Para checkout real, usar `POST /api/carrito/shipping/fedex/quotes`.

Campos de entrada:

| Campo | Regla |
| --- | --- |
| `origin` | Direccion origen FedEx. |
| `destination` | Direccion destino FedEx. |
| `packages` | Al menos un paquete con peso y dimensiones. |
| `shipDate` | `YYYY-MM-DD`; opcional. |
| `currency` | `MXN` por defecto. |
| `rateRequestTypes` | `ACCOUNT` por defecto. |
| `serviceType` | Opcional para filtrar servicio. |

Respuesta util:

| Campo | Uso |
| --- | --- |
| `quoteId` | Identificador de cotizacion generica. |
| `options[]` | Servicios disponibles. |
| `options[].amount` | Costo de envio. |
| `options[].serviceType` | Servicio FedEx. |
| `options[].serviceName` | Nombre visible. |
| `options[].estimatedDeliveryDate` | Fecha estimada si existe. |
| `options[].surcharges` | Cargos incluidos. |

## Cotizacion del carrito

Endpoint principal para checkout:

`POST /api/carrito/shipping/fedex/quotes`

Enviar solo `direccionEnvio`. El backend toma los productos del carrito autenticado, calcula paquetes con peso/dimensiones, cotiza FedEx y guarda una cotizacion temporal.

Respuesta util para frontend:

| Campo | Uso |
| --- | --- |
| `quoteId` | Debe enviarse en checkout como `shippingQuoteId`. |
| `expiresAt` | Si expira, recotizar antes de crear orden. |
| `options[]` | Lista de servicios disponibles. |
| `options[].optionId` | Identificador preferido para seleccionar envio. |
| `options[].serviceType` | Alternativa para seleccionar envio. |
| `options[].serviceName` | Texto visible de servicio. |
| `options[].amount` | Costo final de envio. |
| `options[].currency` | Moneda esperada, normalmente `MXN`. |
| `options[].estimatedDeliveryDate` | Fecha estimada si FedEx la devuelve. |
| `options[].transitTime` | Tiempo de transito si FedEx lo devuelve. |

Errores que el frontend debe manejar:

| Caso | Accion UI |
| --- | --- |
| Carrito vacio | Regresar al carrito. |
| Producto sin peso/dimensiones FedEx | Bloquear checkout con envio y avisar soporte/admin. |
| Cotizacion no disponible | Permitir reintentar o cambiar direccion. |
| Cotizacion expirada | Recotizar. |
| Carrito cambio despues de cotizar | Recotizar antes de checkout. |

## Checkout con FedEx

Endpoint:

`POST /api/carrito/checkout`

Campos relevantes para DELIVERY:

| Campo | Regla |
| --- | --- |
| `fulfillmentMethod` | Debe ser `DELIVERY`. |
| `direccionEnvio` | Obligatoria. |
| `metodoPago` | `TARJETA` para Stripe o `APLAZO` para Aplazo. |
| `shippingQuoteId` | Obligatorio. Usar `quoteId`. |
| `selectedShippingOptionId` | Preferido. Usar `optionId`. |
| `selectedServiceType` | Alternativa si no se usa `optionId`. |
| `costoEnvio` | No enviarlo. El backend lo calcula desde la cotizacion. |

Al crear la orden, el backend guarda el snapshot FedEx en `order.shipping` y recalcula `subtotal`, `impuestos`, `costoEnvio` y `total`.

## Pagos y FedEx

### Stripe

Despues de crear la orden con `metodoPago: TARJETA`, continuar con el flujo Stripe existente.

Cuando el webhook de Stripe confirma el pago:

- La orden pasa a confirmada.
- El costo FedEx ya esta incluido en el total de la orden.
- Stripe Checkout agrega el envio como item de pago cuando existe `costoEnvio`.
- El backend puede generar guia FedEx automaticamente si la orden es DELIVERY y tiene `shipping.provider: FEDEX`.

### Aplazo

Despues de crear la orden con `metodoPago: APLAZO`, iniciar Aplazo con:

`POST /api/payments/aplazo/online/create`

Cuando Aplazo confirma por webhook o reconciliacion:

- La orden pasa a confirmada.
- Aplazo recibe el total con envio incluido.
- El snapshot de precios incluye `shippingMinor`.
- El backend puede generar guia FedEx automaticamente si la orden es DELIVERY y tiene `shipping.provider: FEDEX`.

### Estados esperados

| Momento | Orden | FedEx |
| --- | --- | --- |
| Orden creada antes de pagar | `PENDIENTE` | `QUOTE_SELECTED` |
| Pago confirmado | `CONFIRMADA` | `LABEL_CREATED` si la guia se creo |
| Guia en transito | `CONFIRMADA` o `ENVIADA` | `IN_TRANSIT` |
| Entrega final | `ENTREGADA` | `DELIVERED` |
| Pago fallido/cancelado | `CANCELADA` si aplica | Guia cancelada si existia y era cancelable |

## Tracking cliente

Endpoint:

`GET /api/orders/{orderId}/tracking`

Respuesta util:

| Campo | Uso |
| --- | --- |
| `trackingNumber` | Numero visible de guia. |
| `status` | Estado normalizado. |
| `statusLabel` | Texto listo para UI. |
| `statusDescription` | Descripcion adicional. |
| `estimatedDeliveryDate` | ETA si existe. |
| `deliveredAt` | Fecha de entrega si aplica. |
| `lastLocation` | Ultima ubicacion conocida. |
| `events` | Eventos resumidos para timeline. |
| `warnings` | Mensajes no bloqueantes. |

Estados normalizados:

- `LABEL_CREATED`
- `IN_TRANSIT`
- `OUT_FOR_DELIVERY`
- `DELIVERED`
- `EXCEPTION`
- `UNKNOWN`

## APIs admin FedEx

Todas requieren Bearer token con rol admin/empleado.

| Uso | Endpoint |
| --- | --- |
| Health OAuth FedEx | `GET /api/admin/fedex/auth/health` |
| Health cotizacion | `GET /api/admin/fedex/rates/health` |
| Health direccion | `GET /api/admin/fedex/address/health` |
| Crear guia para orden | `POST /api/admin/orders/{orderId}/fedex/ship` |
| Cancelar guia de orden | `POST /api/admin/orders/{orderId}/fedex/cancel-shipment` |
| Tracking admin de orden | `GET /api/admin/orders/{orderId}/fedex/tracking` |
| Tracking directo por guias | `POST /api/admin/fedex/track` |
| Disponibilidad pickup FedEx | `POST /api/admin/fedex/pickups/availability` |
| Crear pickup FedEx | `POST /api/admin/fedex/pickups` |
| Cancelar pickup FedEx | `POST /api/admin/fedex/pickups/{pickupId}/cancel` |
| Crear etiqueta sandbox | `POST /api/admin/fedex/ship/test-label` |
| Cancelar etiqueta sandbox | `POST /api/admin/fedex/ship/cancel-test` |

## Tracking admin directo

Endpoint:

`POST /api/admin/fedex/track`

Campos:

| Campo | Regla |
| --- | --- |
| `trackingNumbers` | 1 a 30 guias. |
| `includeDetailedScans` | Opcional; usar solo cuando la UI necesite detalle completo. |

La respuesta agrupa resultados por guia en `results`.

## Crear guia admin

Endpoint:

`POST /api/admin/orders/{orderId}/fedex/ship`

Campos opcionales:

| Campo | Regla |
| --- | --- |
| `serviceType` | Si no se manda, backend usa el servicio seleccionado en la cotizacion. |
| `labelImageType` | `PDF` por defecto; tambien soporta `PNG`. |

Respuesta util:

| Campo | Uso |
| --- | --- |
| `trackingNumber` | Guia principal. |
| `serviceType` | Servicio utilizado. |
| `labelUrl` | URL de etiqueta si se genero. |
| `labelStoragePath` | Ruta interna en storage. |
| `alreadyCreated` | Evita duplicar UI si la guia ya existia. |
| `warnings` | Mensajes no bloqueantes. |

## Cancelar guia admin

Endpoint:

`POST /api/admin/orders/{orderId}/fedex/cancel-shipment`

Campos:

| Campo | Regla |
| --- | --- |
| `reason` | Motivo visible/auditable. |
| `forceRefreshTracking` | Usar cuando se necesita validar estado reciente antes de cancelar. |

No permitir en UI cancelar una guia marcada como `DELIVERED`.

## Pickups FedEx admin

Usar pickup FedEx cuando operaciones necesita programar recoleccion de paquetes ya etiquetados.

| Endpoint | Uso |
| --- | --- |
| `POST /api/admin/fedex/pickups/availability` | Verificar ventana disponible. |
| `POST /api/admin/fedex/pickups` | Crear pickup para una o varias ordenes. |
| `POST /api/admin/fedex/pickups/{pickupId}/cancel` | Cancelar pickup programado. |

Campos principales:

| Campo | Regla |
| --- | --- |
| `pickupDate` | Formato `YYYY-MM-DD`. |
| `readyTime` | Formato `HH:mm:ss`. |
| `latestTime` | Debe ser mayor que `readyTime`. |
| `orderIds` | Ordenes con guia FedEx. |
| `carrierCode` | `FDXE` o `FDXG`; opcional en algunos endpoints. |

## Manejo de errores

| HTTP | Significado frontend |
| --- | --- |
| `400` | Datos incompletos o invalidos. |
| `401` | Falta sesion. |
| `403` | Usuario sin permisos. |
| `409` | Cotizacion expirada, carrito cambio, guia no cancelable o conflicto de estado. |
| `422` | FedEx no puede procesar la cotizacion o faltan datos logisticos del producto. |
| `429` | Rate limit; reintentar despues. |
| `502` | FedEx rechazo o no respondio correctamente. |
| `500` | Error interno. |

## Checklist frontend

- Usar `POST /api/carrito/shipping/fedex/quotes` para checkout con envio.
- No enviar `costoEnvio` en checkout DELIVERY.
- Guardar y enviar `quoteId` mas `optionId` o `serviceType`.
- Recotizar si cambia direccion, carrito, cantidades o talla.
- Crear la orden antes de iniciar Stripe o Aplazo.
- No mostrar guia hasta que exista `trackingNumber`.
- Consultar tracking desde `/api/orders/{orderId}/tracking`.
- En admin, permitir crear guia manual si el pago ya esta confirmado y no existe guia.
- En reembolsos/cancelaciones, mostrar conflicto si la guia ya fue entregada.
