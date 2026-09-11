/**
 * Argument fragments shared between tools.
 */

import { z } from "zod";

export const workspaceArg = {
  workspace: z
    .string()
    .optional()
    .describe(
      "Workspace slug. Omit when the account owns exactly one workspace, or when MAGIC_AI_BOT_WORKSPACE is set."
    ),
};

// Keys from convex/lib/shared.ts BUILTIN_TOOLS — the source of truth is there.
export const BUILTIN_TOOL_KEYS = [
  "search_knowledge",
  "search_products",
  "get_product_requirements",
  "create_order",
  "lookup_orders",
  "save_contact_detail",
  "escalate_to_human",
  "transfer_to_agent",
  "rich_messages",
];

export const toneArg = z
  .object({
    traits: z.array(z.string()).optional(),
    avoid: z.array(z.string()).optional(),
    formality: z.enum(["casual", "neutral", "formal"]).optional(),
    emoji: z.enum(["none", "sparing", "expressive"]).optional(),
    responseLength: z.enum(["short", "medium", "detailed"]).optional(),
    languages: z.array(z.string()).optional(),
    mirrorUserLanguage: z.boolean().optional(),
    humanVoice: z
      .boolean()
      .optional()
      .describe(
        "Short, unpolished replies that read as typed by a colleague: no AI self-description, no sign-offs, no tidy lists. A direct question about being an AI is still answered honestly."
      ),
  })
  .optional()
  .describe(
    "Partial tone. Anything omitted keeps the agent's current setting — the stored value is a complete object, so it is merged here before saving."
  );

export const requirementFieldArg = z.object({
  key: z.string().describe("snake_case machine name"),
  label: z.string().describe("The question as the customer sees it"),
  type: z.enum(["text", "number", "select", "boolean", "date"]),
  required: z.boolean(),
  options: z.array(z.string()).optional().describe("Choices, for a select"),
  example: z.string().optional(),
});

export const kvArg = z.object({ key: z.string(), value: z.string() });
