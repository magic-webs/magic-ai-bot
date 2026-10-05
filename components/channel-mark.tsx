"use client";

import { GlobeIcon } from "@phosphor-icons/react";
import { InstagramLogo, WhatsAppLogo } from "@/components/brand-icons";
import { cn } from "@/lib/utils";

export type ChannelKind = "whatsapp" | "instagram" | "web";

export const CHANNEL_LABEL: Record<ChannelKind, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  web: "Web chat",
};

const TILE: Record<ChannelKind, string> = {
  whatsapp: "bg-[#25D366]",
  instagram:
    "bg-[radial-gradient(circle_at_30%_107%,#fdf497_0%,#fdf497_5%,#fd5949_45%,#d6249f_60%,#285AEB_90%)]",
  web: "bg-sky-500",
};

/** The channel as its own brand draws it: a white glyph on the brand's colour. */
export function ChannelMark({
  type,
  size = 16,
  className,
}: {
  type: ChannelKind;
  size?: number;
  className?: string;
}) {
  const glyph = { width: size * 0.66, height: size * 0.66 };
  return (
    <span
      role="img"
      aria-label={CHANNEL_LABEL[type]}
      title={CHANNEL_LABEL[type]}
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-white",
        TILE[type],
        className
      )}
    >
      <span style={glyph} className="flex">
        {type === "whatsapp" ? (
          <WhatsAppLogo className="size-full" />
        ) : type === "instagram" ? (
          <InstagramLogo className="size-full" />
        ) : (
          <GlobeIcon weight="bold" className="size-full" />
        )}
      </span>
    </span>
  );
}
