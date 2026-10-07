import { ConvexHttpClient } from "convex/browser";
import { friendlyError } from "@/lib/errors";

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
  return friendlyError(error);
}
