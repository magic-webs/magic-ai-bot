"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { FormRow, NothingYet } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { stepHref, SUGGESTED_FACTS } from "@/lib/onboarding";
import { FloppyDiskIcon, PlusIcon, XIcon } from "@phosphor-icons/react";

/**
 * Step 2 — company facts.
 *
 * Key/value lines pasted verbatim into every agent's instructions. They are the
 * answer to "the agent said something that is not true of us": a fact here is
 * the cheapest correction there is, and it applies to every agent at once
 * without touching a single persona.
 *
 * The whole list is edited locally and posted in one go, because the mutation
 * takes `facts` as a whole array — there is no per-row endpoint, and saving per
 * keystroke against a live query would fight the operator's typing.
 */

/** A row carries its own id: two facts can share a key while being typed. */
type Row = { id: number; key: string; value: string };

/** What each suggested key is usually filled with, as the placeholder. */
const EXAMPLES: Record<string, string> = {
  "Opening hours": "Mon–Fri 8am–6pm, Sat 9am–1pm, closed Sunday",
  Delivery: "Free within 20 miles, £35 nationwide, 3–5 working days",
  "Payment terms": "50% deposit to start, balance on completion. Card or BACS.",
  "Lead time": "Standard jobs ship in 7 working days, rush in 48 hours",
  "Returns policy": "Bespoke items are not returnable; stock items 14 days",
  "Service area": "Yorkshire and the north east; nationwide by arrangement",
  "Minimum order": "£150 excluding VAT",
  Warranty: "Two years on all installed signage, parts and labour",
};

export function FactsStep() {
  const workspace = useWorkspace();
  const router = useRouter();
  const updateWorkspace = useMutation(api.workspaces.update);

  const seed = () =>
    workspace.facts.map((fact, index) => ({
      id: index,
      key: fact.key,
      value: fact.value,
    }));

  const [rows, setRows] = useState<Row[]>(seed);
  const [nextId, setNextId] = useState(workspace.facts.length);
  const [saving, setSaving] = useState(false);

  // Re-seed when a different workspace is opened under this mounted page.
  const [rowsFor, setRowsFor] = useState<string>(workspace._id);
  if (rowsFor !== workspace._id) {
    setRowsFor(workspace._id);
    setRows(seed());
    setNextId(workspace.facts.length);
  }

  const add = (key = "") => {
    setRows((current) => [...current, { id: nextId, key, value: "" }]);
    setNextId((id) => id + 1);
  };

  const patch = (id: number, next: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...next } : row))
    );

  const used = new Set(rows.map((row) => row.key.trim().toLowerCase()));
  const unused = SUGGESTED_FACTS.filter(
    (suggestion) => !used.has(suggestion.toLowerCase())
  );

  const save = async (then?: "continue") => {
    setSaving(true);
    try {
      // A row with nothing in either box is one someone added and thought
      // better of; it is dropped rather than saved as an empty instruction.
      const facts = rows
        .map((row) => ({ key: row.key.trim(), value: row.value.trim() }))
        .filter((fact) => fact.key || fact.value);
      await updateWorkspace({ workspaceId: workspace._id, facts });
      toast.add({ title: "Facts saved", type: "success" });
      if (then === "continue") {
        router.push(stepHref(workspace.slug, "agents"));
      }
    } catch (error) {
      toast.add({
        title: "Save failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Your facts</CardTitle>
          <CardDescription>
            One line each. Short and specific beats complete and vague.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rows.length === 0 ? (
            <NothingYet>
              No facts yet. Pick a topic below, or add one of your own.
            </NothingYet>
          ) : null}

          {rows.map((row, index) => (
            <div
              key={row.id}
              className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <FormRow label="Topic" htmlFor={`fact-key-${row.id}`}>
                    <Input
                      id={`fact-key-${row.id}`}
                      value={row.key}
                      onChange={(event) =>
                        patch(row.id, { key: event.target.value })
                      }
                      placeholder="Opening hours"
                    />
                  </FormRow>
                </div>
                <Button
                  type="button"
                  size="icon-lg"
                  variant="ghost"
                  className="mt-6"
                  aria-label={`Remove ${row.key || `fact ${index + 1}`}`}
                  onClick={() =>
                    setRows((current) =>
                      current.filter((candidate) => candidate.id !== row.id)
                    )
                  }
                >
                  <XIcon />
                </Button>
              </div>

              <FormRow
                label="What the agents should say"
                htmlFor={`fact-value-${row.id}`}
              >
                <Textarea
                  id={`fact-value-${row.id}`}
                  rows={2}
                  value={row.value}
                  onChange={(event) =>
                    patch(row.id, { value: event.target.value })
                  }
                  placeholder={EXAMPLES[row.key.trim()] ?? "Mon–Fri 8am–6pm"}
                />
              </FormRow>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => add()}
          >
            <PlusIcon /> Add a fact
          </Button>
        </CardContent>
      </Card>

      {unused.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Commonly asked</CardTitle>
            <CardDescription>
              Start a fact with the topic already filled in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {unused.map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => add(suggestion)}
                >
                  <PlusIcon /> {suggestion}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void save("continue")} disabled={saving}>
          <FloppyDiskIcon /> {saving ? "Saving…" : "Save and continue"}
        </Button>
        <Button variant="outline" onClick={() => void save()} disabled={saving}>
          Save and stay
        </Button>
        <p className="text-xs text-muted-foreground">
          Saving replaces the whole list — anything removed above is gone for
          every agent.
        </p>
      </div>
    </div>
  );
}
