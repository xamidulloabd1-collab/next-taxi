import type { IncidentSeverity, TicketCategory, TicketStatus } from "@prisma/client";
import { db } from "@/lib/db/prisma";
import { Errors } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { publish, STAFF_AUDIENCE } from "@/lib/realtime/events";
import type { AppKind } from "@/lib/auth/session";

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  RIDE: "Safar",
  PAYMENT: "To‘lov",
  ACCOUNT: "Hisob",
  DRIVER_APPLICATION: "Haydovchi arizasi",
  SAFETY: "Xavfsizlik",
  OTHER: "Boshqa",
};
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: "Ochiq",
  IN_PROGRESS: "Ko‘rib chiqilmoqda",
  RESOLVED: "Hal qilindi",
  CLOSED: "Yopildi",
};

async function assertRideParticipant(userId: string, rideId: string) {
  const ride = await db().ride.findUnique({ where: { id: rideId }, select: { passengerId: true, driverId: true } });
  if (!ride || (ride.passengerId !== userId && ride.driverId !== userId)) throw Errors.notFound("Buyurtma");
}

export async function createTicket(userId: string, app: Exclude<AppKind, "admin">, input: { category: TicketCategory; subject: string; message: string; rideId?: string | null }) {
  await enforceRateLimit(`ticket:${userId}`, 10, 3600);
  if (input.rideId) await assertRideParticipant(userId, input.rideId);
  const ticket = await db().supportTicket.create({
    data: {
      userId,
      app,
      category: input.category,
      subject: input.subject.trim(),
      rideId: input.rideId ?? null,
      messages: { create: { authorId: userId, body: input.message.trim() } },
    },
  });
  await publish(db(), { type: "support.updated", audience: [STAFF_AUDIENCE], data: { ticketId: ticket.id } });
  return ticket;
}

export async function listUserTickets(userId: string, app: Exclude<AppKind, "admin">) {
  return db().supportTicket.findMany({
    where: { userId, app },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: { messages: { orderBy: { createdAt: "asc" }, select: { id: true, body: true, isStaff: true, createdAt: true } } },
  });
}

export async function addUserMessage(userId: string, ticketId: string, body: string) {
  await enforceRateLimit(`ticket-msg:${userId}`, 30, 3600);
  const ticket = await db().supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket || ticket.userId !== userId) throw Errors.notFound("Murojaat");
  if (ticket.status === "CLOSED") throw Errors.conflict("TICKET_CLOSED", "Murojaat yopilgan. Yangi murojaat yarating.");
  await db().$transaction([
    db().ticketMessage.create({ data: { ticketId, authorId: userId, body: body.trim() } }),
    db().supportTicket.update({ where: { id: ticketId }, data: { status: ticket.status === "RESOLVED" ? "OPEN" : ticket.status } }),
  ]);
  await publish(db(), { type: "support.updated", audience: [STAFF_AUDIENCE], data: { ticketId } });
}

export async function staffReply(staffId: string, ticketId: string, body: string, status?: TicketStatus) {
  const ticket = await db().supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw Errors.notFound("Murojaat");
  await db().$transaction([
    db().ticketMessage.create({ data: { ticketId, authorId: staffId, body: body.trim(), isStaff: true } }),
    db().supportTicket.update({ where: { id: ticketId }, data: { status: status ?? (ticket.status === "OPEN" ? "IN_PROGRESS" : ticket.status), assignedToId: ticket.assignedToId ?? staffId } }),
  ]);
  await publish(db(), { type: "support.updated", audience: [ticket.userId, STAFF_AUDIENCE], data: { ticketId } });
  return { before: ticket };
}

/** SOS / safety report from an active or past ride. Immediately visible to staff. */
export async function reportIncident(
  userId: string,
  role: "PASSENGER" | "DRIVER",
  input: { rideId?: string | null; description: string; severity?: IncidentSeverity; lat?: number | null; lng?: number | null },
) {
  await enforceRateLimit(`incident:${userId}`, 10, 3600);
  if (input.rideId) await assertRideParticipant(userId, input.rideId);
  const incident = await db().safetyIncident.create({
    data: {
      rideId: input.rideId ?? null,
      reportedById: userId,
      reporterRole: role,
      severity: input.severity ?? "HIGH",
      description: input.description.trim(),
      lat: input.lat ?? null,
      lng: input.lng ?? null,
    },
  });
  await publish(db(), { type: "incident.created", audience: [STAFF_AUDIENCE], rideId: input.rideId ?? undefined, data: { incidentId: incident.id, severity: incident.severity } });
  return incident;
}
