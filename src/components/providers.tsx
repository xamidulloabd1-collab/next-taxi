"use client";

import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useToasts } from "@/lib/client/toast";
import { ApiError } from "@/lib/client/api";
import { cn } from "@/components/ui";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: true,
            retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
      }),
  );
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}

function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? AlertCircle : Info;
        return (
          <div
            key={t.id}
            className={cn(
              "nt-rise pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border bg-surface px-3.5 py-3 text-sm shadow-lg shadow-black/5",
              t.tone === "error" ? "border-danger/30" : "border-border",
            )}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", t.tone === "success" ? "text-accent" : t.tone === "error" ? "text-danger" : "text-muted")} />
            <p className="flex-1 text-fg">{t.text}</p>
            <button onClick={() => dismiss(t.id)} className="text-muted hover:text-fg" aria-label="Yopish">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
