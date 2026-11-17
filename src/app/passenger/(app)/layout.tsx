import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { PassengerNav } from "./nav";

export default async function PassengerLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuth("passenger");
  if (!ctx || !ctx.roles.includes("PASSENGER")) redirect("/passenger/login");
  return (
    <>
      {children}
      <PassengerNav />
    </>
  );
}
