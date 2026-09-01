import Image from "next/image";
import logoMark from "@/public/images/logo.png";
import { cn } from "@/lib/utils";

/**
 * The Magic AI Bot mark.
 *
 * Shown on the page ground, not in a filled tile: the mark is a green outline
 * on transparency, and the brand tiles it replaced were `bg-primary` — the
 * mark's own colour, which would have swallowed it.
 *
 * Size it by height. `w-auto` alongside keeps the artwork's 1332:1181 ratio,
 * and stops next/image warning about one dimension being overridden without
 * the other.
 *
 * next/image rather than a plain <img>, unlike components/product-images.tsx:
 * that one carries whatever host a company keeps its product shots on, which
 * next.config would have to declare. This is a local asset, and the source is
 * 1332px wide for a mark drawn at 24 — Next serves a resized, modern-format
 * copy instead of half a megabyte.
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
      // Without them next/image reads the artwork's intrinsic 1332px as the
      // display width and hands the browser 1920w and 3840w renders of a mark
      // drawn at 28. 36x32 holds the 1332:1181 ratio and yields a 48w/96w
      // pair, which covers h-7 even on a 3x display.
      width={36}
      height={32}
      // In the first paint of every shell it appears in, so never lazy.
      priority
      className={cn("h-6 w-auto object-contain", className)}
    />
  );
}
