import { z } from "zod";
import { FulfillmentStatus } from "../../models/orden.model";

const businessHoursSchema = z.record(z.unknown()).optional();

export const createPickupLocationSchema = z
  .object({
    name: z.string().trim().min(1, "El nombre es requerido").max(120),
    address: z.string().trim().min(1, "La dirección es requerida").max(250),
    city: z.string().trim().min(1, "La ciudad es requerida").max(100),
    state: z.string().trim().min(1, "El estado es requerido").max(100),
    postalCode: z.string().trim().min(1, "El código postal es requerido").max(20),
    country: z.string().trim().min(1, "El país es requerido").max(80),
    phone: z.string().trim().max(30).optional(),
    active: z.boolean({ required_error: "active es requerido" }),
    pickupEnabled: z.boolean({ required_error: "pickupEnabled es requerido" }),
    pickupInstructions: z.string().trim().max(1000).optional(),
    businessHours: businessHoursSchema,
    preparationCutoffTime: z.string().trim().max(20).optional(),
    estimatedPreparationMinutes: z.number().int().nonnegative().optional(),
  })
  .strict();

export const updatePickupLocationSchema = createPickupLocationSchema.partial().strict();

export const pickupLocationIdParamSchema = z.object({
  id: z.string().trim().min(1, "El ID de sucursal es requerido").max(160),
});

export const pickupAvailabilitySchema = z
  .object({
    cartId: z.string().trim().min(1, "cartId es requerido").max(160),
  })
  .strict();

export const pickupOrdersQuerySchema = z.object({
  status: z.nativeEnum(FulfillmentStatus).optional(),
  locationId: z.string().trim().optional(),
  fechaDesde: z.string().datetime().optional(),
  fechaHasta: z.string().datetime().optional(),
});

export const verifyPickupCodeSchema = z
  .object({
    code: z.string().trim().min(4, "El código es requerido").max(64),
    pickupLocationId: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export const completePickupSchema = verifyPickupCodeSchema
  .extend({
    pickedUpBy: z.string().trim().max(160).optional(),
  })
  .strict();
