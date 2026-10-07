"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";
import { FlaskIcon } from "@phosphor-icons/react";

/** Where the last number tested with is kept, per browser. */
const LAST_NUMBER_KEY = "marketing:test-number";

function readLastNumber(): string {
  try {
    return window.localStorage.getItem(LAST_NUMBER_KEY) ?? "";
  } catch {
    return "";
  }
}

function keepLastNumber(value: string) {
  try {
    window.localStorage.setItem(LAST_NUMBER_KEY, value);
  } catch {
    // A private window, or storage switched off: the number is only a
    // convenience, so there is nothing to recover.
  }
}

/**
 * "Send a test": one greeting, reminder or template to one number, exactly
 * as a customer would get it. Needs a template Meta has approved — a test is a
 * real template message, and nothing else reaches a phone.
 */
export function TestSendButton({
  eventId,
  templateId,
  disabledReason,
}: {
  eventId?: Id<"marketingEvents">;
  templateId?: Id<"marketingTemplates">;
  /** Why it cannot be tested yet, when it cannot. */
  disabledReason?: string | null;
}) {
  const sendTest = useAction(api.marketingSend.sendTest);
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      const result = await sendTest({ to: number, eventId, templateId });
      keepLastNumber(number.trim());
      toast.add({
        title: `Test sent to +${result.to}`,
        description: result.text,
        type: "success",
      });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "The test did not send",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // The last number used is offered again, so testing a few in a row
        // is one click each.
        if (next && !number) setNumber(readLastNumber());
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            disabled={Boolean(disabledReason)}
            title={disabledReason ?? undefined}
          >
            <FlaskIcon /> Send a test
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>Send a test</PopoverTitle>
        </PopoverHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="test-number">WhatsApp number</Label>
          <Input
            id="test-number"
            type="tel"
            value={number}
            autoFocus
            placeholder="98765 43210"
            onChange={(event) => setNumber(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && number.trim() && !busy) void send();
            }}
          />
          <p className="text-xs text-muted-foreground">
            Only this number gets it, as a real message billed at the template&apos;s
            rate. A number without a country code gets the workspace&apos;s default,
            +91 unless set otherwise.
          </p>
        </div>
        <Button onClick={() => void send()} disabled={busy || !number.trim()}>
          {busy ? <Spinner /> : <FlaskIcon />} Send test
        </Button>
      </PopoverContent>
    </Popover>
  );
}
