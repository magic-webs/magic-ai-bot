import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  RobotIcon,
  BooksIcon,
  PackageIcon,
  WrenchIcon,
  WhatsappLogoIcon,
  ReceiptIcon,
  ArrowRightIcon,
  CheckIcon,
  LightningIcon,
  ProhibitIcon,
  HandshakeIcon,
  ClockIcon,
} from "@phosphor-icons/react/dist/ssr";

export const metadata: Metadata = {
  title: "Magic AI Bot — your AI sales assistant on WhatsApp",
  description:
    "An AI assistant that answers your customers on WhatsApp, works from your own policies and price list, collects every detail your team needs, and hands you a complete enquiry.",
};

const CAPABILITIES = [
  {
    icon: BooksIcon,
    title: "It answers from your documents",
    body: "Upload your delivery policy, minimum order, artwork requirements — whatever your team actually answers from. Your assistant quotes those, not the internet.",
  },
  {
    icon: PackageIcon,
    title: "It asks the right questions",
    body: "Tell it what you need to know for each product — size, quantity, material, finish — and it works through the list one question at a time until nothing is missing.",
  },
  {
    icon: ReceiptIcon,
    title: "You get a complete enquiry",
    body: "Every conversation that finishes arrives as a structured order with all the specifications collected, ready for your team to price. No scrolling back through chat.",
  },
  {
    icon: WhatsappLogoIcon,
    title: "On the number you already use",
    body: "Connect your own WhatsApp Business number. Your customers message the same place they always did, and get an answer in seconds instead of the next morning.",
  },
  {
    icon: RobotIcon,
    title: "It sounds like your business",
    body: "Give it a name, a role and a tone of voice. Set the things it must always say and the things it must never say. Change any of it whenever you like.",
  },
  {
    icon: WrenchIcon,
    title: "It can check your systems",
    body: "Need it to look up stock, check a delivery area or fetch an order status? Describe the job in a sentence and the connection is built for you.",
  },
];

const GUARDRAILS = [
  {
    icon: ProhibitIcon,
    title: "It never invents a price",
    body: "If a price is not in your list, it says the team will confirm — it does not guess, estimate, or offer a range.",
  },
  {
    icon: ClockIcon,
    title: "It never promises a date",
    body: "Lead times and delivery dates only come from what you have told it. Nothing is committed on your behalf.",
  },
  {
    icon: HandshakeIcon,
    title: "It knows when to step aside",
    body: "Complaints, awkward questions and anyone asking for a person are handed straight to your team, with a summary.",
  },
];

const STEPS = [
  {
    title: "Tell it about your business",
    body: "What you sell, where you deliver, your minimum order. A few minutes of setup.",
  },
  {
    title: "Add your products and policies",
    body: "Your price list and the documents your team answers from, so nothing is guessed.",
  },
  {
    title: "Try it, then switch it on",
    body: "Chat to it yourself until you are happy, then connect WhatsApp and let it answer.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-svh flex-col">
      {/* ------------------------------------------------------------- header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <RobotIcon className="size-4" />
            </span>
            <span className="font-heading text-base font-semibold tracking-tight">
              Magic AI Bot
            </span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#what-it-does" className="hover:text-foreground">
              What it does
            </a>
            <a href="#guardrails" className="hover:text-foreground">
              Guardrails
            </a>
            <a href="#how" className="hover:text-foreground">
              Getting started
            </a>
          </nav>

          <Button size="lg" nativeButton={false} render={<Link href="/login" />}>
            Sign in <ArrowRightIcon />
          </Button>
        </div>
      </header>

      <main className="flex-1">
        {/* ----------------------------------------------------------- hero */}
        <section className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-14 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:py-20">
          <div className="flex flex-col items-start gap-5">
            <Badge variant="secondary" className="gap-1.5">
              <LightningIcon className="size-3" />
              Answers in seconds, day or night
            </Badge>

            <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl lg:text-5xl">
              Your AI sales assistant, answering on WhatsApp.
            </h1>

            <p className="max-w-xl text-base/relaxed text-muted-foreground">
              Every enquiry gets a reply straight away — from your own policies
              and price list, in your own tone of voice. It asks the questions
              your team needs answered, then hands you a complete enquiry ready
              to quote.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="lg" nativeButton={false} render={<Link href="/login" />}>
                Sign in <ArrowRightIcon />
              </Button>
              <Button
                size="lg"
                variant="outline"
                nativeButton={false}
                render={<a href="#what-it-does" />}
              >
                See what it does
              </Button>
            </div>

            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
              {[
                "Your own WhatsApp number",
                "Answers from your documents",
                "Never quotes a price it was not given",
              ].map((point) => (
                <li key={point} className="flex items-center gap-1.5">
                  <CheckIcon className="size-3 text-primary" />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* A real exchange, rendered with the same chat components the
              product uses. */}
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/40">
              <CardTitle className="flex items-center gap-2 text-sm">
                <WhatsappLogoIcon className="size-4" />
                Your business on WhatsApp
                <Badge variant="secondary" className="ml-auto">
                  live
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 py-4">
              <Message align="end">
                <MessageContent>
                  <Bubble>
                    <BubbleContent>Hi, I need 1000 business cards</BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>

              <Message align="start">
                <MessageContent>
                  <Bubble variant="muted">
                    <BubbleContent>
                      Happy to help. Standard size is 55 × 85mm — would you like
                      silk coated 350gsm, and printed one side or both?
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>

              <Message align="end">
                <MessageContent>
                  <Bubble>
                    <BubbleContent>
                      Both sides, matt lamination. Do you deliver to Belfast?
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>

              <Message align="start">
                <MessageContent>
                  <Bubble variant="muted">
                    <BubbleContent>
                      We deliver to UK mainland addresses only, so Belfast is
                      outside our area. Shall I quote for a mainland address
                      instead?
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>

              <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                <BooksIcon className="size-3" />
                Answered from your own delivery policy
              </div>
            </CardContent>
          </Card>
        </section>

        <Separator />

        {/* -------------------------------------------------- what it does */}
        <section
          id="what-it-does"
          className="mx-auto w-full max-w-6xl px-6 py-14 lg:py-18"
        >
          <div className="max-w-2xl">
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              An assistant that actually knows your business
            </h2>
            <p className="mt-2 text-base/relaxed text-muted-foreground">
              It is not a chatbot with a script. You give it your documents, your
              products and your rules, and it works from those.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((capability) => {
              const Icon = capability.icon;
              return (
                <Card key={capability.title} className="h-full">
                  <CardHeader>
                    <span className="flex size-8 items-center justify-center rounded-md bg-muted text-foreground">
                      <Icon className="size-4" />
                    </span>
                    <CardTitle className="mt-2">{capability.title}</CardTitle>
                    <CardDescription className="leading-relaxed">
                      {capability.body}
                    </CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </section>

        <Separator />

        {/* ----------------------------------------------------- guardrails */}
        <section
          id="guardrails"
          className="mx-auto w-full max-w-6xl px-6 py-14 lg:py-18"
        >
          <div className="max-w-2xl">
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              What it will never do
            </h2>
            <p className="mt-2 text-base/relaxed text-muted-foreground">
              The risk with an assistant answering for you is that it says
              something you would not. These limits are built in, not optional.
            </p>
          </div>

          <div className="mt-8 flex flex-col gap-2">
            {GUARDRAILS.map((guardrail) => {
              const Icon = guardrail.icon;
              return (
                <Item key={guardrail.title} variant="outline">
                  <ItemMedia variant="icon">
                    <Icon />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{guardrail.title}</ItemTitle>
                    <ItemDescription>{guardrail.body}</ItemDescription>
                  </ItemContent>
                </Item>
              );
            })}
          </div>
        </section>

        <Separator />

        {/* ------------------------------------------------------ how it works */}
        <section id="how" className="mx-auto w-full max-w-6xl px-6 py-14 lg:py-18">
          <div className="max-w-2xl">
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              Up and running the same day
            </h2>
            <p className="mt-2 text-base/relaxed text-muted-foreground">
              You do not write any prompts. Describe the job in a sentence and
              the assistant is drafted for you to review and adjust.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <Card key={step.title} className="h-full">
                <CardHeader>
                  <Badge variant="outline" className="w-fit font-mono">
                    {String(index + 1).padStart(2, "0")}
                  </Badge>
                  <CardTitle className="mt-2">{step.title}</CardTitle>
                  <CardDescription className="leading-relaxed">
                    {step.body}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-5 py-4">
            <p className="text-base font-medium">
              Already have your sign-in details?
            </p>
            <Button
              size="lg"
              className="ml-auto"
              nativeButton={false}
              render={<Link href="/login" />}
            >
              Open your workspace <ArrowRightIcon />
            </Button>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------------------- footer */}
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-muted-foreground">
          <span>Magic AI Bot</span>
          <Link href="/login" className="underline">
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
