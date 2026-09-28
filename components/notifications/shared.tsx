"use client";

import { useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/convex-server";

/**
 * What the Notifications page and its dialogs share: the shapes the queries
 * return, and the two bits of behaviour more than one dialog needs.
 */

export type Overview = FunctionReturnType<typeof api.notifications.overview>;
export type Rule = FunctionReturnType<typeof api.notifications.listRules>[number];
export type WhatsAppTemplate = FunctionReturnType<
  typeof api.notifications.listWhatsAppTemplates
>[number];
export type EmailTemplate = FunctionReturnType<
  typeof api.notifications.listEmailTemplates
>[number];
export type NotificationLog = FunctionReturnType<
  typeof api.notifications.listLogs
>[number];

export function fail(title: string, error: unknown) {
  toast.add({ title, description: errorMessage(error), type: "error" });
}

export async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.add({ title: `${label} copied`, type: "success" });
  } catch {
    toast.add({
      title: "Copy failed",
      description: "Select the text and copy it manually.",
      type: "error",
    });
  }
}

export function templateKey(template: { name: string; language: string }): string {
  return `${template.name}|${template.language}`;
}

/** APPROVED reads as good news, a rejection as bad, everything else as waiting. */
export function statusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "APPROVED") return "default";
  if (status === "REJECTED" || status === "DISABLED") return "destructive";
  return "secondary";
}

type Field = HTMLInputElement | HTMLTextAreaElement;

/**
 * Dropping a `{{variable}}` into whichever field was focused last, at its
 * caret.
 *
 * Clicking a variable button takes focus away from the field, but the field
 * keeps its selection — so the last-focused key and the element's own
 * `selectionStart` are enough to splice the token where the cursor was, then
 * put the cursor back after it.
 */
export function useFieldInsert() {
  const fields = useRef(new Map<string, Field>());
  const [focused, setFocused] = useState<string | null>(null);

  const bind = (key: string) => ({
    ref: (element: Field | null) => {
      if (element) fields.current.set(key, element);
      else fields.current.delete(key);
    },
    onFocus: () => setFocused(key),
  });

  const splice = (key: string, current: string, token: string): string => {
    const element = fields.current.get(key);
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
    requestAnimationFrame(() => {
      if (!element) return;
      element.focus();
      const caret = start + token.length;
      element.setSelectionRange(caret, caret);
    });
    return next;
  };

  return { bind, focused, setFocused, splice };
}
