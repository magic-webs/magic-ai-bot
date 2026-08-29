"use client";

import Link from "next/link";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
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
import { LockKeyIcon } from "@phosphor-icons/react";

/**
 * Holds a subtree back until the Convex client has an access token.
 *
 * Without this, hooks inside would fire their first query before the token is
 * attached and be refused by the server-side guards. The cookie check in
 * proxy.ts keeps unauthenticated visitors off these routes; this handles the
 * remaining case of a cookie that is present but no longer valid — an expired
 * session, or a company whose access was revoked mid-visit.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthLoading>
        <div className="flex min-h-svh items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Checking your session…
        </div>
      </AuthLoading>

      <Unauthenticated>
        <div className="flex min-h-svh items-center justify-center p-8">
          <Empty className="max-w-md border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LockKeyIcon />
              </EmptyMedia>
              <EmptyTitle>Your session has ended</EmptyTitle>
              <EmptyDescription>
                Sign in again to continue. If this keeps happening, your access
                to this workspace may have been withdrawn.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button nativeButton={false} render={<Link href="/login" />}>
                Go to sign in
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      </Unauthenticated>

      <Authenticated>{children}</Authenticated>
    </>
  );
}
