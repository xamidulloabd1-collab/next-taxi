"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/client/api";
import { toast } from "@/lib/client/toast";
import { Button, Field, Textarea, type ButtonProps } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";

/**
 * Calls an admin API endpoint, optionally collecting a reason first, then refreshes the
 * server-rendered page. Authorisation is enforced by the endpoint, not by this button.
 */
export function ApiAction({
  label,
  endpoint,
  method = "POST",
  body = {},
  reason,
  confirm,
  success = "Bajarildi.",
  variant = "outline",
  size = "sm",
}: {
  label: string;
  endpoint: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  reason?: { label: string; required?: boolean; field?: string };
  confirm?: string;
  success?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true);
    try {
      await api(endpoint, { method, body: reason ? { ...body, [reason.field ?? "reason"]: text.trim() || null } : body });
      toast.success(success);
      setOpen(false);
      setText("");
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <Button variant={variant} size={size} loading={loading && !open} onClick={() => (reason || confirm ? setOpen(true) : void run())}>
        {label}
      </Button>
      {(reason || confirm) && (
        <Dialog open={open} onOpenChange={setOpen} title={label} description={confirm}>
          <div className="space-y-3">
            {reason && (
              <Field label={reason.label}>
                <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={300} autoFocus />
              </Field>
            )}
            <Button block variant={variant === "danger" || variant === "danger-outline" ? "danger" : "primary"} loading={loading} disabled={Boolean(reason?.required) && text.trim().length < 3} onClick={() => void run()}>
              Tasdiqlash
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
