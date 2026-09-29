import Image from "next/image";
import magicFormsMark from "@/public/images/integrations/magic-forms.png";
import magicRewardMark from "@/public/images/integrations/magic-reward.png";
import { cn } from "@/lib/utils";

/**
 * The Magic apps' own marks, as each app ships them.
 *
 * Files rather than inline SVG like the Google icons beside them: these are
 * raster artwork — the Reward wheel is shaded and lit — with no vector master
 * to inline. Copied down to 256px from each app's `logo-mark.png`, and
 * next/image serves the size a 32px slot actually needs.
 *
 * Decorative: every slot puts the app's name right beside the mark.
 */

type IconProps = { className?: string };

function Mark({
  src,
  className,
}: IconProps & { src: typeof magicFormsMark }) {
  return (
    <Image
      src={src}
      alt=""
      // These size the srcSet, not the layout — the class does that. 64 gives
      // a 64w/128w pair, which covers size-8 on a 3x display.
      width={64}
      height={64}
      className={cn("object-contain", className)}
    />
  );
}

export function MagicFormsIcon({ className }: IconProps) {
  return <Mark src={magicFormsMark} className={className} />;
}

export function MagicRewardIcon({ className }: IconProps) {
  return <Mark src={magicRewardMark} className={className} />;
}
