"use client";

import "./globals.css";
import { RouteError } from "@/components/route-error";
import { APPEARANCE_SCRIPT } from "@/lib/appearance";

export default function GlobalError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <title>Something went wrong</title>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <RouteError {...props} />
      </body>
    </html>
  );
}
