"use client";
import { CircleUser, Clock3, LifeBuoy, MapPinned } from "lucide-react";
import { BottomNav } from "@/components/layout/bottom-nav";

export function PassengerNav() {
  return (
    <BottomNav
      items={[
        { href: "/passenger", label: "Taksi", icon: MapPinned, exact: true },
        { href: "/passenger/history", label: "Safarlar", icon: Clock3 },
        { href: "/passenger/support", label: "Yordam", icon: LifeBuoy },
        { href: "/passenger/profile", label: "Profil", icon: CircleUser },
      ]}
    />
  );
}
