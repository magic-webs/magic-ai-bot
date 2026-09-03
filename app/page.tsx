import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { Reveal } from "@/components/landing/reveal";
import { PhoneChat } from "@/components/landing/phone-chat";
import { RoutingDiagram } from "@/components/landing/routing-diagram";
import {
  RobotIcon,
  BooksIcon,
  PackageIcon,
  WrenchIcon,
  WhatsappLogoIcon,
  ReceiptIcon,
  ArrowRightIcon,
  LightningIcon,
  ProhibitIcon,
  HandshakeIcon,
  ClockIcon,
} from "@phosphor-icons/react/dist/ssr";

export const metadata: Metadata = {
  title: "Magic Agent — your AI sales assistant on WhatsApp",
  description:
    "An AI assistant that answers your customers on WhatsApp, works from your own policies and price list, collects every detail your team needs, and hands you a complete enquiry.",
};

/**
 * The landing page.
 *
 * A server component, so the metadata above is real metadata and the copy is in
 * the HTML. Everything that moves is a client component underneath — the page
 * reads perfectly with JavaScript switched off, which is the only sane way to
 * add animation to the one page search engines and sceptical buyers actually
 * read.
 *
 * The copy was cut hard rather than restyled. Six three-line paragraphs of
 * features is not a design problem you can animate your way out of; each claim
 * is now one line, and the one genuinely hard idea — routing — is a drawing.
 */

/** `span` is the bento footprint at md and up. */
const CAPABILITIES = [
  {
    icon: BooksIcon,
    title: "Answers from your documents",
    body: "Your delivery policy, your minimum order, your artwork specs. Not the internet.",
    span: "md:col-span-2",
  },
  {
    icon: PackageIcon,
    title: "Asks the right questions",
    body: "Size, quantity, finish — one at a time, until nothing is missing.",
    span: "",
  },
  {
    icon: WhatsappLogoIcon,
    title: "On your own number",
    body: "The number your customers already message.",
    span: "",
  },
  {
    icon: ReceiptIcon,
    title: "Hands you a complete enquiry",
    body: "Every specification collected and structured, ready to price. No scrolling back through chat.",
    span: "md:col-span-2",
  },
  {
    icon: RobotIcon,
    title: "Sounds like your business",
    body: "Its name, its role, its tone. What it must always say, and never.",
    span: "",
  },
  {
    icon: WrenchIcon,
    title: "Checks your systems",
    body: "Describe the lookup in a sentence; the connection gets built for you.",
    span: "md:col-span-2",
  },
];

const GUARDRAILS = [
  {
    icon: ProhibitIcon,
    title: "Never invents a price",
    body: "Not in your list? The team confirms it. No guessing, no ranges.",
  },
  {
    icon: ClockIcon,
    title: "Never promises a date",
    body: "Lead times come only from what you told it.",
  },
  {
    icon: HandshakeIcon,
    title: "Knows when to step aside",
    body: "Complaints and anyone asking for a person go to your team, with a summary.",
  },
];

const STEPS = [
  {
    title: "Describe the business",
    body: "What you sell, where you deliver, your minimum order.",
  },
  {
    title: "Add products and policies",
    body: "Your price list and the documents your team answers from.",
  },
  {
    title: "Try it, then go live",
    body: "Chat to it yourself, then connect WhatsApp.",
  },
];

export default function LandingPage() {
  return (
    <SmoothScroll>
      {/* Without JavaScript nothing lifts the CSS hidden state, so the page
          would be blank. This is the whole reason the reveals are safe to put
          in CSS. */}
      <noscript>
        <style>{"[data-reveal]{opacity:1!important}"}</style>
      </noscript>

      <div className="flex min-h-svh flex-col">
        {/* ----------------------------------------------------------- header */}
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2">
              <Logo className="h-7" />
              <span className="font-heading text-base font-semibold tracking-tight">
                Magic Agent
              </span>
            </Link>

            <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
              <a href="#what-it-does" className="hover:text-foreground">
                What it does
              </a>
              <a href="#routing" className="hover:text-foreground">
                Routing
              </a>
              <a href="#guardrails" className="hover:text-foreground">
                Guardrails
              </a>
            </nav>

            <Button size="lg" nativeButton={false} render={<Link href="/login" />}>
              Sign in <ArrowRightIcon />
            </Button>
          </div>
        </header>

        {/* ------------------------------------------------------------- hero */}
        <section className="bg-grid relative border-b">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-24">
            <Reveal className="flex flex-col items-start gap-5" stagger>
              <Badge variant="secondary">
                <WhatsappLogoIcon /> WhatsApp &amp; website chat
              </Badge>
              <h1 className="font-heading text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                Your customers get an answer in seconds.
              </h1>
              <p className="max-w-md text-base text-muted-foreground sm:text-lg">
                An assistant that knows your prices, your policies and exactly
                what to ask — then hands your team a finished enquiry.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="lg"
                  nativeButton={false}
                  render={<Link href="/login" />}
                >
                  Get started <ArrowRightIcon />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  nativeButton={false}
                  render={<a href="#routing" />}
                >
                  See how it routes
                </Button>
              </div>
            </Reveal>

            {/* The proof, on a handset. The chat inside is the product's own
                Bubble/Message under the product's own WhatsApp skin, so this
                cannot drift from what a customer actually sees. */}
            <Reveal delay={0.15} distance={32}>
              <PhoneChat />
              <p className="mx-auto mt-5 flex max-w-xs items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                <LightningIcon className="size-3.5 shrink-0" />
                Answered from the workspace&apos;s own price list and policies
              </p>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------- what it does */}
        <section
          id="what-it-does"
          className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20"
        >
          <Reveal className="max-w-2xl">
            <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
              Six things it does that a chat widget does not
            </h2>
          </Reveal>

          {/* Bento: the two claims that carry the product get the wide cells,
              so the grid says which matter before anything is read. */}
          <Reveal className="mt-8 grid gap-3 sm:grid-cols-2 md:grid-cols-3" stagger>
            {CAPABILITIES.map((capability) => {
              const Icon = capability.icon;
              return (
                <div
                  key={capability.title}
                  className={`group flex flex-col gap-2 rounded-2xl border bg-card p-5 transition-colors hover:border-primary/40 ${capability.span}`}
                >
                  <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="size-4.5" />
                  </span>
                  <h3 className="font-heading text-sm font-medium">
                    {capability.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {capability.body}
                  </p>
                </div>
              );
            })}
          </Reveal>
        </section>

        {/* --------------------------------------------------------- routing */}
        <section id="routing" className="border-y bg-muted/30">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <Reveal className="max-w-2xl">
              <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
                One number. The right person every time.
              </h2>
              <p className="mt-3 text-sm text-muted-foreground sm:text-base">
                A front desk reads every message first and hands it to whichever
                assistant should deal with it. Silently — your customer never
                sees a transfer, and never repeats themselves.
              </p>
            </Reveal>

            <Reveal className="mt-10" distance={16}>
              <RoutingDiagram />
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------ guardrails */}
        <section
          id="guardrails"
          className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20"
        >
          <Reveal className="max-w-2xl">
            <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
              What it will not do
            </h2>
          </Reveal>

          <Reveal className="mt-8 grid gap-3 md:grid-cols-3" stagger>
            {GUARDRAILS.map((guardrail) => {
              const Icon = guardrail.icon;
              return (
                <div
                  key={guardrail.title}
                  className="flex flex-col gap-2 rounded-2xl border bg-card p-5"
                >
                  <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <Icon className="size-4.5" />
                  </span>
                  <h3 className="font-heading text-sm font-medium">
                    {guardrail.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {guardrail.body}
                  </p>
                </div>
              );
            })}
          </Reveal>
        </section>

        {/* ------------------------------------------------------------ steps */}
        <section className="bg-grid border-t">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <Reveal className="max-w-2xl">
              <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
                Live this afternoon
              </h2>
            </Reveal>

            <Reveal className="mt-8 grid gap-3 md:grid-cols-3" stagger>
              {STEPS.map((step, index) => (
                <div
                  key={step.title}
                  className="flex flex-col gap-2 rounded-2xl border bg-card p-5"
                >
                  <span className="font-heading text-3xl font-semibold text-primary/25 tabular-nums">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="font-heading text-sm font-medium">
                    {step.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{step.body}</p>
                </div>
              ))}
            </Reveal>

            <Reveal className="mt-10 flex flex-wrap items-center gap-3" distance={16}>
              <Button size="lg" nativeButton={false} render={<Link href="/login" />}>
                Get started <ArrowRightIcon />
              </Button>
              <span className="text-sm text-muted-foreground">
                No card. Your workspace, your number, your price list.
              </span>
            </Reveal>
          </div>
        </section>

        {/* ----------------------------------------------------------- footer */}
        <footer className="border-t">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground sm:px-6">
            <span className="flex items-center gap-2">
              <Logo className="h-4" /> Magic Agent
            </span>
            <Link href="/login" className="hover:text-foreground">
              Sign in
            </Link>
          </div>
        </footer>
      </div>
    </SmoothScroll>
  );
}
