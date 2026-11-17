import { z } from "zod";
import { route, json, parseJson } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { uuidSchema } from "@/lib/validation";
import { addUserMessage, createTicket, listUserTickets, reportIncident } from "@/features/support/service";

type EndUserApp = "passenger" | "driver";

const ticketSchema = z.object({
  category: z.enum(["RIDE", "PAYMENT", "ACCOUNT", "DRIVER_APPLICATION", "SAFETY", "OTHER"]),
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(5).max(2000),
  rideId: z.string().uuid().nullish(),
});

/** Shared support handlers for the passenger and driver apps (same logic, different session). */
export function makeTicketHandlers(app: EndUserApp) {
  return {
    GET: route(async () => {
      const ctx = await requireAuth(app);
      return json({ tickets: await listUserTickets(ctx.userId, app) });
    }),
    POST: route(async (req) => {
      const ctx = await requireAuth(app);
      const body = await parseJson(req, ticketSchema);
      const t = await createTicket(ctx.userId, app, body);
      return json({ ticket: { id: t.id, status: t.status } }, { status: 201 });
    }),
  };
}

export function makeTicketMessageHandler(app: EndUserApp) {
  return route<{ id: string }>(async (req, { params }) => {
    const ctx = await requireAuth(app);
    const id = uuidSchema.parse((await params).id);
    const body = await parseJson(req, z.object({ body: z.string().trim().min(1).max(2000) }));
    await addUserMessage(ctx.userId, id, body.body);
    return json({ ok: true }, { status: 201 });
  });
}

export function makeIncidentHandler(app: EndUserApp) {
  return route(async (req) => {
    const ctx = await requireAuth(app);
    const body = await parseJson(
      req,
      z.object({
        rideId: z.string().uuid().nullish(),
        description: z.string().trim().min(3).max(2000),
        severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
        lat: z.number().min(-90).max(90).nullish(),
        lng: z.number().min(-180).max(180).nullish(),
      }),
    );
    const incident = await reportIncident(ctx.userId, app === "passenger" ? "PASSENGER" : "DRIVER", body);
    return json({ incident: { id: incident.id, status: incident.status } }, { status: 201 });
  });
}
