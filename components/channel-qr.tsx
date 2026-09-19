"use client";

import QRCode from "react-qr-code";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WarningIcon } from "@phosphor-icons/react";

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
 *
 * Inline, not behind a dialog. It sits in a tab called "QR code", and a button
 * called "QR code" inside it was a second click to reach the only thing the
 * tab contains.
 */
export function ChannelQr({
  /** The URL to encode. Null when the channel cannot produce one yet. */
  url,
  caption,
  unavailable,
}: {
  url: string | null;
  caption: string;
  /** Why there is no code, when there is not one. */
  unavailable?: string;
}) {
  if (!url) {
    return (
      <Alert variant="destructive">
        <WarningIcon />
        <AlertTitle>No code yet</AlertTitle>
        <AlertDescription>{unavailable}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-muted/40 p-3">
      {/* White ground and a quiet zone regardless of theme: a scanner needs the
          contrast and the margin, and a dark-mode code on a dark card reads
          badly or not at all. */}
      <div className="shrink-0 rounded-lg bg-white p-3">
        <QRCode
          value={url}
          size={128}
          // Medium recovery: enough that a phone camera copes with a screen's
          // glare without making the modules needlessly dense.
          level="M"
          bgColor="#ffffff"
          fgColor="#0b1c12"
        />
      </div>

      {/* min-w-0 is load-bearing. A flex item defaults to min-width:auto, so
          without it the URL below sets this column's floor to its own
          unbroken width and pushes the whole card wider than its container. */}
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-2">
        <p className="text-xs text-muted-foreground">{caption}</p>
        {/* break-all rather than truncate: the part that identifies one
            channel from another is the key on the end, which is exactly what
            an ellipsis eats. */}
        <p className="break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
          {url}
        </p>
      </div>
    </div>
  );
}
