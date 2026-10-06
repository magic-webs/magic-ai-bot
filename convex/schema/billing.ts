import { defineTable } from "convex/server";
import { v } from "convex/values";
import { messageCategory } from "./validators";

const usageSource = v.union(
  v.literal("chat"),
  v.literal("retrieval"),
  v.literal("ingest"),
  v.literal("draft_agent"),
  v.literal("draft_tool"),
  v.literal("draft_catalogue"),
  v.literal("review"),
  v.literal("assistant"),
  v.literal("draft_marketing"),
  v.literal("sort_contacts")
);
const markup = v.object({ fixedMicros: v.number(), percent: v.number() });

export const currencyTerms = v.object({
  currency: v.string(),
  gstPercent: v.number(),
  extraAgentListMicros: v.number(),
  extraAgentPriceMicros: v.number(),
  minTopUpMicros: v.number(),
  defaultThresholdMicros: v.number(),
});

const usageChannel = v.optional(
  v.union(v.literal("whatsapp"), v.literal("web"))
);
const usageKind = v.union(v.literal("chat"), v.literal("embedding"));

export const billingTables = {
  usageDaily: defineTable({
    day: v.string(),
    workspaceId: v.id("workspaces"),
    model: v.string(),
    kind: usageKind,
    source: usageSource,
    channelType: usageChannel,
    priced: v.boolean(),
    calls: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
    costNanoUsd: v.number(),
  })
    .index("by_day", ["day"])
    .index("by_workspace_day", ["workspaceId", "day"]),

  usageEvents: defineTable({
    workspaceId: v.id("workspaces"),
    agentId: v.optional(v.id("agents")),
    conversationId: v.optional(v.id("conversations")),
    source: usageSource,
    channelType: usageChannel,
    model: v.string(),
    kind: usageKind,
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
    costNanoUsd: v.number(),
    priced: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_workspace_createdAt", ["workspaceId", "createdAt"]),

  billingSettings: defineTable({
    currency: v.string(),
    gstPercent: v.number(),
    trialDays: v.number(),
    graceDays: v.number(),
    extraAgentListMicros: v.number(),
    extraAgentPriceMicros: v.number(),
    trialPlanId: v.optional(v.id("billingPlans")),
    minTopUpMicros: v.number(),
    defaultThresholdMicros: v.number(),
    welcomeBonus: v.optional(
      v.array(v.object({ currency: v.string(), amountMicros: v.number() }))
    ),
    currencies: v.optional(v.array(currencyTerms)),
    launchedAt: v.number(),
    updatedAt: v.number(),
  }),

  billingPlans: defineTable({
    code: v.string(),
    currency: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    listPriceMicros: v.number(),
    priceMicros: v.number(),
    includedAiAgents: v.number(),
    includedHumanAgents: v.number(),
    features: v.array(v.string()),
    highlighted: v.boolean(),
    status: v.union(v.literal("active"), v.literal("hidden")),
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_sortOrder", ["sortOrder"]),

  billingAccounts: defineTable({
    workspaceId: v.id("workspaces"),
    currency: v.optional(v.string()),
    planId: v.optional(v.id("billingPlans")),
    extraAgents: v.number(),
    mode: v.union(
      v.literal("trial"),
      v.literal("razorpay"),
      v.literal("manual")
    ),
    trialEndsAt: v.optional(v.number()),
    manualPaidThrough: v.optional(v.number()),
    discountPercent: v.optional(v.number()),
    extraAgentPriceMicros: v.optional(v.number()),
    adminNote: v.optional(v.string()),
    subscriptionId: v.optional(v.id("billingSubscriptions")),
    pendingSubscriptionId: v.optional(v.id("billingSubscriptions")),
    razorpayCustomerId: v.optional(v.string()),
    billingName: v.optional(v.string()),
    gstin: v.optional(v.string()),
    billingEmail: v.optional(v.string()),
    billingPhone: v.optional(v.string()),
    billingAddress: v.optional(v.string()),
    billingState: v.optional(v.string()),
    lowBalanceThresholdMicros: v.number(),
    autoRecharge: v.object({
      enabled: v.boolean(),
      amountMicros: v.number(),
      method: v.optional(v.string()),
      tokenStatus: v.optional(v.string()),
      maxAmountMicros: v.optional(v.number()),
      lastError: v.optional(v.string()),
      lastChargedAt: v.optional(v.number()),
    }),
    mandateTokenId: v.optional(v.string()),
    rechargeInFlight: v.optional(
      v.object({
        paymentId: v.id("billingPayments"),
        startedAt: v.number(),
      })
    ),
    lowBalanceAlertedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_mandate_token", ["mandateTokenId"]),

  billingSubscriptions: defineTable({
    workspaceId: v.id("workspaces"),
    razorpaySubscriptionId: v.string(),
    razorpayPlanId: v.string(),
    planId: v.id("billingPlans"),
    extraAgents: v.number(),
    subtotalMicros: v.number(),
    gstMicros: v.number(),
    totalMicros: v.number(),
    currency: v.string(),
    status: v.string(),
    startAt: v.optional(v.number()),
    currentStart: v.optional(v.number()),
    currentEnd: v.optional(v.number()),
    chargeAt: v.optional(v.number()),
    paidCount: v.optional(v.number()),
    shortUrl: v.optional(v.string()),
    cancelAtCycleEnd: v.optional(v.boolean()),
    replacesId: v.optional(v.id("billingSubscriptions")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_razorpay_id", ["razorpaySubscriptionId"])
    .index("by_workspace", ["workspaceId"]),

  billingRates: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    currency: v.string(),
    serviceMicros: v.number(),
    utilityMicros: v.number(),
    marketingMicros: v.number(),
    authenticationMicros: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  metaRates: defineTable({
    market: v.string(),
    currency: v.string(),
    serviceMicros: v.number(),
    utilityMicros: v.number(),
    marketingMicros: v.number(),
    authenticationMicros: v.number(),
    authenticationIntlMicros: v.optional(v.number()),
    effectiveFrom: v.number(),
    updatedAt: v.number(),
  }).index("by_currency_market_effectiveFrom", [
    "currency",
    "market",
    "effectiveFrom",
  ]),

  billingMarkups: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    service: markup,
    utility: markup,
    marketing: markup,
    authentication: markup,
    freeMicros: v.number(),
    /** Fixed amounts in a currency other than INR, which the fields above are in. */
    byCurrency: v.optional(
      v.array(
        v.object({
          currency: v.string(),
          service: v.number(),
          utility: v.number(),
          marketing: v.number(),
          authentication: v.number(),
          freeMicros: v.number(),
        })
      )
    ),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  billingEvents: defineTable({
    workspaceId: v.id("workspaces"),
    conversationId: v.optional(v.id("conversations")),
    channelId: v.optional(v.id("channels")),
    to: v.string(),
    category: messageCategory,
    source: v.union(
      v.literal("agent"),
      v.literal("human"),
      v.literal("follow_up"),
      v.literal("campaign"),
      v.literal("system"),
      v.literal("notification")
    ),
    preview: v.optional(v.string()),
    templateName: v.optional(v.string()),
    currency: v.string(),
    amountMicros: v.number(),
    rated: v.boolean(),
    market: v.optional(v.string()),
    metaCostMicros: v.optional(v.number()),
    markupMicros: v.optional(v.number()),
    wamid: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("pending"), v.literal("settled"), v.literal("refunded"))
    ),
    billable: v.optional(v.boolean()),
    pricingCategory: v.optional(v.string()),
    pricingType: v.optional(v.string()),
    settledAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_wamid", ["wamid"])
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_workspace_createdAt", ["workspaceId", "createdAt"])
    .index("by_workspace_category_createdAt", [
      "workspaceId",
      "category",
      "createdAt",
    ]),

  billingPayments: defineTable({
    workspaceId: v.id("workspaces"),
    purpose: v.union(
      v.literal("subscription"),
      v.literal("wallet_topup"),
      v.literal("auto_recharge")
    ),
    status: v.union(
      v.literal("created"),
      v.literal("pending"),
      v.literal("paid"),
      v.literal("failed")
    ),
    description: v.string(),
    currency: v.string(),
    subtotalMicros: v.number(),
    gstMicros: v.number(),
    totalMicros: v.number(),
    creditMicros: v.optional(v.number()),
    mandate: v.optional(
      v.object({
        method: v.union(v.literal("upi"), v.literal("card")),
        maxAmountMicros: v.number(),
      })
    ),
    razorpayOrderId: v.optional(v.string()),
    razorpayPaymentId: v.optional(v.string()),
    razorpayInvoiceId: v.optional(v.string()),
    subscriptionId: v.optional(v.id("billingSubscriptions")),
    periodStart: v.optional(v.number()),
    periodEnd: v.optional(v.number()),
    method: v.optional(v.string()),
    error: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_createdAt", ["workspaceId", "createdAt"])
    .index("by_order", ["razorpayOrderId"])
    .index("by_razorpay_payment", ["razorpayPaymentId"]),

  wallets: defineTable({
    workspaceId: v.id("workspaces"),
    currency: v.string(),
    balanceMicros: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  walletTransactions: defineTable({
    workspaceId: v.id("workspaces"),
    kind: v.union(
      v.literal("topup"),
      v.literal("auto_recharge"),
      v.literal("adjustment"),
      v.literal("bonus")
    ),
    amountMicros: v.number(),
    balanceAfterMicros: v.number(),
    paymentId: v.optional(v.id("billingPayments")),
    note: v.optional(v.string()),
    by: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_workspace_createdAt", ["workspaceId", "createdAt"]),

  razorpayPlans: defineTable({
    key: v.string(),
    razorpayPlanId: v.string(),
    createdAt: v.number(),
  }).index("by_key", ["key"]),

  razorpayEvents: defineTable({
    eventId: v.string(),
    event: v.string(),
    receivedAt: v.number(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_receivedAt", ["receivedAt"]),
};
