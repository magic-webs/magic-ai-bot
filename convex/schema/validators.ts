import { v } from "convex/values";

export const kvPair = v.object({
  key: v.string(),
  value: v.string(),
});

export const toneConfig = v.object({
  traits: v.array(v.string()),
  avoid: v.array(v.string()),
  formality: v.union(
    v.literal("casual"),
    v.literal("neutral"),
    v.literal("formal")
  ),
  emoji: v.union(
    v.literal("none"),
    v.literal("sparing"),
    v.literal("expressive")
  ),
  responseLength: v.union(
    v.literal("short"),
    v.literal("medium"),
    v.literal("detailed")
  ),
  languages: v.array(v.string()),
  mirrorUserLanguage: v.boolean(),
  humanVoice: v.optional(v.boolean()),
});

export const requirementField = v.object({
  key: v.string(),
  label: v.string(),
  type: v.union(
    v.literal("text"),
    v.literal("number"),
    v.literal("select"),
    v.literal("boolean"),
    v.literal("date")
  ),
  required: v.boolean(),
  options: v.optional(v.array(v.string())),
  example: v.optional(v.string()),
});

export const toolParameter = v.object({
  name: v.string(),
  type: v.union(
    v.literal("string"),
    v.literal("number"),
    v.literal("boolean")
  ),
  description: v.string(),
  required: v.boolean(),
  enumValues: v.optional(v.array(v.string())),
});

export const productImage = v.object({
  fileKey: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  externalUrl: v.optional(v.string()),
  alt: v.optional(v.string()),
});

export const messageCategory = v.union(
  v.literal("service"),
  v.literal("utility"),
  v.literal("marketing"),
  v.literal("authentication")
);

export const orderStatus = v.union(
  v.literal("new"),
  v.literal("quoted"),
  v.literal("confirmed"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled")
);

export const deliveryStatus = v.union(
  v.literal("pending"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("read"),
  v.literal("failed")
);

export const channelType = v.union(
  v.literal("whatsapp"),
  v.literal("web"),
  v.literal("instagram")
);
