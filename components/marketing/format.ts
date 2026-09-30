import type { Doc } from "@/convex/_generated/dataModel";
import {
  renderTemplate,
  templateBlocker,
  type TemplateVariable,
} from "@/convex/lib/marketing";

// ------------------------------------------------------ a template and Meta

type TemplateLike = {
  name: string;
  metaTemplateName?: string;
  metaStatus?: string;
  metaRejectedReason?: string;
};

const APPROVED_TONE =
  "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20 ring-inset dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25";
const WAITING_TONE =
  "bg-amber-50 text-amber-800 ring-1 ring-amber-600/20 ring-inset dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25";
const REFUSED_TONE = "bg-destructive/10 text-destructive";

/** Whether it can send now — the same answer the sender reaches. */
export const templateReady = (template: TemplateLike) => templateBlocker(template) === null;

/** The badge a template's standing with Meta gets. */
export function templateStanding(template: TemplateLike): { label: string; className: string } {
  if (!template.metaTemplateName) {
    return { label: "Not applied", className: "bg-muted text-muted-foreground" };
  }
  switch (template.metaStatus) {
    case undefined:
      // Pasted in by hand, approved somewhere else.
      return { label: "Linked", className: APPROVED_TONE };
    case "APPROVED":
      return { label: "Approved", className: APPROVED_TONE };
    case "PENDING":
    case "IN_APPEAL":
      return { label: "In review", className: WAITING_TONE };
    case "CHANGED":
      return { label: "Changed", className: WAITING_TONE };
    case "REJECTED":
      return { label: "Rejected", className: REFUSED_TONE };
    default:
      return { label: template.metaStatus.toLowerCase(), className: REFUSED_TONE };
  }
}

/** A template's name in a picker, with its standing when it cannot send. */
export const templateOptionLabel = (template: TemplateLike) =>
  templateReady(template)
    ? template.name
    : `${template.name} (${templateStanding(template).label.toLowerCase()})`;

export type EventStatus = Doc<"marketingEvents">["status"];

export const STATUS_VARIANT: Record<
  EventStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  scheduled: "default",
  sending: "default",
  sent: "secondary",
  failed: "destructive",
};

/*
 * Every date on the Marketing page is a workspace-local calendar date,
 * "YYYY-MM-DD", and the arithmetic runs on those strings through UTC. The
 * browser's own timezone never enters into it: an owner working from Dubai
 * still sees Diwali on the day their Kolkata customers do.
 */

export const pad = (n: number) => String(n).padStart(2, "0");

export function parts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

export function formatDate(date: string, options: Intl.DateTimeFormatOptions): string {
  const { year, month, day } = parts(date);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    ...options,
    timeZone: "UTC",
  });
}

export const dayLabel = (date: string) =>
  formatDate(date, { weekday: "long", day: "numeric", month: "long" });

export const shortDayLabel = (date: string) =>
  formatDate(date, { weekday: "short", day: "numeric", month: "short" });

export function hourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: hourLabel(hour),
}));

/**
 * What an event's reminders go out with until the owner writes their own:
 * the desk's line in {{message}}, then the event and its day. It starts and
 * ends on fixed words and never puts two variables side by side, because
 * Meta turns down a template that does either.
 */
export const EVENT_TEMPLATE_BODY =
  "Hi {{name}}, {{message}} Event: {{event}}, {{date}}. Reply to this message if you have any questions — the {{business}} team.";

/**
 * A template as one customer would read it. Anything not given falls back to
 * a sample, so a preview never shows a bare variable.
 */
export function previewTemplate(
  body: string,
  values: Partial<Record<TemplateVariable, string>>
): string {
  return renderTemplate(body, {
    name: "Asha",
    business: values.business || "your business",
    event: values.event || "the day",
    date: values.date || "Sat, 8 Nov",
    venue: values.venue || "the venue",
    message: values.message || "…the reminder's own line…",
  }).text;
}
