import { cn } from "@/components/ui";

/** Scrollable page above the bottom navigation. */
export function PageShell({ title, children, action, className }: { title: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <main className={cn("mx-auto min-h-dvh w-full max-w-md px-4 pt-6 pb-28", className)}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {action}
      </div>
      {children}
    </main>
  );
}
