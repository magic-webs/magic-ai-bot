import Link from "next/link";
import { Logo } from "@/components/logo";

/**
 * The public, linkable pages.
 *
 * These exist because an app listing has to point at them: Google Play will
 * not accept a submission without a privacy policy URL, and an app that has
 * accounts also needs a reachable way to delete one. They are deliberately
 * plain — no smooth scrolling, no reveal animations — because the audience is
 * a reviewer checking a box and a customer looking for an answer.
 */

const LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/support", label: "Support" },
  { href: "/delete-account", label: "Delete account" },
];

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <Logo className="size-6" />
            <span className="font-heading text-sm font-semibold">
              Magic Agent
            </span>
          </Link>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        {children}
      </main>

      <footer className="border-t">
        <div className="mx-auto w-full max-w-3xl px-6 py-6 text-sm text-muted-foreground">
          © {new Date().getFullYear()} Magic Agent.{" "}
          <Link href="/" className="hover:text-foreground">
            magicagent.ai
          </Link>
        </div>
      </footer>
    </div>
  );
}
