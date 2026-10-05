"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { eventDateLabel } from "@/convex/lib/marketing";
import { fail, formatPhone } from "@/components/marketing/audience/shared";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { CheckCircleIcon, UserCheckIcon } from "@phosphor-icons/react";

type Filter = "all" | "going" | "maybe" | "declined" | "attended";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "Everyone" },
  { value: "going", label: "Going" },
  { value: "maybe", label: "Maybe" },
  { value: "declined", label: "Can't come" },
  { value: "attended", label: "Came" },
];

const RSVP_OPTIONS = [
  { value: "none", label: "No answer" },
  { value: "going", label: "Going" },
  { value: "maybe", label: "Maybe" },
  { value: "declined", label: "Can't come" },
];

export function GuestsDialog({
  campaign,
  onClose,
}: {
  campaign: Doc<"marketingCampaigns">;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const [filter, setFilter] = useState<Filter>("all");
  const summary = useQuery(api.eventGuests.summary, { campaignId: campaign._id });
  const { results, status, loadMore } = usePaginatedQuery(
    api.eventGuests.list,
    { campaignId: campaign._id, filter },
    { initialNumItems: 50 }
  );
  const setRsvp = useMutation(api.eventGuests.setRsvp);
  const setAttended = useMutation(api.eventGuests.setAttended);
  const checkIn = useMutation(api.eventGuests.checkIn);
  const markInterested = useMutation(api.eventGuests.markInterestedAttended);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const counts: Record<Filter, number | undefined> = {
    all: undefined,
    going: summary?.going,
    maybe: summary?.maybe,
    declined: summary?.declined,
    attended: summary?.attended,
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Guests · {campaign.title}</DialogTitle>
          <DialogDescription>
            {eventDateLabel(campaign.date, campaign.startTime, workspace.locale)}
            {campaign.venue ? ` · ${campaign.venue}` : ""}. Replies to the reminders are read as
            RSVPs; change any of them by hand, and check people in on the day.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <form
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                const result = await checkIn({
                  campaignId: campaign._id,
                  phone,
                  name: name || undefined,
                });
                toast.add({
                  title: `${result.name ?? formatPhone(result.phone)} checked in`,
                  type: "success",
                });
                setPhone("");
                setName("");
              } catch (error) {
                fail("Could not check in", error);
              } finally {
                setBusy(false);
              }
            }}
          >
            <UserCheckIcon className="size-5 text-primary" />
            <span className="text-sm font-medium">Check in</span>
            <Input
              className="h-8 w-44"
              value={phone}
              inputMode="tel"
              placeholder="Their number"
              onChange={(e) => setPhone(e.target.value)}
            />
            <Input
              className="h-8 w-40"
              value={name}
              placeholder="Name, if new"
              onChange={(e) => setName(e.target.value)}
            />
            <Button size="sm" type="submit" disabled={busy || !phone.trim()}>
              {busy ? <Spinner /> : null} Mark as came
            </Button>
          </form>

          <div className="flex flex-wrap items-center gap-1">
            {FILTERS.map((item) => (
              <Button
                key={item.value}
                size="sm"
                variant={filter === item.value ? "secondary" : "ghost"}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
                {counts[item.value] !== undefined ? (
                  <Badge variant="outline" className="ml-1 tabular-nums">
                    {counts[item.value]}
                  </Badge>
                ) : null}
              </Button>
            ))}
            {summary && summary.going > 0 ? (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() =>
                  void markInterested({ campaignId: campaign._id })
                    .then(() => toast.add({ title: "Everyone going is marked as came" }))
                    .catch((error) => fail("Could not mark them", error))
                }
              >
                <CheckCircleIcon /> Everyone going came
              </Button>
            ) : null}
          </div>

          <div className="max-h-[45vh] overflow-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Guest</TableHead>
                  <TableHead className="w-40">RSVP</TableHead>
                  <TableHead className="hidden md:table-cell">Their reply</TableHead>
                  <TableHead className="w-20 text-center">Came</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((guest) => (
                  <TableRow key={guest._id}>
                    <TableCell>
                      <p className="font-medium">{guest.name ?? "No name"}</p>
                      <p className="font-mono text-xs text-muted-foreground">{formatPhone(guest.phone)}</p>
                    </TableCell>
                    <TableCell>
                      <SelectField
                        size="sm"
                        aria-label="RSVP"
                        value={guest.rsvp ?? "none"}
                        options={RSVP_OPTIONS}
                        onValueChange={(value) =>
                          void setRsvp({
                            campaignId: campaign._id,
                            contactId: guest.contactId,
                            rsvp: value === "none" ? null : (value as "going" | "maybe" | "declined"),
                          }).catch((error) => fail("Could not change it", error))
                        }
                      />
                    </TableCell>
                    <TableCell className="hidden max-w-64 md:table-cell">
                      <p className="truncate text-xs text-muted-foreground">
                        {guest.rsvpText ? `“${guest.rsvpText}”` : guest.rsvpSource === "manual" ? "Set by hand" : "—"}
                      </p>
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox
                        aria-label="Came"
                        checked={guest.attended === true}
                        onCheckedChange={(next) =>
                          void setAttended({
                            campaignId: campaign._id,
                            contactIds: [guest.contactId as Id<"contacts">],
                            attended: next === true,
                          }).catch((error) => fail("Could not change it", error))
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {status === "LoadingFirstPage" ? (
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            ) : results.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No guests here yet. RSVPs appear as people reply to the reminders.
              </p>
            ) : null}
            {status === "CanLoadMore" ? (
              <div className="flex justify-center border-t border-border p-2">
                <Button size="sm" variant="ghost" onClick={() => loadMore(50)}>
                  Show more
                </Button>
              </div>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
