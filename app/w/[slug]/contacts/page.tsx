"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { UsersIcon } from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";

export default function ContactsPage() {
  const workspace = useWorkspace();
  const contacts = useQuery(api.contacts.listByWorkspace, {
    workspaceId: workspace._id,
  });

  if (contacts === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        <Spinner className="mr-2" /> Loading contacts...
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
      <header className="mb-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Contacts
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          People who have interacted with your agents.
        </p>
      </header>

      {contacts.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>No contacts yet</EmptyTitle>
            <EmptyDescription>
              Contacts will appear here once someone talks to your agent on WhatsApp or Web.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone / Email</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Company</TableHead>
                <TableHead className="text-right">Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow key={contact._id}>
                  <TableCell className="font-medium">
                    {contact.name || "Anonymous"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col text-sm">
                      {contact.phone ? <span>{contact.phone}</span> : null}
                      {contact.email ? (
                        <span className="text-muted-foreground">
                          {contact.email}
                        </span>
                      ) : null}
                      {!contact.phone && !contact.email ? (
                        <span className="text-muted-foreground">—</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {contact.channelType}
                    </Badge>
                  </TableCell>
                  <TableCell>{contact.company || "—"}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDistanceToNow(contact.lastSeenAt, {
                      addSuffix: true,
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
