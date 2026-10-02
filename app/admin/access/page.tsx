"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import { useSession } from "@/components/use-session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/skeletons";
import { WorkspaceAccessDialog } from "@/components/workspace-access";
import { TwoFactorCard } from "@/components/two-factor-card";
import { KeyIcon, UserIcon } from "@phosphor-icons/react";

function relative(timestamp: number | null): string {
  if (!timestamp) return "never";
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

const STATUS_BADGE: Record<string, { label: string; variant: "secondary" | "destructive" }> = {
  active: { label: "active", variant: "secondary" },
  revoked: { label: "revoked", variant: "destructive" },
};

/** Workspace sign-ins and your own two-factor setup. The platform team is on /admin/team. */
export default function AdminAccessPage() {
  const { isAdmin } = useSession();
  const workspaces = useQuery(api.workspaces.list, isAdmin ? {} : "skip");
  const access = useQuery(api.authDb.accessSummary, isAdmin ? {} : "skip");

  const accessById = new Map(
    (access ?? []).map((row) => [row.workspaceId as string, row])
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Access
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Every password is stored hashed and shown exactly once, at the moment
          it is issued. Revoking a workspace signs out its open sessions
          immediately. Each login can be open in one place at a time, and
          issuing a new password also turns off its two-factor authentication.
        </p>
      </header>

      {/* Your own, as the administrator signed in. shrink-0 for the same
          reason as the cards below. */}
      <TwoFactorCard className="shrink-0" />

      {/* shrink-0, or this page does not scroll. `Card` carries
          `overflow-hidden`, and a flex item whose overflow is not `visible`
          gets an automatic minimum size of zero — so instead of growing past
          the scrolling column and making it scroll, the card shrank into
          whatever space was left and clipped its own table. Nothing
          overflowed, so no scrollbar appeared and the list just stopped
          mid-row. The same trap the agent map's canvas documents. */}
      {isAdmin ? (
        <Card className="shrink-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserIcon className="size-4" /> Workspace sign-ins
            </CardTitle>
            <CardDescription>
              A company signs in with its workspace ID and the password you issue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {workspaces === undefined || access === undefined ? (
              <TableSkeleton columns={5} />
            ) : workspaces.length === 0 ? (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <KeyIcon />
                  </EmptyMedia>
                  <EmptyTitle>No workspaces yet</EmptyTitle>
                  <EmptyDescription>
                    Create a workspace and it appears here with its sign-in state.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Workspace</TableHead>
                      <TableHead>Password</TableHead>
                      <TableHead className="hidden md:table-cell">Issued</TableHead>
                      <TableHead className="hidden lg:table-cell">Last sign-in</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workspaces.map((workspace) => {
                      const row = accessById.get(workspace._id as string);
                      const badge = row ? STATUS_BADGE[row.status] : undefined;
                      return (
                        <TableRow key={workspace._id}>
                          <TableCell>
                            <div className="flex min-w-0 flex-col">
                              <Link
                                href={`/w/${workspace.slug}`}
                                className="truncate font-medium hover:underline"
                              >
                                {workspace.name}
                              </Link>
                              <span className="truncate font-mono text-xs text-muted-foreground">
                                /{workspace.slug}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {badge ? (
                                <Badge variant={badge.variant}>
                                  {badge.label}
                                </Badge>
                              ) : (
                                <Badge variant="outline">not issued</Badge>
                              )}
                              {row?.mustChangePassword ? (
                                <Badge variant="outline">must change</Badge>
                              ) : null}
                              {row?.twoFactor ? (
                                <Badge variant="outline">2FA</Badge>
                              ) : null}
                              {workspace.status === "archived" ? (
                                <Badge variant="secondary">archived</Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-muted-foreground">
                            {relative(row?.issuedAt ?? null)}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-muted-foreground">
                            {relative(row?.lastLoginAt ?? null)}
                          </TableCell>
                          <TableCell className="text-right">
                            <WorkspaceAccessDialog
                              workspaceId={workspace._id}
                              name={workspace.name}
                              slug={workspace.slug}
                              trigger={
                                <Button size="sm" variant="outline">
                                  <KeyIcon /> Manage
                                </Button>
                              }
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
