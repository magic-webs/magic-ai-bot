import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Magic Agent",
  description: "The terms on which Magic Agent is provided.",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="font-heading text-xl font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <article>
      <h1 className="font-heading text-3xl font-semibold tracking-tight">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated 5 September 2026
      </p>

      <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <strong className="font-semibold">Before publishing:</strong> replace
        every <code>[SQUARE BRACKET]</code> and have this reviewed. It describes
        the service accurately but is not legal advice.
      </div>

      <Section title="The agreement">
        <p>
          These terms are between <strong>[LEGAL ENTITY NAME]</strong> and the
          business that opens a Magic Agent workspace. Using the service means
          accepting them.
        </p>
      </Section>

      <Section title="What the service does">
        <p>
          Magic Agent lets a business configure AI agents that answer its
          customers on WhatsApp and web chat, works from the material and price
          list the business supplies, records enquiries and orders, and hands
          conversations to a person when they need one. The Android app is a
          console for watching and managing that.
        </p>
      </Section>

      <Section title="Your account">
        <p>
          You are responsible for keeping your workspace password safe and for
          everything done under your workspace. Tell us at once if you think it
          has been compromised — passwords can be reissued and sessions revoked
          immediately.
        </p>
      </Section>

      <Section title="Your content, and what agents say">
        <p>
          Your catalogue, documents, policies and conversations remain yours. You
          grant us only the licence needed to run the service: to store that
          material, and to send the relevant parts to the model providers listed
          in the{" "}
          <a href="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </a>{" "}
          so an agent can answer.
        </p>
        <p>
          Agents produce text with a language model. Their answers are drawn
          from what you configure, but they can still be wrong. You are
          responsible for what your agents say to your customers, and for
          reviewing prices, availability and commitments before relying on them.
          Agents are configured to refuse to quote a price that is not in your
          catalogue, but that is a safeguard, not a guarantee.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>You agree not to use Magic Agent to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>send unsolicited bulk messages, or anything WhatsApp&apos;s own policies prohibit;</li>
          <li>impersonate a person or organisation you are not;</li>
          <li>handle payment card numbers, health records or other special-category data through a conversation;</li>
          <li>break the law where you or your customers are.</li>
        </ul>
      </Section>

      <Section title="Availability">
        <p>
          We aim to keep the service running but do not promise it will be
          uninterrupted. Model providers and WhatsApp are outside our control and
          can fail independently of us.
        </p>
      </Section>

      <Section title="Fees">
        <p>
          Fees, model usage charges and billing terms are as agreed in writing
          with you. Usage is metered per model call and visible in your
          workspace.
        </p>
      </Section>

      <Section title="Ending it">
        <p>
          You may stop at any time and ask us to delete your workspace — see{" "}
          <a href="/delete-account" className="underline hover:text-foreground">
            Delete your account
          </a>
          . We may suspend a workspace that breaches these terms, and will tell
          you why.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          To the extent the law allows, we are not liable for indirect or
          consequential loss, lost profits or lost data, and our total liability
          is limited to the fees you paid in the{" "}
          <strong>[LIABILITY PERIOD]</strong> before the claim.
        </p>
      </Section>

      <Section title="Governing law">
        <p>
          These terms are governed by the laws of{" "}
          <strong>[JURISDICTION]</strong>, and its courts have exclusive
          jurisdiction.
        </p>
      </Section>
    </article>
  );
}
