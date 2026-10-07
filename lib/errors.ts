import { ConvexError } from "convex/values";

const FALLBACK = "Something went wrong. Please try again.";

export function friendlyError(error: unknown, fallback = FALLBACK): string {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (typeof data === "string" && data.trim()) return data.trim();
    if (
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof data.message === "string"
    ) {
      return data.message;
    }
  }
  const raw =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const thrown = raw.match(/Uncaught \w*Error:\s*([^\n]+)/)?.[1];
  const text = (thrown ?? raw)
    .replace(/\[CONVEX [^\]]*\]\s*/g, "")
    .replace(/\[Request ID:[^\]]*\]\s*/g, "")
    .replace(/Server Error|Called by client/g, "")
    .split("\n")[0]
    .trim();
  return !text || /convex/i.test(text) ? fallback : text;
}
