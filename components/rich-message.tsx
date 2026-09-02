"use client";

import type { Outbound } from "@/convex/lib/whatsappSend";
import { cn } from "@/lib/utils";
import {
  MapPinIcon,
  FileTextIcon,
  UserCircleIcon,
  ArrowSquareOutIcon,
  ListIcon,
  PhoneIcon,
  EnvelopeIcon,
  CrosshairIcon,
} from "@phosphor-icons/react";

/**
 * Renders the rich half of a message — buttons, a list, media, a pin, a card.
 *
 * Shared between the website chat and the console transcript on purpose: the
 * team reading a conversation weeks later should see the menu the customer was
 * shown, not a line of prose describing it. `interactive` is what separates the
 * two — in the console the controls are inert, because clicking a button in a
 * transcript must not answer on the customer's behalf.
 *
 * Everything is drawn with the app's own tokens rather than fixed colours, so
 * the same component takes the WhatsApp palette inside the widget (which sets
 * those tokens) and the console palette in the dashboard.
 */

export function parseRichPayload(
  payload: string | null | undefined
): Outbound | null {
  if (!payload) return null;
  try {
    return JSON.parse(payload) as Outbound;
  } catch {
    // A payload we cannot read is not worth breaking the transcript over; the
    // message's own summary text is rendered above it either way.
    return null;
  }
}

const card =
  "rounded-lg border border-foreground/10 bg-background/60 overflow-hidden";

function Tappable({
  label,
  hint,
  icon,
  onPick,
  disabled,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  onPick?: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/30 px-3 py-2 text-sm font-medium text-primary transition-colors",
        disabled
          ? "cursor-default opacity-70"
          : "cursor-pointer hover:bg-primary/10"
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      {hint ? (
        <span className="truncate text-xs font-normal opacity-70">{hint}</span>
      ) : null}
    </button>
  );
}

function Media({ message }: { message: Extract<Outbound, { kind: "media" }> }) {
  // Only a link can be rendered. A media id is a handle inside the provider's
  // storage, so a message sent that way shows its caption and nothing else.
  const url = "link" in message.source ? message.source.link : null;

  if (!url) {
    return (
      <div className={cn(card, "px-3 py-2 text-sm text-muted-foreground")}>
        [{message.media} attachment]
      </div>
    );
  }

  if (message.media === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={cn(card, "block")}>
        {/* A remote URL from the agent, so next/image would need the host
            pre-declared in next.config — the same reason product images use a
            plain img. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={message.caption ?? ""}
          className="max-h-72 w-full object-cover"
        />
      </a>
    );
  }

  if (message.media === "video") {
    return <video src={url} controls className={cn(card, "max-h-72 w-full")} />;
  }

  if (message.media === "audio") {
    return <audio src={url} controls className="w-full" />;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(card, "flex items-center gap-2 px-3 py-2 text-sm")}
    >
      <FileTextIcon className="size-5 shrink-0 text-muted-foreground" />
      <span className="truncate">{message.filename ?? "Document"}</span>
      <ArrowSquareOutIcon className="ml-auto size-4 shrink-0 opacity-60" />
    </a>
  );
}

const Head = ({ text }: { text?: string }) =>
  text?.trim() ? <p className="text-sm font-medium">{text}</p> : null;

const Body = ({ text }: { text: string }) => (
  <p className="text-sm whitespace-pre-wrap">{text}</p>
);

const Foot = ({ text }: { text?: string }) =>
  text?.trim() ? <p className="text-xs text-muted-foreground">{text}</p> : null;

export function RichMessage({
  message,
  onPick,
  interactive = true,
}: {
  message: Outbound;
  /** Called with the label when the customer taps a button or a list row. */
  onPick?: (text: string) => void;
  interactive?: boolean;
}) {
  const inert = !interactive || !onPick;
  const pick = (label: string) => () => onPick?.(label);

  switch (message.kind) {
    case "text":
      return <Body text={message.body} />;

    case "media":
      return (
        <div className="flex flex-col gap-1.5">
          <Media message={message} />
          {message.caption ? <Body text={message.caption} /> : null}
        </div>
      );

    case "buttons":
      return (
        <div className="flex flex-col gap-2">
          {message.header?.type === "image" && "link" in message.header.media ? (
            <Media
              message={{
                kind: "media",
                media: "image",
                source: message.header.media,
              }}
            />
          ) : message.header?.type === "text" ? (
            <Head text={message.header.text} />
          ) : null}
          <Body text={message.body} />
          <Foot text={message.footer} />
          <div className="flex flex-col gap-1.5 border-t border-foreground/10 pt-2">
            {message.buttons.map((button) => (
              <Tappable
                key={button.id}
                label={button.title}
                onPick={pick(button.title)}
                disabled={inert}
              />
            ))}
          </div>
        </div>
      );

    case "list":
      return (
        <div className="flex flex-col gap-2">
          {message.header?.type === "text" ? (
            <Head text={message.header.text} />
          ) : null}
          <Body text={message.body} />
          <Foot text={message.footer} />
          {/* WhatsApp hides these behind a sheet the button opens. Inline is
              better here: the chat panel is 400px of a host page, and a nested
              overlay inside an iframe is a worse place to make a choice. */}
          <div className="flex flex-col gap-2 border-t border-foreground/10 pt-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ListIcon className="size-3.5" /> {message.buttonText}
            </p>
            {message.sections.map((section) => (
              <div key={section.title} className="flex flex-col gap-1">
                {message.sections.length > 1 ? (
                  <p className="text-xs font-medium text-muted-foreground">
                    {section.title}
                  </p>
                ) : null}
                {section.rows.map((row) => (
                  <Tappable
                    key={row.id}
                    label={row.title}
                    hint={row.description}
                    onPick={pick(row.title)}
                    disabled={inert}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      );

    case "cta_url":
      return (
        <div className="flex flex-col gap-2">
          <Body text={message.body} />
          <Foot text={message.footer} />
          <a
            href={message.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-lg border border-primary/30 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
          >
            <ArrowSquareOutIcon className="size-4" /> {message.displayText}
          </a>
        </div>
      );

    case "location":
      return (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${message.latitude},${message.longitude}`}
          target="_blank"
          rel="noreferrer"
          className={cn(card, "flex items-center gap-2 px-3 py-2 text-sm")}
        >
          <MapPinIcon className="size-5 shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block truncate font-medium">
              {message.name ?? "Location"}
            </span>
            {message.address ? (
              <span className="block truncate text-xs text-muted-foreground">
                {message.address}
              </span>
            ) : null}
          </span>
          <ArrowSquareOutIcon className="ml-auto size-4 shrink-0 opacity-60" />
        </a>
      );

    case "contacts":
      return (
        <div className="flex flex-col gap-1.5">
          {message.contacts.map((contact) => (
            <div
              key={contact.formattedName}
              className={cn(card, "flex flex-col gap-1 px-3 py-2 text-sm")}
            >
              <span className="flex items-center gap-2 font-medium">
                <UserCircleIcon className="size-5 shrink-0 text-muted-foreground" />
                <span className="truncate">{contact.formattedName}</span>
              </span>
              {contact.org?.company || contact.org?.title ? (
                <span className="truncate text-xs text-muted-foreground">
                  {[contact.org?.title, contact.org?.company]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
              {/* tel: and mailto: so a phone actually dials, which is the whole
                  reason to send a card instead of typing the digits. */}
              {contact.phones?.map((phone) => (
                <a
                  key={phone.phone}
                  href={`tel:${phone.phone}`}
                  className="flex items-center gap-1.5 text-primary"
                >
                  <PhoneIcon className="size-3.5" /> {phone.phone}
                </a>
              ))}
              {contact.emails?.map((email) => (
                <a
                  key={email.email}
                  href={`mailto:${email.email}`}
                  className="flex items-center gap-1.5 truncate text-primary"
                >
                  <EnvelopeIcon className="size-3.5 shrink-0" /> {email.email}
                </a>
              ))}
            </div>
          ))}
        </div>
      );

    case "request_location":
      return (
        <div className="flex flex-col gap-2">
          <Body text={message.body} />
          {/* WhatsApp opens its own map picker. In a browser the equivalent is
              the geolocation permission prompt, and the coordinates go back as
              the visitor's next message — so the agent reads them the same way
              on both channels. Declining just leaves the composer, which is
              why this is a button and not a blocker. */}
          <Tappable
            label="Share my location"
            icon={<CrosshairIcon className="size-4" />}
            disabled={inert}
            onPick={() => {
              if (!navigator.geolocation) {
                onPick?.("I cannot share my location from this browser.");
                return;
              }
              navigator.geolocation.getCurrentPosition(
                (position) =>
                  onPick?.(
                    `My location: ${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`
                  ),
                () =>
                  onPick?.(
                    "I would rather not share my location — I will type the address instead."
                  )
              );
            }}
          />
        </div>
      );

    case "request_address":
    case "flow":
      // Both are native WhatsApp forms with no browser equivalent worth faking:
      // a hand-rolled address form here would collect fields the agent has not
      // asked for. The body already says what is needed, so the visitor types
      // it and the composer is right there.
      return (
        <div className="flex flex-col gap-1.5">
          <Body text={message.body} />
          {/* Only the flow variant carries one. */}
          <Foot text={"footer" in message ? message.footer : undefined} />
        </div>
      );

    case "carousel":
      return (
        <div className="flex flex-col gap-2">
          {/* One card per swipe on WhatsApp; a horizontal scroller here, which
              is the same gesture. Scrolls inside its own track so the chat
              panel itself never moves sideways. */}
          <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1">
            {message.cards.map((cardData, index) => (
              <div
                key={index}
                className={cn(card, "w-44 shrink-0 snap-start")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cardData.imageLink}
                  alt=""
                  className="h-28 w-full object-cover"
                />
                {cardData.bodyVariables?.length ? (
                  <p className="px-2 py-1.5 text-xs">
                    {cardData.bodyVariables.join(" · ")}
                  </p>
                ) : null}
                {cardData.quickReplyPayload ? (
                  <div className="px-2 pb-2">
                    <Tappable
                      label={cardData.quickReplyPayload}
                      disabled={inert}
                      onPick={pick(cardData.quickReplyPayload)}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      );

    case "product":
    case "product_list":
    case "catalog":
      // The payload carries catalogue and retailer ids, not names or prices —
      // WhatsApp resolves those against the Meta catalogue on the way out.
      // There is nothing to resolve them against in a browser, so this shows
      // the body and says plainly where the products live.
      return (
        <div className="flex flex-col gap-1.5">
          <Body text={message.body} />
          <p className="text-xs text-muted-foreground">
            The catalogue opens in WhatsApp.
          </p>
        </div>
      );

    case "reaction":
      return <p className="text-lg">{message.emoji}</p>;
  }
}
