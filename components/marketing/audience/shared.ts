import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/convex-server";

export type Category = { key: string; label: string; description: string };

export function formatPhone(digits: string): string {
  if (/^91\d{10}$/.test(digits)) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return `+${digits}`;
}

export function categoryLabel(categories: Category[], key: string | null | undefined): string {
  if (!key) return "Not sorted";
  return categories.find((category) => category.key === key)?.label ?? key;
}

const TONES = [
  "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  "bg-teal-500/10 text-teal-700 dark:text-teal-300",
];

export function categoryTone(categories: Category[], key: string | null | undefined): string {
  if (key === "valid") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (key === "invalid") return "bg-rose-500/10 text-rose-700 dark:text-rose-300";
  const custom = categories.filter((category) => category.key !== "valid" && category.key !== "invalid");
  const index = custom.findIndex((category) => category.key === key);
  if (index < 0) return "bg-muted text-muted-foreground";
  return TONES[index % TONES.length];
}

export function fail(title: string, error: unknown) {
  toast.add({ title, description: errorMessage(error), type: "error" });
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}
