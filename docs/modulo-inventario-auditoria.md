# Auditoría módulo inventario — 2026-06-22

## Hallazgos críticos (pre-refactor)

| Riesgo | Severidad | Detalle |
|--------|-----------|---------|
| Sin reserva en checkout | Alta | Entre crear orden y pagar, otro cliente podía agotar stock |
| decrementStock / incrementStock legacy | Media | Escritura directa sin auditoría; no usados en flujos activos |
| Empleados podían registrar venta manual | Media | Bypass de control de ventas |
| existencias = stock vendible | Info | Sin separar físico / reservado / no disponible |

## Escrituras de stock

- Central: InventoryService → ProductService.updateStock → movimientosInventario
- Pago confirmado: commitStockForOrder → venta
- Legacy muerto: decrementStock, incrementStock

## Cambios implementados

1. Modelo progresivo con reservas checkout
2. Colección reservasInventario
3. Reserva al iniciar pago Stripe/Aplazo
4. Cron expiración cada 5 min
5. Permisos empleado vs admin
6. Dashboard y diagnóstico admin
7. Migración migrate-inventory-v2.ts

## Pendiente

- Export CSV inventario

## Completado (2026-06-22)

- Devoluciones formales documentadas (contacto tienda; sin flujo en plataforma)
- Recepciones de mercancía (`recepcionesMercancia`, APIs admin, UI `/admin/inventario/recepciones`)
- Índices Firestore `reservasInventario`
- Tests concurrentes reservas + webhook duplicado

## Env

- INVENTORY_RESERVATION_TTL_MINUTES (default 30)
- INVENTORY_EMPLOYEE_ADJUSTMENT_LIMIT (default 5)
