import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support — Magic Agent",
  description: "How to get help with Magic Agent, and answers to common questions.",
};

/**
 * The support URL on the Play listing. Play requires a support email; a page
 * makes the listing look like a product rather than an address, and answers
 * the questions that would otherwise arrive as one-star reviews.
 */

const FAQ: [string, string][] = [
  [
    "I signed in but every screen says no workspace",
    "That account is an administrator, which covers every workspace and names none. The app's screens are about one workspace at a time — sign out and sign in with a workspace name (its slug) and its password.",
  ],
  [
    "Where do I get my workspace password?",
    "Your administrator issues it from the web console and it is shown exactly once. If it has been lost, ask them to issue a new one; the old one stops working immediately.",
  ],
  [
    "I am not getting notifications",
    "Check that notifications are allowed for Magic Agent in Android settings. The app registers for them the first time you open it after signing in, so if you denied the prompt, allow it in settings and reopen the app. Notifications only cover new orders and conversations an agent has handed to a person.",
  ],
  [
    "Can I reply to a customer from the app?",
    "Not yet. The app is read-only for conversations: it shows what was said and lets you mark a conversation open, needing you, or closed. Replies go out from the agent, and anything typed here would be posted as the customer rather than as you.",
  ],
  [
    "The agent gave a wrong price",
    "Agents are configured to refuse to quote a price that is not on a product in your catalogue. If one is wrong, the catalogue is wrong — fix the product in the web console and the next answer uses it.",
  ],
  [
    "Can I add or edit an agent from the app?",
    "Agents are built in the web console, which drafts the whole configuration from a paragraph describing the job. The app shows who is live, what each one is for, and lets you ask them about your workspace.",
  ],
];

export default function SupportPage() {
  return (
    <article>
      <h1 className="font-heading text-3xl font-semibold tracking-tight">
        Support
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We answer within one working day.
      </p>

      <section className="mt-8 rounded-lg border p-5">
        <h2 className="font-heading text-lg font-semibold">Get in touch</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-muted-foreground">Email</dt>
            <dd className="font-medium">support@magicwebs.ai</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-muted-foreground">Phone</dt>
            <dd className="font-medium">9999-064-055</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-muted-foreground">Hours</dt>
            <dd>Monday to Sunday, 9am – 6pm IST</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted-foreground">
          Include your workspace name. If it is about one conversation, the
          contact&apos;s name and roughly when it happened is enough for us to
          find it.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="font-heading text-xl font-semibold">Common questions</h2>
        <dl className="mt-3 divide-y">
          {FAQ.map(([question, answer]) => (
            <div key={question} className="py-4">
              <dt className="text-sm font-medium">{question}</dt>
              <dd className="mt-1.5 text-sm leading-6 text-muted-foreground">
                {answer}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="font-heading text-xl font-semibold">Also useful</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            <a href="/privacy" className="underline hover:text-foreground">
              Privacy Policy
            </a>{" "}
            — what is stored and who processes it
          </li>
          <li>
            <a href="/terms" className="underline hover:text-foreground">
              Terms of Service
            </a>
          </li>
          <li>
            <a
              href="/delete-account"
              className="underline hover:text-foreground"
            >
              Delete your account
            </a>
          </li>
        </ul>
      </section>
    </article>
  );
}
