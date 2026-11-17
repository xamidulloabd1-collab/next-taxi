import { z } from "zod";

export const latLngSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

export const placeSchema = latLngSchema.extend({ address: z.string().trim().max(200).nullish() });

export const uuidSchema = z.string().uuid();

export const appSchema = z.enum(["passenger", "driver", "admin"]);

export const phoneInputSchema = z.string().trim().min(9).max(20);

export const reasonSchema = z.string().trim().min(3, "Sababni yozing").max(300);
