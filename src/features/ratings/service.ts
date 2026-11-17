import { withTransaction, isUniqueViolation } from "@/lib/db/prisma";
import { Errors } from "@/lib/errors";

/** Passenger rates driver or driver rates passenger, once per ride, after completion. */
export async function rateRide(raterId: string, raterRole: "PASSENGER" | "DRIVER", rideId: string, score: number, comment?: string | null) {
  if (!Number.isInteger(score) || score < 1 || score > 5) throw Errors.badRequest("INVALID_SCORE", "Baho 1 dan 5 gacha bo‘lishi kerak.");
  try {
    return await withTransaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw Errors.notFound("Buyurtma");
      const isPassenger = raterRole === "PASSENGER" && ride.passengerId === raterId;
      const isDriver = raterRole === "DRIVER" && ride.driverId === raterId;
      if (!isPassenger && !isDriver) throw Errors.notFound("Buyurtma");
      if (ride.status !== "COMPLETED" && ride.status !== "SETTLED") throw Errors.conflict("NOT_COMPLETED", "Faqat yakunlangan safarni baholash mumkin.");
      const rateeId = isPassenger ? ride.driverId! : ride.passengerId;
      const rating = await tx.rating.create({ data: { rideId, raterId, rateeId, raterRole, score, comment: comment?.trim().slice(0, 500) || null } });
      if (isPassenger) {
        await tx.driverProfile.update({ where: { userId: rateeId }, data: { ratingSum: { increment: score }, ratingCount: { increment: 1 } } });
      } else {
        await tx.passengerProfile.update({ where: { userId: rateeId }, data: { ratingSum: { increment: score }, ratingCount: { increment: 1 } } });
      }
      return rating;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw Errors.conflict("ALREADY_RATED", "Siz bu safarni allaqachon baholagansiz.");
    throw err;
  }
}
