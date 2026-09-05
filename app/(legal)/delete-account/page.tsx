import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Delete your account — Magic Agent",
  description:
    "How to delete a Magic Agent workspace and everything stored with it.",
};

/**
 * Google Play requires a reachable URL explaining how to delete an account and
 * its data, for any app that lets people create one. It has to be findable
 * without signing in, which is why this is a public page and not a screen in
 * the console.
 */

const KEPT = [
  ["Conversations and messages", "Every transcript, on every channel."],
  ["Contacts", "Names, phone numbers, emails and companies."],
  ["Orders", "Order lines, specifications and totals."],
  ["Knowledge base", "Uploaded documents and the embeddings built from them."],
  ["Agents and tools", "Their configuration, prompts and routing lines."],
  ["Push tokens", "Every registered device stops receiving notifications."],
  ["Stored audio", "Spoken greetings generated for the app."],
];

export default function DeleteAccountPage() {
  return (
    <article>
      <h1 className="font-heading text-3xl font-semibold tracking-tight">
        Delete your account
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        For the Magic Agent app and the Magic Agent web console.
      </p>

      <section className="mt-8">
        <h2 className="font-heading text-xl font-semibold">How to ask</h2>
        <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
          <p>
            Email <strong>[SUPPORT EMAIL]</strong> from the address that
            registered the workspace, with the workspace name in the subject.
            We will confirm and then delete it.
          </p>
          <p>
            If you cannot email from that address, write to us anyway — we will
            ask you for something that shows the workspace is yours before we
            delete anything, because deletion cannot be undone.
          </p>
          <p>
            Requests are actioned within <strong>30 days</strong>, usually far
            sooner. We will confirm in writing when it is done.
          </p>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-heading text-xl font-semibold">
          What gets deleted
        </h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Deleting a workspace removes everything scoped to it:
        </p>
        <table className="mt-3 w-full text-left text-sm">
          <tbody>
            {KEPT.map(([what, detail]) => (
              <tr key={what} className="border-b last:border-0">
                <td className="py-2 pr-4 align-top font-medium text-foreground">
                  {what}
                </td>
                <td className="py-2 align-top text-muted-foreground">
                  {detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-8">
        <h2 className="font-heading text-xl font-semibold">What we keep</h2>
        <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
          <p>
            Records we are required to keep — invoices and the usage totals they
            are based on — are retained for{" "}
            <strong>[RETENTION PERIOD]</strong> to meet accounting and tax
            obligations. They contain no message content, no contact details and
            no customer data: model name, token counts, cost and date.
          </p>
          <p>
            Routine backups are overwritten on their own cycle and are purged
            within <strong>[BACKUP WINDOW]</strong> of deletion.
          </p>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-heading text-xl font-semibold">
          Just want to stop notifications?
        </h2>
        <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
          <p>
            Signing out of the app, or turning notifications off for Magic Agent
            in Android settings, stops them without deleting anything. Deleting
            the app removes the device&apos;s push registration the next time we
            attempt a delivery.
          </p>
        </div>
      </section>
    </article>
  );
}
