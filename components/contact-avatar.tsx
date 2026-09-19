import { GlobeIcon, UserIcon } from "@phosphor-icons/react";
import { TeamAvatar } from "@/components/team-avatar";
import { cn } from "@/lib/utils";

/**
 * The person on the other end of a thread.
 *
 * Three cases, and they want different pictures. Somebody who left a name gets
 * initials on a tinted circle — the same treatment a colleague gets, because
 * they are equally a person. A web visitor has no name at all: the label is an
 * auto-generated session id, and "WE" on a coloured circle is a worse answer
 * than saying plainly that this is a browser. A WhatsApp number with no name
 * against it is the third: initials of "+91 82491 59831" come out as "+5",
 * which looks like a bug rather than a person.
 */

/** An unclaimed web session, as opposed to a visitor who left a name. */
export function isAnonymousSession(
  label: string,
  channelType: "whatsapp" | "web"
): boolean {
  return channelType === "web" && /^web-[a-z0-9]+$/i.test(label);
}

function Glyph({
  size,
  className,
  children,
}: {
  size: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
        className
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {children}
    </span>
  );
}

export function ContactAvatar({
  label,
  channelType,
  size = 40,
  className,
}: {
  /** The raw contact label, before `Web visitor abcd` is made of it. */
  label: string;
  channelType: "whatsapp" | "web";
  size?: number;
  className?: string;
}) {
  if (isAnonymousSession(label, channelType)) {
    return (
      <Glyph size={size} className={className}>
        <GlobeIcon style={{ width: size * 0.5, height: size * 0.5 }} />
      </Glyph>
    );
  }

  // A phone number, an id, anything with no letters in it to take an initial
  // from.
  if (!/\p{L}/u.test(label)) {
    return (
      <Glyph size={size} className={className}>
        <UserIcon style={{ width: size * 0.5, height: size * 0.5 }} />
      </Glyph>
    );
  }

  return <TeamAvatar name={label} size={size} className={className} />;
}
