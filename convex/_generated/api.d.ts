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
import type * as auth from "../auth.js";
import type * as authDb from "../authDb.js";
import type * as billing from "../billing.js";
import type * as channels from "../channels.js";
import type * as contacts from "../contacts.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as desk from "../desk.js";
import type * as engine from "../engine.js";
import type * as followUp from "../followUp.js";
import type * as formSubmissions from "../formSubmissions.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as integrations from "../integrations.js";
import type * as knowledge from "../knowledge.js";
import type * as leads from "../leads.js";
import type * as lib_account from "../lib/account.js";
import type * as lib_agentTemplates from "../lib/agentTemplates.js";
import type * as lib_appClient from "../lib/appClient.js";
import type * as lib_appWebhooks from "../lib/appWebhooks.js";
import type * as lib_apps from "../lib/apps.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_billing from "../lib/billing.js";
import type * as lib_branding from "../lib/branding.js";
import type * as lib_charge from "../lib/charge.js";
import type * as lib_gateway from "../lib/gateway.js";
import type * as lib_google from "../lib/google.js";
import type * as lib_integrations from "../lib/integrations.js";
import type * as lib_marketing from "../lib/marketing.js";
import type * as lib_modelCatalogue from "../lib/modelCatalogue.js";
import type * as lib_notifications from "../lib/notifications.js";
import type * as lib_ordersBook from "../lib/ordersBook.js";
import type * as lib_plans from "../lib/plans.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_prompt from "../lib/prompt.js";
import type * as lib_razorpay from "../lib/razorpay.js";
import type * as lib_records from "../lib/records.js";
import type * as lib_regional from "../lib/regional.js";
import type * as lib_shared from "../lib/shared.js";
import type * as lib_toolSchema from "../lib/toolSchema.js";
import type * as lib_wallet from "../lib/wallet.js";
import type * as lib_webhookDelivery from "../lib/webhookDelivery.js";
import type * as lib_whatsappSend from "../lib/whatsappSend.js";
import type * as marketing from "../marketing.js";
import type * as marketingAi from "../marketingAi.js";
import type * as marketingSend from "../marketingSend.js";
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
import type * as speech from "../speech.js";
import type * as subscriptions from "../subscriptions.js";
import type * as team from "../team.js";
import type * as tools from "../tools.js";
import type * as usage from "../usage.js";
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
  auth: typeof auth;
  authDb: typeof authDb;
  billing: typeof billing;
  channels: typeof channels;
  contacts: typeof contacts;
  conversations: typeof conversations;
  crons: typeof crons;
  desk: typeof desk;
  engine: typeof engine;
  followUp: typeof followUp;
  formSubmissions: typeof formSubmissions;
  http: typeof http;
  ingest: typeof ingest;
  integrations: typeof integrations;
  knowledge: typeof knowledge;
  leads: typeof leads;
  "lib/account": typeof lib_account;
  "lib/agentTemplates": typeof lib_agentTemplates;
  "lib/appClient": typeof lib_appClient;
  "lib/appWebhooks": typeof lib_appWebhooks;
  "lib/apps": typeof lib_apps;
  "lib/auth": typeof lib_auth;
  "lib/billing": typeof lib_billing;
  "lib/branding": typeof lib_branding;
  "lib/charge": typeof lib_charge;
  "lib/gateway": typeof lib_gateway;
  "lib/google": typeof lib_google;
  "lib/integrations": typeof lib_integrations;
  "lib/marketing": typeof lib_marketing;
  "lib/modelCatalogue": typeof lib_modelCatalogue;
  "lib/notifications": typeof lib_notifications;
  "lib/ordersBook": typeof lib_ordersBook;
  "lib/plans": typeof lib_plans;
  "lib/pricing": typeof lib_pricing;
  "lib/prompt": typeof lib_prompt;
  "lib/razorpay": typeof lib_razorpay;
  "lib/records": typeof lib_records;
  "lib/regional": typeof lib_regional;
  "lib/shared": typeof lib_shared;
  "lib/toolSchema": typeof lib_toolSchema;
  "lib/wallet": typeof lib_wallet;
  "lib/webhookDelivery": typeof lib_webhookDelivery;
  "lib/whatsappSend": typeof lib_whatsappSend;
  marketing: typeof marketing;
  marketingAi: typeof marketingAi;
  marketingSend: typeof marketingSend;
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
  speech: typeof speech;
  subscriptions: typeof subscriptions;
  team: typeof team;
  tools: typeof tools;
  usage: typeof usage;
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
