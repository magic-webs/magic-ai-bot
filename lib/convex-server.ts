import { ConvexHttpClient } from "convex/browser";

// Server-side Convex client for the auth route handlers. A fresh client per
// call keeps one request's identity from leaking into another's.
export function convexServerClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(url);
}

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Convex prefixes thrown errors with request ids and stack context; surface
  // only the message the action actually threw.
  const match = raw.match(/Uncaught Error:\s*([^\n]+)/);
  if (match) return match[1].trim();
  const stripped = raw.replace(/^\[Request ID:[^\]]*\]\s*/, "").split("\n")[0];
  return stripped.replace(/^Server Error\s*/, "").trim() || "Something went wrong.";
}
