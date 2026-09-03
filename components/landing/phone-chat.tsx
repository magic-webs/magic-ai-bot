import {
  BatteryFullIcon,
  CameraIcon,
  CaretLeftIcon,
  CellSignalFullIcon,
  ChecksIcon,
  MicrophoneIcon,
  PaperclipIcon,
  PhoneIcon,
  SmileyIcon,
  StorefrontIcon,
  VideoCameraIcon,
  WifiHighIcon,
} from "@phosphor-icons/react/dist/ssr";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";

/**
 * The hero's proof: a real exchange, on a phone, in WhatsApp.
 *
 * The chat itself is not a drawing of WhatsApp — it is the same Bubble and
 * Message components the product ships, under the same `data-chat="whatsapp"`
 * skin the widget and the console use. So the wallpaper, the clipped bubble
 * corners and the floated timestamps all come from one definition in
 * globals.css, and a change to how the product looks changes the landing page
 * with it. Only the handset around it is decoration.
 *
 * A server component. Nothing here moves, so none of it needs to ship as
 * JavaScript — the Reveal wrapper in the page supplies the one animation.
 */

/* WhatsApp sets its messages smaller and tighter than the console does, and a
   300px-wide handset exaggerates anything left at the default text-sm. */
const BUBBLE = "px-2.5 py-1.5 text-[12.5px] leading-snug";

/* The read receipt. WhatsApp's blue is a fixed brand colour rather than a
   theme token — this is a picture of their client, not of ours. */
function ReadTicks() {
  return <ChecksIcon className="size-3 shrink-0 text-[#53bdeb]" />;
}

function Sent({ children, time }: { children: React.ReactNode; time: string }) {
  return (
    <Message align="end">
      <MessageContent>
        <Bubble variant="tinted" align="end">
          <BubbleContent className={BUBBLE}>
            {/* Before the text, not after: it is floated, so the last line
                wraps around it the way WhatsApp's does. */}
            <span data-slot="chat-time" className="flex items-center gap-0.5">
              {time}
              <ReadTicks />
            </span>
            {children}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

function Received({
  children,
  time,
}: {
  children: React.ReactNode;
  time: string;
}) {
  return (
    <Message align="start">
      <MessageContent>
        <Bubble variant="outline">
          <BubbleContent className={BUBBLE}>
            <span data-slot="chat-time">{time}</span>
            {children}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

export function PhoneChat({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="relative mx-auto w-[272px] sm:w-[300px]">
        {/* The rails. Drawn outside the bezel so the handset reads as an
            object rather than a rounded rectangle. */}
        <span
          aria-hidden
          className="absolute top-[14%] -left-[3px] h-[4%] w-[3px] rounded-l-sm bg-neutral-400 dark:bg-neutral-700"
        />
        <span
          aria-hidden
          className="absolute top-[21%] -left-[3px] h-[7%] w-[3px] rounded-l-sm bg-neutral-400 dark:bg-neutral-700"
        />
        <span
          aria-hidden
          className="absolute top-[30%] -left-[3px] h-[7%] w-[3px] rounded-l-sm bg-neutral-400 dark:bg-neutral-700"
        />
        <span
          aria-hidden
          className="absolute top-[24%] -right-[3px] h-[10%] w-[3px] rounded-r-sm bg-neutral-400 dark:bg-neutral-700"
        />

        {/* Bezel: a band of titanium, then the black surround, then glass. */}
        <div className="relative rounded-[3.1rem] bg-gradient-to-b from-neutral-300 via-neutral-400 to-neutral-300 p-[3px] shadow-2xl ring-1 ring-foreground/10 dark:from-neutral-700 dark:via-neutral-800 dark:to-neutral-700">
          <div className="rounded-[2.95rem] bg-neutral-950 p-[9px]">
            <div
              data-chat="whatsapp"
              className="relative flex aspect-[9/19.5] flex-col overflow-hidden rounded-[2.5rem] bg-card"
            >
              {/* Dynamic Island, over the status bar and under nothing. */}
              <span
                aria-hidden
                className="absolute top-[9px] left-1/2 z-20 h-[20px] w-[76px] -translate-x-1/2 rounded-full bg-neutral-950"
              />

              <div
                aria-hidden
                className="flex shrink-0 items-center justify-between px-5 pt-3.5 pb-1 text-[10px] font-semibold"
              >
                <span>9:41</span>
                <span className="flex items-center gap-1">
                  <CellSignalFullIcon className="size-3" />
                  <WifiHighIcon className="size-3" />
                  <BatteryFullIcon className="size-3.5" />
                </span>
              </div>

              {/* Conversation header. iOS puts the chevron and the contact on
                  the left and the call buttons on the right. */}
              <div className="flex shrink-0 items-center gap-2 border-b px-2.5 py-1.5">
                <CaretLeftIcon
                  aria-hidden
                  className="size-4 shrink-0 text-primary"
                />
                <span
                  aria-hidden
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                >
                  <StorefrontIcon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] leading-tight font-semibold">
                    Northside Print Co.
                  </span>
                  <span className="block truncate text-[9.5px] leading-tight text-muted-foreground">
                    online
                  </span>
                </span>
                <VideoCameraIcon
                  aria-hidden
                  className="size-4 shrink-0 text-primary"
                />
                <PhoneIcon
                  aria-hidden
                  className="size-4 shrink-0 text-primary"
                />
              </div>

              {/* The wallpaper hangs off this slot in the skin. justify-end
                  anchors the thread to the composer, as WhatsApp does. */}
              <div
                data-slot="message-scroller-viewport"
                className="flex min-h-0 flex-1 flex-col justify-end gap-1.5 px-2 py-2.5"
              >
                <span
                  aria-hidden
                  className="mx-auto mb-1 rounded-md bg-background/80 px-2 py-0.5 text-[8.5px] font-medium tracking-wide text-muted-foreground uppercase shadow-sm"
                >
                  Today
                </span>
                <Sent time="12:04">
                  do you do 500 tote bags, printed both sides?
                </Sent>
                <Received time="12:04">
                  We do. 500 is above our minimum, and both sides is a
                  two-colour setup. What size bag, and do you have the artwork
                  ready?
                </Received>
                <Sent time="12:06">artwork yes, size no idea</Sent>
                <Received time="12:06">
                  Standard is 38×42cm, which suits most artwork. I have noted it
                  — Priya will confirm your file this afternoon.
                </Received>
              </div>

              <div
                aria-hidden
                className="flex shrink-0 items-center gap-1.5 px-2 pt-1.5 pb-1"
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border bg-background px-2.5 py-1.5">
                  <SmileyIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-[11px] text-muted-foreground">
                    Message
                  </span>
                  <PaperclipIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                  <CameraIcon className="size-3.5 shrink-0 text-muted-foreground" />
                </span>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <MicrophoneIcon className="size-3.5" />
                </span>
              </div>

              <div aria-hidden className="flex shrink-0 justify-center pb-1.5">
                <span className="h-[3px] w-[88px] rounded-full bg-foreground/25" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
