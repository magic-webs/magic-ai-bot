"use client";

import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSession } from "@/components/use-session";
import { isSigningOut, useSessionEndReason } from "@/components/session-end";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { DevicesIcon, LockKeyIcon } from "@phosphor-icons/react";
import type { SessionEndReason } from "@/lib/session";

/**
 * Holds a subtree back until the Convex client has an access token.
 *
 * Without this, hooks inside would fire their first query before the token is
 * attached and be refused by the server-side guards. The cookie check in
 * proxy.ts keeps unauthenticated visitors off these routes; this handles the
 * remaining case of a cookie that is present but no longer valid — an expired
 * session, a company whose access was revoked mid-visit, or a login that has
 * since been signed in on another device.
 *
 * The way out signs out rather than linking to /login: the dead cookie is what
 * puts someone here, and proxy.ts reads that same cookie as "signed in", so a
 * bare link would bounce straight back. Clearing it is what lets the form load.
 */
export function RequireAuth({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const reason = useSessionEndReason();

  return (
    <>
      <AuthLoading>
        {fallback ?? (
          <div className="flex min-h-svh items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Checking your session…
          </div>
        )}
      </AuthLoading>

      <Unauthenticated>
        <SessionEnded reason={reason} />
      </Unauthenticated>

      <Authenticated>
        <SessionGate>{children}</SessionGate>
      </Authenticated>
    </>
  );
}

/**
 * Takes the page down the moment its session ends, rather than when the
 * access token next comes up for renewal.
 *
 * It sits above everything that queries, and that is what makes it work: the
 * write that ends a session reaches this subscription in the same update that
 * starts every query below refusing, so the page is swapped out in the render
 * that would otherwise have thrown.
 */
function SessionGate({ children }: { children: React.ReactNode }) {
  const live = useQuery(api.authDb.mySession);
  if (live?.ended && !isSigningOut()) {
    return <SessionEnded reason={live.reason} />;
  }
  return children;
}

function SessionEnded({ reason }: { reason: SessionEndReason | null }) {
  const replaced = reason === "replaced";
  return (
    <div className="flex min-h-svh items-center justify-center p-8">
      <Empty className="max-w-md border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            {replaced ? <DevicesIcon /> : <LockKeyIcon />}
          </EmptyMedia>
          <EmptyTitle>
            {replaced ? "Signed in on another device" : "Your session has ended"}
          </EmptyTitle>
          <EmptyDescription>
            {replaced
              ? "This login was just used to sign in somewhere else, and a login can only be open in one place at a time — so this one was signed out. Signing in again here signs the other device out."
              : "Sign in again to continue. If this keeps happening, your access to this workspace may have been withdrawn."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <SignInAgainButton />
        </EmptyContent>
      </Empty>
    </div>
  );
}

function SignInAgainButton() {
  const { signOut } = useSession();
  return <Button onClick={() => void signOut()}>Go to sign in</Button>;
}
