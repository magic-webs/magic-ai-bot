import Image from "next/image";
import logoMark from "@/public/images/logo.png";
import { cn } from "@/lib/utils";

/**
 * The Magic Agent mark.
 *
 * Shown on the page ground, not in a filled tile: the mark is a teal and grey
 * M on transparency, and a `bg-primary` tile would sit a close green behind
 * the teal arm and muddy it.
 *
 * Size it by height. `w-auto` alongside keeps the artwork's 1142:636 ratio,
 * and stops next/image warning about one dimension being overridden without
 * the other. The mark is nearly twice as wide as it is tall, so a square box
 * like `size-6` letterboxes it to half its height.
 *
 * next/image rather than a plain <img>, unlike components/product-images.tsx:
 * that one carries whatever host a company keeps its product shots on, which
 * next.config would have to declare. This is a local asset, and the source is
 * 1142px wide for a mark drawn at 43 — Next serves a resized, modern-format
 * copy instead of the full file.
 */
export function Logo({
  className,
  alt = "",
}: {
  className?: string;
  /**
   * Empty by default, and correct: every slot places the mark immediately
   * beside the product or workspace name in real text, so naming it again
   * would only make a screen reader say it twice.
   */
  alt?: string;
}) {
  return (
    <Image
      src={logoMark}
      alt={alt}
      // These size the srcSet, not the layout — the classes below do that.
      // Without them next/image reads the artwork's intrinsic 1142px as the
      // display width and hands the browser 1920w and 3840w renders of a mark
      // drawn at 43. 64x36 holds the 1142:636 ratio and yields a 64w/128w
      // pair, which covers h-6 even on a 3x display.
      width={64}
      height={36}
      // In the first paint of every shell it appears in, so never lazy.
      priority
      className={cn("h-6 w-auto object-contain", className)}
    />
  );
}
