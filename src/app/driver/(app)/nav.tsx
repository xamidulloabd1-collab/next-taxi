"use client";
import { CircleUser, Clock3, LifeBuoy, Wallet, Steering } from "./icons";
import { BottomNav } from "@/components/layout/bottom-nav";

export function DriverNav() {
  return (
    <BottomNav
      items={[
        { href: "/driver", label: "Ish", icon: Steering, exact: true },
        { href: "/driver/earnings", label: "Daromad", icon: Wallet },
        { href: "/driver/history", label: "Safarlar", icon: Clock3 },
        { href: "/driver/support", label: "Yordam", icon: LifeBuoy },
        { href: "/driver/profile", label: "Profil", icon: CircleUser },
      ]}
    />
  );
}
