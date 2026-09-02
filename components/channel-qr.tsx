"use client";

import { useState } from "react";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { QrCodeIcon, WarningIcon } from "@phosphor-icons/react";

/**
 * A scannable code for testing a channel from a phone.
 *
 * Both channel types end up as a URL, which is the whole reason one component
 * covers them: a web channel points at the widget's own page, and a WhatsApp
 * channel at wa.me, which opens a chat with the number in the app the phone
 * already has.
 *
 * Rendered as an SVG rather than a canvas, so it stays sharp when a phone is
 * held up to a laptop screen at an angle — which is how this actually gets
 * used — and so it prints.
 */
export function ChannelQr({
  label,
  /** The URL to encode. Null when the channel cannot produce one yet. */
  url,
  caption,
  unavailable,
}: {
  label: string;
  url: string | null;
  caption: string;
  /** Why there is no code, when there is not one. */
  unavailable?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="lg" variant="outline">
            <QrCodeIcon /> QR code
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{caption}</DialogDescription>
        </DialogHeader>

        {url ? (
          <div className="flex flex-col items-center gap-3">
            {/* White ground and a quiet zone regardless of theme: a scanner
                needs the contrast and the margin, and a dark-mode code on a
                dark card reads badly or not at all. */}
            <div className="rounded-lg bg-white p-4">
              <QRCode
                value={url}
                size={200}
                // Medium recovery: enough that a phone camera copes with a
                // screen's glare without making the modules needlessly dense.
                level="M"
                bgColor="#ffffff"
                fgColor="#0b1c12"
              />
            </div>
            <p className="w-full truncate text-center font-mono text-xs text-muted-foreground">
              {url}
            </p>
          </div>
        ) : (
          <Alert variant="destructive">
            <WarningIcon />
            <AlertTitle>No code yet</AlertTitle>
            <AlertDescription>{unavailable}</AlertDescription>
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}
