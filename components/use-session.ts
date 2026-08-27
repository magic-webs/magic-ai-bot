"use client";

import { useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * The signed-in principal, straight from Convex so it reflects revocation
 * immediately. `undefined` while loading, `null` when signed out.
 */
export function useSession() {
  const me = useQuery(api.authDb.me);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    // A full document navigation is deliberate here: it tears down the Convex
    // client and every cached query result, so no signed-in state can linger
    // after sign-out. router.push() would keep them alive.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }, []);

  return {
    me,
    isLoading: me === undefined,
    isAdmin: me?.role === "admin",
    signOut,
  };
}
