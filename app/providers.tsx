"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ConvexProviderWithAuth,
  ConvexReactClient,
} from "convex/react";
import { Toaster } from "@/components/ui/toast";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    "NEXT_PUBLIC_CONVEX_URL is not set. Run `npx convex dev` to create a deployment."
  );
}

const convex = new ConvexReactClient(convexUrl);

/**
 * Bridges our httpOnly session cookie to Convex.
 *
 * Convex needs a bearer token on every request; the durable session token must
 * stay out of JavaScript. So the cookie is exchanged server-side for a
 * short-lived JWT, and Convex re-requests one whenever it expires.
 */
function useCookieAuth() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Establish up front whether there is a session at all, so Convex doesn't
  // sit in a loading state on public pages.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
        });
        const data = (await response.json()) as { session: unknown | null };
        if (active) setIsAuthenticated(Boolean(data.session));
      } catch {
        if (active) setIsAuthenticated(false);
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {
        const response = await fetch("/api/auth/token", {
          cache: "no-store",
          // The route always mints a fresh token; the flag just bypasses any
          // intermediary cache on a forced refresh.
          headers: forceRefreshToken ? { "Cache-Control": "no-cache" } : undefined,
        });
        if (!response.ok) {
          setIsAuthenticated(false);
          return null;
        }
        const data = (await response.json()) as { token: string };
        setIsAuthenticated(true);
        return data.token;
      } catch {
        setIsAuthenticated(false);
        return null;
      }
    },
    []
  );

  return useMemo(
    () => ({ isLoading, isAuthenticated, fetchAccessToken }),
    [isLoading, isAuthenticated, fetchAccessToken]
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useCookieAuth}>
      <Toaster>{children}</Toaster>
    </ConvexProviderWithAuth>
  );
}
