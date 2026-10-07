import { ConvexError } from "convex/values";

export const JEV_MODEL = "typesafe-ai/jev";
const ENDPOINT = "https://ai-gateway.vercel.sh/v1/evaluate";

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "boolean"; instructions: string };

export type JevAnswer =
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number }
  | { type: "boolean"; probability: number };

export type JevResult = {
  answers: Record<string, JevAnswer>;
  inputTokens: number;
  outputTokens: number;
};

export async function evaluate(
  state: string,
  questions: Record<string, JevQuestion>
): Promise<JevResult> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    console.error("jev: AI_GATEWAY_API_KEY is not set");
    throw new ConvexError("The assistant is not available right now.");
  }
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: JEV_MODEL, state, questions }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Jev ${response.status}: ${text.slice(0, 200)}`);
  }
  const body = (await response.json()) as {
    answers?: Record<string, JevAnswer>;
    usage?: { inputTokens?: number; outputTokens?: number };
  };
  if (!body.answers) throw new Error("Jev returned no answers.");
  return {
    answers: body.answers,
    inputTokens: body.usage?.inputTokens ?? 0,
    outputTokens: body.usage?.outputTokens ?? 0,
  };
}

export function choiceOf(answer: JevAnswer | undefined) {
  return answer?.type === "choice" ? answer : null;
}

export function probabilityOf(answer: JevAnswer | undefined): number | null {
  if (answer?.type !== "boolean") return null;
  return answer.probability;
}
