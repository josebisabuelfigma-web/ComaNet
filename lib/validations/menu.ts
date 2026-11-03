import { z } from "zod";

export const categorySchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(80),
});

export const productSchema = z.object({
  categoryId: z.string().uuid("Selecciona una categoría"),
  name: z.string().trim().min(1, "El nombre es obligatorio").max(120),
  description: z.string().trim().max(600).optional().or(z.literal("")),
  price: z.coerce.number().min(0, "El precio no puede ser negativo").max(100_000_000),
});

export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_IMAGE_FILE_SIZE_MB = 3;

export const settingsSchema = z.object({
  whatsappNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || (v.length >= 10 && v.length <= 15), {
      message: "El WhatsApp debe incluir el indicativo del país (ej: 573001234567)",
    }),
  deliveryFee: z.coerce.number().min(0).max(10_000_000),
  deliveryMessage: z.string().trim().max(200).optional().or(z.literal("")),
  disposablesFee: z.coerce.number().min(0).max(10_000_000),
  pickupEnabled: z.boolean(),
  opensAt: z.string().regex(/^(\d{2}:\d{2})?$/, "Hora de apertura inválida"),
  closesAt: z.string().regex(/^(\d{2}:\d{2})?$/, "Hora de cierre inválida"),
  openDays: z.array(z.number().int().min(0).max(6)),
  disposablesLabel: z.string().trim().min(1, "Escribe cómo se llama el cargo extra").max(40),
  acceptsCash: z.boolean(),
  acceptsTransfer: z.boolean(),
  transferInstructions: z.string().trim().max(300).optional().or(z.literal("")),
  welcomeMessage: z.string().trim().max(300).optional().or(z.literal("")),
});

export const tableSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(40),
});

export const checkoutSchema = z.object({
  orgId: z.string().uuid(),
  customerName: z.string().trim().min(2, "Escribe tu nombre").max(120),
  customerPhone: z
    .string()
    .trim()
    .min(7, "Escribe un teléfono de contacto")
    .max(30),
  fulfillment: z.enum(["domicilio", "recoger"], { message: "Selecciona domicilio o recoger" }),
  address: z.string().trim().max(250).optional().or(z.literal("")),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
  payment: z.enum(["efectivo", "transferencia"], { message: "Selecciona el medio de pago" }),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(50),
        notes: z.string().trim().max(200).optional(),
      })
    )
    .min(1, "El carrito está vacío")
    .max(60),
});

export const comboSchema = z.object({
  categoryId: z.string().uuid("Falta la categoría de combos"),
  name: z.string().trim().min(1, "El nombre del combo es obligatorio").max(120),
  description: z.string().trim().max(600).optional().or(z.literal("")),
  price: z.coerce.number().min(0, "El precio no puede ser negativo").max(100_000_000),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(20),
      })
    )
    .min(1, "Agrega al menos un producto al combo")
    .max(30),
});

export const businessInfoSchema = z.object({
  legalName: z.string().trim().max(160).optional().or(z.literal("")),
  taxId: z.string().trim().max(40).optional().or(z.literal("")),
  billingAddress: z.string().trim().max(200).optional().or(z.literal("")),
  billingPhone: z.string().trim().max(30).optional().or(z.literal("")),
  ticketFooter: z.string().trim().max(300).optional().or(z.literal("")),
});
