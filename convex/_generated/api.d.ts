/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents from "../agents.js";
import type * as ai from "../ai.js";
import type * as analytics from "../analytics.js";
import type * as apps from "../apps.js";
import type * as assistant from "../assistant.js";
import type * as assistantDb from "../assistantDb.js";
import type * as audience from "../audience.js";
import type * as audienceImports from "../audienceImports.js";
import type * as auth from "../auth.js";
import type * as authDb from "../authDb.js";
import type * as billing from "../billing.js";
import type * as channels from "../channels.js";
import type * as contacts from "../contacts.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as deliveries from "../deliveries.js";
import type * as desk from "../desk.js";
import type * as engine from "../engine.js";
import type * as eventGuests from "../eventGuests.js";
import type * as followUp from "../followUp.js";
import type * as formSubmissions from "../formSubmissions.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as integrations from "../integrations.js";
import type * as knowledge from "../knowledge.js";
import type * as leads from "../leads.js";
import type * as lib_account from "../lib/account.js";
import type * as lib_agentStats from "../lib/agentStats.js";
import type * as lib_agentTemplates from "../lib/agentTemplates.js";
import type * as lib_appClient from "../lib/appClient.js";
import type * as lib_appWebhooks from "../lib/appWebhooks.js";
import type * as lib_apps from "../lib/apps.js";
import type * as lib_audience from "../lib/audience.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_billing from "../lib/billing.js";
import type * as lib_branding from "../lib/branding.js";
import type * as lib_charge from "../lib/charge.js";
import type * as lib_contactClean from "../lib/contactClean.js";
import type * as lib_dailyStats from "../lib/dailyStats.js";
import type * as lib_delivery from "../lib/delivery.js";
import type * as lib_gateway from "../lib/gateway.js";
import type * as lib_google from "../lib/google.js";
import type * as lib_inbox from "../lib/inbox.js";
import type * as lib_integrations from "../lib/integrations.js";
import type * as lib_jev from "../lib/jev.js";
import type * as lib_links from "../lib/links.js";
import type * as lib_marketing from "../lib/marketing.js";
import type * as lib_marketingStats from "../lib/marketingStats.js";
import type * as lib_markets from "../lib/markets.js";
import type * as lib_metaErrors from "../lib/metaErrors.js";
import type * as lib_modelCatalogue from "../lib/modelCatalogue.js";
import type * as lib_notifications from "../lib/notifications.js";
import type * as lib_optOut from "../lib/optOut.js";
import type * as lib_ordersBook from "../lib/ordersBook.js";
import type * as lib_panel from "../lib/panel.js";
import type * as lib_plans from "../lib/plans.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_prompt from "../lib/prompt.js";
import type * as lib_razorpay from "../lib/razorpay.js";
import type * as lib_records from "../lib/records.js";
import type * as lib_regional from "../lib/regional.js";
import type * as lib_shared from "../lib/shared.js";
import type * as lib_toolSchema from "../lib/toolSchema.js";
import type * as lib_usageDaily from "../lib/usageDaily.js";
import type * as lib_wallet from "../lib/wallet.js";
import type * as lib_webhookDelivery from "../lib/webhookDelivery.js";
import type * as lib_whatsappSend from "../lib/whatsappSend.js";
import type * as marketing from "../marketing.js";
import type * as marketingAi from "../marketingAi.js";
import type * as marketingBroadcasts from "../marketingBroadcasts.js";
import type * as marketingCampaigns from "../marketingCampaigns.js";
import type * as marketingOverview from "../marketingOverview.js";
import type * as marketingSend from "../marketingSend.js";
import type * as marketingTemplates from "../marketingTemplates.js";
import type * as marketingTracking from "../marketingTracking.js";
import type * as migrations from "../migrations.js";
import type * as models from "../models.js";
import type * as notifications from "../notifications.js";
import type * as notificationsSend from "../notificationsSend.js";
import type * as orders from "../orders.js";
import type * as plans from "../plans.js";
import type * as products from "../products.js";
import type * as push from "../push.js";
import type * as razorpay from "../razorpay.js";
import type * as razorpayEvents from "../razorpayEvents.js";
import type * as records from "../records.js";
import type * as schema_agents from "../schema/agents.js";
import type * as schema_auth from "../schema/auth.js";
import type * as schema_billing from "../schema/billing.js";
import type * as schema_conversations from "../schema/conversations.js";
import type * as schema_index from "../schema/index.js";
import type * as schema_integrations from "../schema/integrations.js";
import type * as schema_marketing from "../schema/marketing.js";
import type * as schema_notifications from "../schema/notifications.js";
import type * as schema_records from "../schema/records.js";
import type * as schema_validators from "../schema/validators.js";
import type * as schema_workspaces from "../schema/workspaces.js";
import type * as speech from "../speech.js";
import type * as subscriptions from "../subscriptions.js";
import type * as team from "../team.js";
import type * as tools from "../tools.js";
import type * as usage from "../usage.js";
import type * as users from "../users.js";
import type * as wallet from "../wallet.js";
import type * as webhooks from "../webhooks.js";
import type * as whatsapp from "../whatsapp.js";
import type * as widget from "../widget.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agents: typeof agents;
  ai: typeof ai;
  analytics: typeof analytics;
  apps: typeof apps;
  assistant: typeof assistant;
  assistantDb: typeof assistantDb;
  audience: typeof audience;
  audienceImports: typeof audienceImports;
  auth: typeof auth;
  authDb: typeof authDb;
  billing: typeof billing;
  channels: typeof channels;
  contacts: typeof contacts;
  conversations: typeof conversations;
  crons: typeof crons;
  deliveries: typeof deliveries;
  desk: typeof desk;
  engine: typeof engine;
  eventGuests: typeof eventGuests;
  followUp: typeof followUp;
  formSubmissions: typeof formSubmissions;
  http: typeof http;
  ingest: typeof ingest;
  integrations: typeof integrations;
  knowledge: typeof knowledge;
  leads: typeof leads;
  "lib/account": typeof lib_account;
  "lib/agentStats": typeof lib_agentStats;
  "lib/agentTemplates": typeof lib_agentTemplates;
  "lib/appClient": typeof lib_appClient;
  "lib/appWebhooks": typeof lib_appWebhooks;
  "lib/apps": typeof lib_apps;
  "lib/audience": typeof lib_audience;
  "lib/auth": typeof lib_auth;
  "lib/billing": typeof lib_billing;
  "lib/branding": typeof lib_branding;
  "lib/charge": typeof lib_charge;
  "lib/contactClean": typeof lib_contactClean;
  "lib/dailyStats": typeof lib_dailyStats;
  "lib/delivery": typeof lib_delivery;
  "lib/gateway": typeof lib_gateway;
  "lib/google": typeof lib_google;
  "lib/inbox": typeof lib_inbox;
  "lib/integrations": typeof lib_integrations;
  "lib/jev": typeof lib_jev;
  "lib/links": typeof lib_links;
  "lib/marketing": typeof lib_marketing;
  "lib/marketingStats": typeof lib_marketingStats;
  "lib/markets": typeof lib_markets;
  "lib/metaErrors": typeof lib_metaErrors;
  "lib/modelCatalogue": typeof lib_modelCatalogue;
  "lib/notifications": typeof lib_notifications;
  "lib/optOut": typeof lib_optOut;
  "lib/ordersBook": typeof lib_ordersBook;
  "lib/panel": typeof lib_panel;
  "lib/plans": typeof lib_plans;
  "lib/pricing": typeof lib_pricing;
  "lib/prompt": typeof lib_prompt;
  "lib/razorpay": typeof lib_razorpay;
  "lib/records": typeof lib_records;
  "lib/regional": typeof lib_regional;
  "lib/shared": typeof lib_shared;
  "lib/toolSchema": typeof lib_toolSchema;
  "lib/usageDaily": typeof lib_usageDaily;
  "lib/wallet": typeof lib_wallet;
  "lib/webhookDelivery": typeof lib_webhookDelivery;
  "lib/whatsappSend": typeof lib_whatsappSend;
  marketing: typeof marketing;
  marketingAi: typeof marketingAi;
  marketingBroadcasts: typeof marketingBroadcasts;
  marketingCampaigns: typeof marketingCampaigns;
  marketingOverview: typeof marketingOverview;
  marketingSend: typeof marketingSend;
  marketingTemplates: typeof marketingTemplates;
  marketingTracking: typeof marketingTracking;
  migrations: typeof migrations;
  models: typeof models;
  notifications: typeof notifications;
  notificationsSend: typeof notificationsSend;
  orders: typeof orders;
  plans: typeof plans;
  products: typeof products;
  push: typeof push;
  razorpay: typeof razorpay;
  razorpayEvents: typeof razorpayEvents;
  records: typeof records;
  "schema/agents": typeof schema_agents;
  "schema/auth": typeof schema_auth;
  "schema/billing": typeof schema_billing;
  "schema/conversations": typeof schema_conversations;
  "schema/index": typeof schema_index;
  "schema/integrations": typeof schema_integrations;
  "schema/marketing": typeof schema_marketing;
  "schema/notifications": typeof schema_notifications;
  "schema/records": typeof schema_records;
  "schema/validators": typeof schema_validators;
  "schema/workspaces": typeof schema_workspaces;
  speech: typeof speech;
  subscriptions: typeof subscriptions;
  team: typeof team;
  tools: typeof tools;
  usage: typeof usage;
  users: typeof users;
  wallet: typeof wallet;
  webhooks: typeof webhooks;
  whatsapp: typeof whatsapp;
  widget: typeof widget;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
