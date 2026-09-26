import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * The home-screen icon.
 *
 * Unlike the tab icon this one is grounded in white. iOS composites a
 * transparent apple-touch-icon onto black on several versions, and the mark's
 * eyes are near-black navy — on black they disappear and the M loses its face.
 * Apple also crops and rounds the corners itself, so the artwork is inset
 * rather than full-bleed.
 */
const mark = readFileSync(join(process.cwd(), "public/images/logo.png"));
const markUri = `data:image/png;base64,${mark.toString("base64")}`;

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
        }}
      >
        {/* 80% of the frame across, 144x80 at the artwork's 1142:636. The mark
            is wide, so its width is what sets the inset; any narrower and it
            reads as a small glyph adrift in a white square. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={markUri} width={144} height={80} alt="" />
      </div>
    ),
    { ...size }
  );
}
