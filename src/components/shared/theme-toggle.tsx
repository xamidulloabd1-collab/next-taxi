"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  return (
    <Button
      variant="outline"
      block
      className="justify-between"
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("nt-theme", next ? "dark" : "light");
        } catch {
          /* ignore */
        }
      }}
    >
      <span>{dark ? "Tungi rejim" : "Kunduzgi rejim"}</span>
      {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </Button>
  );
}
