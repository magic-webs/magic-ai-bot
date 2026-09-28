/* eslint-disable @next/next/no-img-element -- a company logo can live on any
   host, which next/image would need declared in next.config — the same reason
   components/product-images.tsx draws a plain <img>. */
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

/**
 * A workspace's mark in a square tile: the company's own logo when it has one,
 * otherwise the Magic Agent mark it has always shown.
 *
 * The logo is contained, never cropped. Company logos arrive in every shape —
 * a wide wordmark, a square badge, a circle — and cropping a wordmark to a
 * square leaves the middle three letters.
 */
export function CompanyLogo({
  src,
  className,
  alt = "",
}: {
  src: string | null | undefined;
  /** Sizes the tile. Defaults to the sidebar's 32px. */
  className?: string;
  /** Empty by default: every slot puts the company name beside it in text. */
  alt?: string;
}) {
  return (
    <div
      className={cn(
        "flex aspect-square size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-card ring-1 ring-sidebar-border",
        className
      )}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          className="size-full object-contain p-0.5"
          referrerPolicy="no-referrer"
        />
      ) : (
        <Logo className="h-[45%] w-auto" alt={alt} />
      )}
    </div>
  );
}
