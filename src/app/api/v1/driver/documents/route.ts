import { z } from "zod";
import { route, json } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { Errors } from "@/lib/errors";
import { MAX_DOCUMENT_BYTES, uploadDriverDocument } from "@/features/drivers/service";

export const runtime = "nodejs";

const typeSchema = z.enum(["DRIVER_LICENSE", "PASSPORT_ID", "VEHICLE_REGISTRATION", "INSURANCE", "VEHICLE_PHOTO", "SELFIE", "TAXI_LICENSE", "SELF_EMPLOYED_CERT"]);

/** multipart/form-data: `type` + `file`. Stored privately; the real file type is sniffed server-side. */
export const POST = route(async (req) => {
  const ctx = await requireAuth("driver");
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_DOCUMENT_BYTES + 64 * 1024) throw Errors.badRequest("FILE_TOO_LARGE", "Fayl hajmi 6 MB dan oshmasligi kerak.");
  const form = await req.formData();
  const type = typeSchema.parse(form.get("type"));
  const file = form.get("file");
  if (!(file instanceof Blob)) throw Errors.badRequest("FILE_REQUIRED", "Faylni tanlang.");
  const doc = await uploadDriverDocument(ctx.userId, type, new Uint8Array(await file.arrayBuffer()));
  return json({ document: { id: doc.id, type: doc.type, status: doc.status } }, { status: 201 });
});
