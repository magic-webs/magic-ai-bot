"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Outbound } from "@/convex/lib/whatsappSend";
import { cn } from "@/lib/utils";
import { WhatsAppText } from "@/components/whatsapp-text";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  ArrowBendUpLeftIcon,
  ArrowSquareOutIcon,
  ChatCircleTextIcon,
  DownloadSimpleIcon,
  EnvelopeIcon,
  FileTextIcon,
  ListBulletsIcon,
  MapPinIcon,
  MicrophoneIcon,
  PaperPlaneRightIcon,
  PauseIcon,
  PhoneIcon,
  PlayIcon,
  StorefrontIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react";

/**
 * Renders the rich half of a message the way WhatsApp draws it — reply buttons
 * under a hairline, lists behind a bottom sheet, media edge to edge.
 *
 * Shared between the website chat and the console transcript. `interactive`
 * separates the two: in the console the controls are inert, because clicking a
 * button in a transcript must not answer on the customer's behalf.
 */

export function parseRichPayload(
  payload: string | null | undefined
): Outbound | null {
  if (!payload) return null;
  try {
    return JSON.parse(payload) as Outbound;
  } catch {
    return null;
  }
}

/** The message a tapped button or list row answered, for the quote above it. */
export function quotedChoice(
  message: Outbound | null,
  text: string
): { body: string } | null {
  if (!message) return null;
  if (message.kind === "buttons") {
    return message.buttons.some((button) => button.title === text)
      ? { body: message.body }
      : null;
  }
  if (message.kind === "list") {
    for (const section of message.sections) {
      if (section.rows.some((r) => r.title === text)) return { body: message.body };
    }
  }
  return null;
}

export type ChatMeta = { time: string; ticks?: React.ReactNode };

export function MetaStamp({
  meta,
  mode = "flow",
}: {
  meta?: ChatMeta;
  mode?: "flow" | "pin" | "overlay";
}) {
  if (!meta) return null;
  return (
    <span
      data-slot="chat-time"
      data-pin={mode === "pin" ? "" : undefined}
      data-overlay={mode === "overlay" ? "" : undefined}
      className="flex items-center gap-0.5"
    >
      {meta.time}
      {meta.ticks}
    </span>
  );
}

export function MetaSpacer({ meta }: { meta?: ChatMeta }) {
  if (!meta) return null;
  return (
    <span
      data-slot="chat-time-spacer"
      aria-hidden
      style={{ width: meta.ticks ? "4.75rem" : "3.75rem" }}
    />
  );
}

const action =
  "flex w-full items-center justify-center gap-1.5 border-t border-foreground/10 px-3 py-2.5 text-sm font-medium text-[var(--chat-action,var(--primary))] outline-none transition-colors focus-visible:bg-foreground/5";

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="-mx-3 -mb-2 mt-0.5 flex flex-col">{children}</div>;
}

function Action({
  icon,
  label,
  onClick,
  href,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}) {
  const inner = (
    <>
      <span className="shrink-0 [&>svg]:size-4">{icon}</span>
      <span className="truncate">{label}</span>
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(action, "hover:bg-foreground/5")}
      >
        {inner}
      </a>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        action,
        disabled ? "cursor-default" : "cursor-pointer hover:bg-foreground/5"
      )}
    >
      {inner}
    </button>
  );
}

const Head = ({ text }: { text?: string }) =>
  text?.trim() ? <p className="font-semibold">{text}</p> : null;

const Body = ({ text }: { text: string }) =>
  text.trim() ? (
    <div className="whitespace-pre-wrap">
      <WhatsAppText text={text} />
    </div>
  ) : null;

const Foot = ({ text }: { text?: string }) =>
  text?.trim() ? (
    <p className="text-xs text-muted-foreground">{text}</p>
  ) : null;

function linkOf(source: { link: string } | { id: string }): string | null {
  return "link" in source ? source.link : null;
}

function extensionOf(name: string): string {
  const clean = name.split(/[?#]/)[0];
  const dot = clean.lastIndexOf(".");
  return dot > -1 && dot > clean.lastIndexOf("/")
    ? clean.slice(dot + 1).toUpperCase().slice(0, 4)
    : "FILE";
}

const EXTENSION_TINT: Record<string, string> = {
  PDF: "bg-red-500",
  DOC: "bg-blue-600",
  DOCX: "bg-blue-600",
  XLS: "bg-emerald-600",
  XLSX: "bg-emerald-600",
  CSV: "bg-emerald-600",
  PPT: "bg-orange-500",
  PPTX: "bg-orange-500",
  ZIP: "bg-amber-600",
};

function ImageViewer({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-label="Photo"
      className="fixed inset-0 z-[60] flex flex-col bg-black/95 duration-200 animate-in fade-in"
      onClick={onClose}
    >
      <div className="flex shrink-0 justify-end p-2">
        <button
          type="button"
          aria-label="Close"
          className="rounded-full p-2 text-white/90 hover:bg-white/10"
          onClick={onClose}
        >
          <XIcon className="size-5" />
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- any host */}
      <img
        src={src}
        alt={alt}
        className="m-auto max-h-[calc(100%-4rem)] max-w-full object-contain p-2"
        onClick={(event) => event.stopPropagation()}
      />
    </div>,
    document.body
  );
}

function Photo({
  url,
  alt,
  meta,
  bleedBottom,
}: {
  url: string;
  alt: string;
  meta?: ChatMeta;
  bleedBottom: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        "relative -mx-2.5 -mt-1.5 overflow-hidden rounded-md",
        bleedBottom && "-mb-1.5"
      )}
    >
      <button
        type="button"
        className="block w-full cursor-zoom-in"
        onClick={() => setOpen(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- any host */}
        <img
          src={url}
          alt={alt}
          loading="lazy"
          className="max-h-80 min-h-24 w-full min-w-56 bg-foreground/5 object-cover"
        />
      </button>
      {bleedBottom ? (
        <>
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-black/40 to-transparent" />
          <MetaStamp meta={meta} mode="overlay" />
        </>
      ) : null}
      {open ? (
        <ImageViewer src={url} alt={alt} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
}

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function VoiceNote({ url }: { url: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  return (
    <div className="flex w-64 max-w-full items-center gap-2.5 py-0.5">
      <div className="relative grid size-11 shrink-0 place-items-center rounded-full bg-[var(--chat-action,var(--primary))]/15 text-[var(--chat-action,var(--primary))]">
        <MicrophoneIcon weight="fill" className="size-5" />
      </div>
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        onClick={toggle}
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
      >
        {playing ? (
          <PauseIcon weight="fill" className="size-6" />
        ) : (
          <PlayIcon weight="fill" className="size-6" />
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-2">
        <input
          type="range"
          aria-label="Seek"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (audio.current) audio.current.currentTime = next;
            setTime(next);
          }}
          className="h-1 w-full cursor-pointer accent-[var(--chat-action,var(--primary))]"
        />
        <span className="text-[0.625rem] text-muted-foreground tabular-nums">
          {clock(playing || time > 0 ? time : duration)}
        </span>
      </div>
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => {
          const d = event.currentTarget.duration;
          setDuration(Number.isFinite(d) ? d : 0);
        }}
        onDurationChange={(event) => {
          const d = event.currentTarget.duration;
          if (Number.isFinite(d)) setDuration(d);
        }}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
      />
    </div>
  );
}

function DocumentTile({ url, filename }: { url: string | null; filename?: string }) {
  let name = filename ?? "";
  if (!name && url) {
    try {
      name = decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() ?? "");
    } catch {
      name = "";
    }
  }
  const ext = extensionOf(name || url || "");
  const tile = (
    <>
      <span className="relative shrink-0">
        <FileTextIcon weight="fill" className="size-9 text-muted-foreground/40" />
        <span
          className={cn(
            "absolute bottom-1 left-1/2 -translate-x-1/2 rounded-[3px] px-0.5 text-[0.5rem] leading-tight font-bold text-white",
            EXTENSION_TINT[ext] ?? "bg-slate-500"
          )}
        >
          {ext}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{name || "Document"}</span>
        <span className="block text-[0.6875rem] text-muted-foreground">{ext}</span>
      </span>
      {url ? (
        <DownloadSimpleIcon className="size-5 shrink-0 text-muted-foreground" />
      ) : null}
    </>
  );
  const className =
    "-mx-1.5 -mt-0.5 flex min-w-56 items-center gap-2.5 rounded-md bg-foreground/5 px-2.5 py-2";
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cn(className, "hover:bg-foreground/8")}>
      {tile}
    </a>
  ) : (
    <div className={className}>{tile}</div>
  );
}

function MapPreview({ latitude, longitude }: { latitude: number; longitude: number }) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 85) {
    return (
      <div className="grid h-36 place-items-center bg-foreground/5">
        <MapPinIcon weight="fill" className="size-8 text-red-500" />
      </div>
    );
  }
  const zoom = 15;
  const n = 2 ** zoom;
  const x = ((longitude + 180) / 360) * n;
  const rad = (latitude * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const TILE = 256;

  return (
    <div className="relative h-36 w-full overflow-hidden bg-foreground/5">
      <div
        className="absolute grid grid-cols-3"
        style={{
          width: TILE * 3,
          left: `calc(50% - ${(1 + x - tx) * TILE}px)`,
          top: `calc(50% - ${(1 + y - ty) * TILE}px)`,
        }}
      >
        {[-1, 0, 1].flatMap((dy) =>
          [-1, 0, 1].map((dx) => (
            // eslint-disable-next-line @next/next/no-img-element -- map tiles
            <img
              key={`${dx}:${dy}`}
              src={`https://tile.openstreetmap.org/${zoom}/${(tx + dx + n) % n}/${ty + dy}.png`}
              alt=""
              loading="lazy"
              width={TILE}
              height={TILE}
              style={{ width: TILE, height: TILE, maxWidth: "none" }}
            />
          ))
        )}
      </div>
      <MapPinIcon
        weight="fill"
        className="absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-full text-red-500 drop-shadow-md"
      />
      <span className="absolute right-1 bottom-0.5 rounded-sm bg-white/70 px-1 text-[0.5rem] text-black/70">
        © OpenStreetMap
      </span>
    </div>
  );
}

function SheetFrame({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="data-[swipe-direction=down]:rounded-t-2xl">
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
        <div className="relative flex shrink-0 items-center justify-center px-12 pt-2 pb-3">
          <DrawerClose
            aria-label="Close"
            className="absolute top-1.5 left-3 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
          >
            <XIcon className="size-5" />
          </DrawerClose>
          <DrawerTitle className="truncate text-base font-semibold">{title}</DrawerTitle>
        </div>
        {children}
      </DrawerContent>
    </Drawer>
  );
}

function ListSheet({
  message,
  open,
  onOpenChange,
  onPick,
}: {
  message: Extract<Outbound, { kind: "list" }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick?: (text: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title={message.buttonText}>
      <div className="relative min-h-0 flex-1 overflow-y-auto pb-20">
        {message.sections.map((section, s) => (
          <div key={`${section.title}-${s}`} className="border-t first:border-t-0">
            {section.title ? (
              <p className="px-5 pt-3 pb-1 text-[0.8125rem] font-medium text-primary">
                {section.title}
              </p>
            ) : null}
            {section.rows.map((row) => {
              const checked = selected === row.id;
              return (
                <label
                  key={row.id}
                  className={cn(
                    "flex items-center gap-3 px-5 py-3",
                    onPick ? "cursor-pointer hover:bg-muted/60" : "cursor-default"
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.9375rem]">{row.title}</span>
                    {row.description ? (
                      <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                        {row.description}
                      </span>
                    ) : null}
                  </span>
                  <input
                    type="radio"
                    name={`list-${message.buttonText}`}
                    className="peer sr-only"
                    disabled={!onPick}
                    checked={checked}
                    onChange={() => setSelected(row.id)}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
                      checked ? "border-primary" : "border-muted-foreground/50"
                    )}
                  >
                    {checked ? <span className="size-2.5 rounded-full bg-primary" /> : null}
                  </span>
                </label>
              );
            })}
          </div>
        ))}
      </div>
      {onPick && selected ? (
        <button
          type="button"
          data-slot="chat-send-fab"
          aria-label="Send"
          className="absolute right-5 bottom-5 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90"
          onClick={() => {
            const row = message.sections
              .flatMap((section) => section.rows)
              .find((r) => r.id === selected);
            if (!row) return;
            onOpenChange(false);
            setSelected(null);
            onPick(row.title);
          }}
        >
          <PaperPlaneRightIcon weight="fill" className="size-6" />
        </button>
      ) : null}
    </SheetFrame>
  );
}

const ADDRESS_FIELDS = [
  { key: "name", label: "Full name", autoComplete: "name", required: true },
  { key: "phone", label: "Phone number", autoComplete: "tel", required: true },
  { key: "house", label: "Flat, house no., building", autoComplete: "address-line1", required: true },
  { key: "street", label: "Area, street, landmark", autoComplete: "address-line2", required: false },
  { key: "city", label: "City", autoComplete: "address-level2", required: true },
  { key: "state", label: "State", autoComplete: "address-level1", required: false },
  { key: "pin", label: "PIN / postcode", autoComplete: "postal-code", required: true },
] as const;

type AddressKey = (typeof ADDRESS_FIELDS)[number]["key"];

function AddressSheet({
  country,
  open,
  onOpenChange,
  onPick,
}: {
  country: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (text: string) => void;
}) {
  const [form, setForm] = useState<Record<AddressKey, string>>({
    name: "",
    phone: "",
    house: "",
    street: "",
    city: "",
    state: "",
    pin: "",
  });
  const ready = ADDRESS_FIELDS.every((f) => !f.required || form[f.key].trim());

  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Address">
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          const v = (k: AddressKey) => form[k].trim();
          const lines = [
            v("name"),
            v("phone"),
            [v("house"), v("street")].filter(Boolean).join(", "),
            [v("city"), v("state"), v("pin")].filter(Boolean).join(", "),
            country,
          ].filter(Boolean);
          onOpenChange(false);
          onPick(`📍 My address:\n${lines.join("\n")}`);
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4">
          {country ? (
            <p className="text-xs text-muted-foreground">Country: {country}</p>
          ) : null}
          {ADDRESS_FIELDS.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <Label htmlFor={`addr-${field.key}`} className="text-xs text-muted-foreground">
                {field.label}
                {field.required ? null : " (optional)"}
              </Label>
              <Input
                id={`addr-${field.key}`}
                autoComplete={field.autoComplete}
                inputMode={field.key === "phone" ? "tel" : undefined}
                className="h-10"
                value={form[field.key]}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, [field.key]: event.target.value }))
                }
              />
            </div>
          ))}
        </div>
        <div className="shrink-0 border-t p-4">
          <button
            type="submit"
            disabled={!ready}
            className="h-11 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
          >
            Send address
          </button>
        </div>
      </form>
    </SheetFrame>
  );
}

function shareLocation(onPick: (text: string) => void) {
  if (!navigator.geolocation) {
    onPick("I cannot share my location from this browser.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) =>
      onPick(
        `📍 My location: ${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}\nhttps://maps.google.com/?q=${position.coords.latitude.toFixed(6)},${position.coords.longitude.toFixed(6)}`
      ),
    () =>
      onPick("I would rather not share my location — I will type the address instead.")
  );
}

function HeaderBlock({
  header,
  meta,
}: {
  header?: Extract<Outbound, { kind: "buttons" }>["header"];
  meta?: ChatMeta;
}) {
  if (!header) return null;
  if (header.type === "text") return <Head text={header.text} />;
  const url = linkOf(header.media);
  if (!url) return null;
  if (header.type === "image") {
    return <Photo url={url} alt="" meta={meta} bleedBottom={false} />;
  }
  if (header.type === "video") {
    return (
      <video
        src={url}
        controls
        playsInline
        preload="metadata"
        className="-mx-2.5 -mt-1.5 max-h-72 w-[calc(100%+1.25rem)] max-w-none rounded-md bg-black"
      />
    );
  }
  return <DocumentTile url={url} filename={header.filename} />;
}

export function RichMessage({
  message,
  onPick,
  interactive = true,
  meta,
}: {
  message: Outbound;
  /** Called with the label when the customer taps a button or a list row. */
  onPick?: (text: string) => void;
  interactive?: boolean;
  /** The time and ticks, placed where WhatsApp puts them for this kind. */
  meta?: ChatMeta;
}) {
  const [sheet, setSheet] = useState(false);
  const live = interactive && onPick ? onPick : undefined;
  const pick = (label: string) => () => live?.(label);

  switch (message.kind) {
    case "text":
    case "template": {
      const text =
        message.kind === "text"
          ? message.body
          : (message.preview ?? `[${message.templateName}]`);
      return (
        <div className="whitespace-pre-wrap">
          <WhatsAppText text={text}>
            <MetaSpacer meta={meta} />
          </WhatsAppText>
          <MetaStamp meta={meta} mode="pin" />
        </div>
      );
    }

    case "media": {
      const url = linkOf(message.source);
      const caption = message.caption?.trim();
      if (message.media === "image" && url) {
        return (
          <div className="flex flex-col gap-1">
            <Photo url={url} alt={caption ?? ""} meta={meta} bleedBottom={!caption} />
            {caption ? (
              <>
                <Body text={caption} />
                <MetaStamp meta={meta} />
              </>
            ) : null}
          </div>
        );
      }
      return (
        <div className="flex flex-col gap-1">
          {!url ? (
            <p className="text-sm text-muted-foreground italic">
              [{message.media} attachment]
            </p>
          ) : message.media === "video" ? (
            <video
              src={url}
              controls
              playsInline
              preload="metadata"
              className="-mx-2.5 -mt-1.5 max-h-72 w-[calc(100%+1.25rem)] max-w-none rounded-md bg-black"
            />
          ) : message.media === "audio" ? (
            <VoiceNote url={url} />
          ) : (
            <DocumentTile url={url} filename={message.filename} />
          )}
          <Body text={caption ?? ""} />
          <MetaStamp meta={meta} />
        </div>
      );
    }

    case "buttons":
      return (
        <div className="flex min-w-60 flex-col gap-1">
          <HeaderBlock header={message.header} meta={meta} />
          <Body text={message.body} />
          <Foot text={message.footer} />
          <MetaStamp meta={meta} />
          <Actions>
            {message.buttons.map((button) => (
              <Action
                key={button.id}
                icon={<ArrowBendUpLeftIcon weight="bold" />}
                label={button.title}
                onClick={pick(button.title)}
                disabled={!live}
              />
            ))}
          </Actions>
        </div>
      );

    case "list":
      return (
        <div className="flex min-w-60 flex-col gap-1">
          <HeaderBlock header={message.header} meta={meta} />
          <Body text={message.body} />
          <Foot text={message.footer} />
          <MetaStamp meta={meta} />
          <Actions>
            <Action
              icon={<ListBulletsIcon weight="bold" />}
              label={message.buttonText}
              onClick={() => setSheet(true)}
            />
          </Actions>
          <ListSheet
            message={message}
            open={sheet}
            onOpenChange={setSheet}
            onPick={live}
          />
        </div>
      );

    case "cta_url":
      return (
        <div className="flex min-w-60 flex-col gap-1">
          <HeaderBlock header={message.header} meta={meta} />
          <Body text={message.body} />
          <Foot text={message.footer} />
          <MetaStamp meta={meta} />
          <Actions>
            <Action
              icon={<ArrowSquareOutIcon weight="bold" />}
              label={message.displayText}
              href={message.url}
            />
          </Actions>
        </div>
      );

    case "location": {
      const href = `https://www.google.com/maps/search/?api=1&query=${message.latitude},${message.longitude}`;
      return (
        <div className="flex min-w-60 flex-col gap-1">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="-mx-2.5 -mt-1.5 block overflow-hidden rounded-md"
          >
            <MapPreview latitude={message.latitude} longitude={message.longitude} />
          </a>
          {message.name || message.address ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="block pt-0.5">
              {message.name ? (
                <span className="block font-medium text-[var(--chat-action,var(--primary))]">
                  {message.name}
                </span>
              ) : null}
              {message.address ? (
                <span className="block text-xs text-muted-foreground">{message.address}</span>
              ) : null}
            </a>
          ) : null}
          <MetaStamp meta={meta} />
        </div>
      );
    }

    case "contacts":
      return (
        <div className="flex min-w-60 flex-col gap-1">
          {message.contacts.map((contact, index) => {
            const phone = contact.phones?.[0];
            const email = contact.emails?.[0];
            const digits = (phone?.waId ?? phone?.phone ?? "").replace(/\D/g, "");
            return (
              <div key={`${contact.formattedName}-${index}`} className="flex flex-col">
                <div className="flex items-center gap-3 py-1">
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-muted-foreground/20 text-muted-foreground">
                    <UserIcon weight="fill" className="size-6" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{contact.formattedName}</span>
                    {contact.org?.company || contact.org?.title ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {[contact.org?.title, contact.org?.company].filter(Boolean).join(" · ")}
                      </span>
                    ) : phone ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {phone.phone}
                      </span>
                    ) : null}
                  </span>
                </div>
                {index === message.contacts.length - 1 ? <MetaStamp meta={meta} /> : null}
                {phone || email ? (
                  <div className="-mx-3 mt-0.5 flex [&>*+*]:border-l">
                    {digits ? (
                      <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" className={cn(action, "hover:bg-foreground/5")}>
                        <ChatCircleTextIcon weight="bold" className="size-4" /> Message
                      </a>
                    ) : null}
                    {phone ? (
                      <a href={`tel:${phone.phone}`} className={cn(action, "hover:bg-foreground/5")}>
                        <PhoneIcon weight="bold" className="size-4" /> Call
                      </a>
                    ) : email ? (
                      <a href={`mailto:${email.email}`} className={cn(action, "hover:bg-foreground/5")}>
                        <EnvelopeIcon weight="bold" className="size-4" /> Email
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      );

    case "request_location":
      return (
        <div className="flex min-w-60 flex-col gap-1">
          <Body text={message.body} />
          <MetaStamp meta={meta} />
          <Actions>
            <Action
              icon={<MapPinIcon weight="bold" />}
              label="Send location"
              disabled={!live}
              onClick={() => live && shareLocation(live)}
            />
          </Actions>
        </div>
      );

    case "request_address":
      return (
        <div className="flex min-w-60 flex-col gap-1">
          <Body text={message.body} />
          <MetaStamp meta={meta} />
          <Actions>
            <Action
              icon={<MapPinIcon weight="bold" />}
              label="Send address"
              disabled={!live}
              onClick={() => setSheet(true)}
            />
          </Actions>
          {live ? (
            <AddressSheet
              country={message.country}
              open={sheet}
              onOpenChange={setSheet}
              onPick={live}
            />
          ) : null}
        </div>
      );

    case "flow":
      return (
        <div className="flex min-w-60 flex-col gap-1">
          <HeaderBlock header={message.header} meta={meta} />
          <Body text={message.body} />
          <Foot text={message.footer} />
          <MetaStamp meta={meta} />
          <Actions>
            <Action icon={<FileTextIcon weight="bold" />} label={message.flowCta} disabled />
          </Actions>
          {live ? (
            <p className="pt-1.5 text-center text-[0.6875rem] text-muted-foreground">
              Reply here with the details.
            </p>
          ) : null}
        </div>
      );

    case "carousel":
      return (
        <div className="flex flex-col gap-1">
          {message.bodyVariables?.length ? (
            <Body text={message.bodyVariables.join(" · ")} />
          ) : null}
          <div className="-mx-2.5 flex snap-x snap-mandatory gap-2 overflow-x-auto px-0.5 pb-1">
            {message.cards.map((cardData, index) => (
              <div
                key={index}
                className="w-52 shrink-0 snap-start overflow-hidden rounded-md border border-foreground/10 bg-background"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- any host */}
                <img
                  src={cardData.imageLink}
                  alt=""
                  loading="lazy"
                  className="h-32 w-full bg-foreground/5 object-cover"
                />
                {cardData.bodyVariables?.length ? (
                  <p className="px-2.5 py-2 text-sm">{cardData.bodyVariables.join(" · ")}</p>
                ) : null}
                {cardData.quickReplyPayload ? (
                  <button
                    type="button"
                    disabled={!live}
                    onClick={pick(cardData.quickReplyPayload)}
                    className={cn(action, live ? "cursor-pointer hover:bg-foreground/5" : "cursor-default")}
                  >
                    <ArrowBendUpLeftIcon weight="bold" className="size-4" />
                    <span className="truncate">{cardData.quickReplyPayload}</span>
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <MetaStamp meta={meta} />
        </div>
      );

    case "product":
    case "product_list":
    case "catalog":
      return (
        <div className="flex min-w-60 flex-col gap-1">
          <Body text={message.body} />
          <Foot text={"footer" in message ? message.footer : undefined} />
          <MetaStamp meta={meta} />
          <Actions>
            <Action
              icon={<StorefrontIcon weight="bold" />}
              label={message.kind === "product" ? "View item" : "View catalogue"}
              disabled
            />
          </Actions>
          <p className="pt-1.5 text-center text-[0.6875rem] text-muted-foreground">
            The catalogue opens in WhatsApp.
          </p>
        </div>
      );

    case "reaction":
      return (
        <div className="flex flex-col items-end gap-1">
          <p className="text-3xl leading-none">{message.emoji}</p>
          <MetaStamp meta={meta} />
        </div>
      );
  }
}
