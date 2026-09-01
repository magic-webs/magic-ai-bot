import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/**
 * The tab icon, rendered from the brand mark rather than served as it is.
 *
 * public/images/logo.png is 1332x1181 and half a megabyte — right for a page
 * asset, far too heavy for the one file every tab load fetches. Emitting a 64px
 * PNG here keeps it in the low kilobytes, and squares up a mark that is
 * slightly wider than it is tall so the icon is not lopsided in the tab strip.
 *
 * Transparent ground on purpose: browser chrome is light or dark depending on
 * the theme, and the mark reads on both.
 */
const mark = readFileSync(join(process.cwd(), "public/images/logo.png"));
const markUri = `data:image/png;base64,${mark.toString("base64")}`;

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Near full-bleed, which is what a 16px favicon needs: 60x53 holds the
            1332:1181 ratio inside a 64px square. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={markUri} width={60} height={53} alt="" />
      </div>
    ),
    { ...size }
  );
}
