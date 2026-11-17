import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { DriverNav } from "./nav";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuth("driver");
  if (!ctx || !ctx.roles.includes("DRIVER")) redirect("/driver/login");
  return (
    <>
      {children}
      <DriverNav />
    </>
  );
}
