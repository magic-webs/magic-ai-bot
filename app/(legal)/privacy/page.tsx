import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Magic Agent",
  description:
    "What Magic Agent collects, why, who processes it, and how to have it deleted.",
};

/**
 * The URL Google Play asks for.
 *
 * Written from what the code actually does rather than from a template: every
 * category below corresponds to a table in the Convex schema or a request the
 * app makes, and the sub-processor list is the set of services the backend
 * genuinely calls. Anything a lawyer has to supply — the operating entity, its
 * address, the governing law — is marked and must be filled in before this is
 * published.
 */

const UPDATED = "5 September 2026";

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

function Row({ what, why }: { what: string; why: string }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4 align-top font-medium text-foreground">{what}</td>
      <td className="py-2 align-top">{why}</td>
    </tr>
  );
}

export default function PrivacyPage() {
  return (
    <article>
      <h1 className="font-heading text-3xl font-semibold tracking-tight">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated {UPDATED}
      </p>

      <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <strong className="font-semibold">Before publishing:</strong> replace
        every <code>[SQUARE BRACKET]</code> below with your operating entity,
        address, contact address and governing law, then have it reviewed. The
        factual sections — what is collected and who processes it — are accurate
        to the software as built.
      </div>

      <Section title="Who we are">
        <p>
          Magic Agent (&ldquo;we&rdquo;) is operated by{" "}
          <strong>[LEGAL ENTITY NAME]</strong>, <strong>[REGISTERED ADDRESS]</strong>.
          For anything in this policy, write to{" "}
          <strong>[PRIVACY CONTACT EMAIL]</strong>.
        </p>
        <p>
          Magic Agent is a business tool. Our customer is the business that
          opens a workspace. Where that business uses Magic Agent to talk to its
          own customers, the business is the data controller for those
          conversations and we are its processor, acting on its instructions.
        </p>
      </Section>

      <Section title="What the mobile app collects">
        <p>
          The Android app is an operator console. It shows a business its own
          workspace; it does not collect anything about the people using it
          beyond what is needed to sign in and to notify them.
        </p>
        <table className="w-full text-left text-sm">
          <tbody>
            <Row
              what="Workspace credentials"
              why="A workspace name and password, exchanged for a session token held in the device's secure storage. Passwords are never stored in readable form — only a PBKDF2-SHA256 hash, on the server."
            />
            <Row
              what="Push token"
              why="An Expo push token, the platform (Android or iOS) and the device name, so new orders and escalations can be delivered to the right device. Deleted when the device is unregistered or the install is gone."
            />
            <Row
              what="Questions you ask an agent"
              why="The operator chat on the agent screen is stored against your workspace so the thread is there next time. You can delete it from the app at any time."
            />
          </tbody>
        </table>
        <p>
          The app contains no analytics SDK, no advertising SDK and no
          third-party tracker. It does not request location, contacts, camera,
          microphone or storage access.
        </p>
      </Section>

      <Section title="What the platform stores for a workspace">
        <p>
          Entered by the business, or produced by conversations it has with its
          own customers:
        </p>
        <table className="w-full text-left text-sm">
          <tbody>
            <Row
              what="Business profile"
              why="Company name, description, industry, website, support email and phone, address, locale and currency. Read by the agents so their answers are accurate."
            />
            <Row
              what="Contacts"
              why="Name, phone number, email and company of the people a workspace's agents talk to, plus a channel identifier such as a WhatsApp number."
            />
            <Row
              what="Conversations and messages"
              why="The transcript of each conversation, which agent answered, and whether it was escalated to a person."
            />
            <Row
              what="Orders"
              why="Order lines, quantities, specifications, customer contact details and totals recorded by an agent."
            />
            <Row
              what="Knowledge base"
              why="Documents a workspace uploads, and the vector embeddings computed from them so agents can search their own material."
            />
            <Row
              what="Usage records"
              why="Model, token counts and cost per call, so a workspace can see what it is spending. No message content."
            />
          </tbody>
        </table>
      </Section>

      <Section title="Who else processes it">
        <p>
          We use these sub-processors. Each receives only what its function
          requires.
        </p>
        <table className="w-full text-left text-sm">
          <tbody>
            <Row
              what="Convex"
              why="Database, file storage and server functions. All workspace data is held here."
            />
            <Row
              what="Vercel AI Gateway"
              why="Routes model calls. Message text and the retrieved context are sent for the model to answer."
            />
            <Row
              what="Model providers via that gateway"
              why="DeepSeek for chat, OpenAI for embeddings and voice-note transcription, Fish Audio for spoken greetings."
            />
            <Row
              what="Expo push service, then Google FCM and Apple APNs"
              why="Delivers notifications. Receives the push token and the notification's title and body — for example an order number or a contact's name."
            />
            <Row
              what="Meta (WhatsApp Business Platform)"
              why="Carries WhatsApp messages, where a workspace has connected a number."
            />
          </tbody>
        </table>
        <p>
          We do not sell personal data and we do not share it for advertising.
        </p>
      </Section>

      <Section title="How long it is kept">
        <p>
          Workspace data is kept for as long as the workspace exists. Delete a
          workspace and its conversations, contacts, orders, knowledge base and
          files are deleted with it. Session tokens expire on their own.
          Aggregate usage and cost records may be retained for billing and
          accounting for <strong>[RETENTION PERIOD]</strong>.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Depending on where you live, you may have the right to access,
          correct, export or erase your personal data, and to object to or
          restrict its processing. Write to{" "}
          <strong>[PRIVACY CONTACT EMAIL]</strong> and we will respond within
          30 days.
        </p>
        <p>
          If you are one of a business&apos;s customers rather than our
          customer, contact that business first — it controls the conversation
          and we act on its instructions. We will help it respond.
        </p>
        <p>
          To delete an account and its data, see{" "}
          <a href="/delete-account" className="underline hover:text-foreground">
            Delete your account
          </a>
          .
        </p>
      </Section>

      <Section title="Security">
        <p>
          Data is encrypted in transit. Passwords are hashed with PBKDF2-SHA256
          and are never recoverable. Sessions are opaque tokens that can be
          revoked immediately, and every workspace can only reach its own data —
          enforced on the server, on every request.
        </p>
      </Section>

      <Section title="Children">
        <p>
          Magic Agent is a tool for businesses and is not directed at children.
          We do not knowingly collect data from anyone under 16.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If this policy changes materially we will update the date above and,
          where the change affects you, tell you in the app or by email.
        </p>
      </Section>

      <Section title="Governing law">
        <p>
          This policy is governed by the laws of{" "}
          <strong>[JURISDICTION]</strong>.
        </p>
      </Section>
    </article>
  );
}
