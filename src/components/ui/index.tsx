import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Loader2 } from "lucide-react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ───────────── Button ─────────────
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent select-none",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-fg hover:opacity-90 active:opacity-80",
        accent: "bg-accent text-accent-fg hover:brightness-95 active:brightness-90",
        outline: "border border-border bg-surface text-fg hover:bg-surface-2",
        ghost: "text-fg hover:bg-surface-2",
        danger: "bg-danger text-white hover:brightness-95",
        "danger-outline": "border border-danger/40 text-danger hover:bg-danger-soft",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        md: "h-11 px-4 text-[15px]",
        lg: "h-14 px-5 text-base",
        icon: "h-11 w-11",
      },
      block: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, asChild, loading, children, disabled, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp ref={ref} className={cn(buttonVariants({ variant, size, block }), className)} disabled={disabled || loading} {...props}>
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  );
});

// ───────────── Card ─────────────
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-border bg-surface", className)} {...props} />;
}

export function CardHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// ───────────── Form controls ─────────────
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-[15px] text-fg placeholder:text-muted/70 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-24 w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[15px] text-fg placeholder:text-muted/70 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20",
        className,
      )}
      {...props}
    />
  );
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn("h-11 w-full rounded-xl border border-border bg-surface px-3 text-[15px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20", className)}
      {...props}
    />
  );
});

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string | null; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? <p className="text-sm text-danger">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

// ───────────── Feedback ─────────────
const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", {
  variants: {
    tone: {
      neutral: "bg-surface-2 text-muted",
      success: "bg-accent-soft text-accent",
      warn: "bg-warn-soft text-warn",
      danger: "bg-danger-soft text-danger",
      ink: "bg-primary text-primary-fg",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ tone, className, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function Alert({ tone = "neutral", title, children, className }: { tone?: "neutral" | "warn" | "danger" | "success"; title?: string; children?: React.ReactNode; className?: string }) {
  const tones = {
    neutral: "border-border bg-surface-2 text-fg",
    warn: "border-warn/30 bg-warn-soft text-fg",
    danger: "border-danger/30 bg-danger-soft text-fg",
    success: "border-accent/30 bg-accent-soft text-fg",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3 text-sm", tones[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-0.5", "text-fg/80")}>{children}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-muted", className)} aria-label="Yuklanmoqda" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-surface-2", className)} aria-hidden />;
}

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-muted">{icon}</div>}
      <p className="font-semibold text-fg">{title}</p>
      {description && <p className="mt-1 max-w-xs text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ───────────── Domain primitives ─────────────

/** Fare in so‘m with tabular figures; the amount leads, the currency follows quietly. */
export function Money({ amount, className, size = "md" }: { amount: number | null | undefined; className?: string; size?: "sm" | "md" | "lg" | "xl" }) {
  if (amount == null) return <span className={className}>—</span>;
  const text = amount.toLocaleString("ru-RU").replace(/ /g, " ");
  const sizes = { sm: "text-sm", md: "text-base", lg: "text-2xl", xl: "text-4xl" };
  return (
    <span className={cn("num font-semibold whitespace-nowrap", sizes[size], className)}>
      {text}
      <span className="ml-1 text-[0.6em] font-medium tracking-wide text-muted">so‘m</span>
    </span>
  );
}

/**
 * Uzbek licence plate (e.g. 70 | A 123 BC | UZ). The plate is how a passenger finds their car,
 * so it is shown as a plate, not as a string.
 */
export function Plate({ plate, size = "md" }: { plate: string; size?: "sm" | "md" | "lg" }) {
  const region = plate.slice(0, 2);
  const rest = plate.slice(2);
  // Format the body: letter-digits-letters (A123BC → A 123 BC) or digits-letters (123ABC → 123 ABC).
  const body = rest.replace(/^([A-Z])(\d{3})([A-Z]{2})$/, "$1 $2 $3").replace(/^(\d{3})([A-Z]{3})$/, "$1 $2");
  const sizes = { sm: "h-7 text-sm", md: "h-9 text-base", lg: "h-12 text-xl" };
  return (
    <span
      className={cn("inline-flex items-stretch overflow-hidden rounded-md border-2 border-ink bg-white font-mono font-bold text-ink num shadow-[inset_0_0_0_1px_#fff]", sizes[size])}
      aria-label={`Davlat raqami ${plate}`}
    >
      <span className="flex items-center px-1.5">{region}</span>
      <span className="w-0.5 bg-ink" aria-hidden />
      <span className="flex items-center px-2 tracking-wider">{body}</span>
      <span className="flex flex-col items-center justify-center gap-px pr-1.5 pl-0.5 text-[0.45em] leading-none" aria-hidden>
        <span className="flex h-[0.7em] w-[1.1em] flex-col overflow-hidden rounded-[1px]">
          <span className="flex-1 bg-[#0099b5]" />
          <span className="flex-1 bg-white" />
          <span className="flex-1 bg-[#1eb53a]" />
        </span>
        UZ
      </span>
    </span>
  );
}

/** Pickup → destination rail. */
export function RouteRail({ pickup, dropoff, compact }: { pickup: React.ReactNode; dropoff: React.ReactNode; compact?: boolean }) {
  return (
    <div className="grid grid-cols-[14px_1fr] gap-x-3">
      <div className="flex flex-col items-center pt-1.5">
        <span className="size-2.5 rounded-full bg-accent ring-4 ring-accent/15" />
        <span className={cn("my-1 w-px flex-1 border-l border-dashed border-muted/50", compact ? "min-h-3" : "min-h-5")} />
        <span className="size-2.5 rounded-[3px] bg-primary" />
      </div>
      <div className={cn("flex flex-col", compact ? "gap-2" : "gap-4")}>
        <div className="min-w-0 text-sm text-fg">{pickup}</div>
        <div className="min-w-0 text-sm text-fg">{dropoff}</div>
      </div>
    </div>
  );
}

export function Logo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-black tracking-tight", className)}>
      <span className={cn("grid size-7 grid-cols-2 grid-rows-2 overflow-hidden rounded-lg", inverted ? "bg-white" : "bg-ink")} aria-hidden>
        <span className="bg-accent" />
        <span />
        <span />
        <span className="bg-accent" />
      </span>
      <span>
        NEXT<span className="font-medium text-accent"> TAXI</span>
      </span>
    </span>
  );
}
