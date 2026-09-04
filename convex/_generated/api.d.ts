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
import type * as auth from "../auth.js";
import type * as authDb from "../authDb.js";
import type * as channels from "../channels.js";
import type * as contacts from "../contacts.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as engine from "../engine.js";
import type * as followUp from "../followUp.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as knowledge from "../knowledge.js";
import type * as leads from "../leads.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_gateway from "../lib/gateway.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_prompt from "../lib/prompt.js";
import type * as lib_shared from "../lib/shared.js";
import type * as lib_toolSchema from "../lib/toolSchema.js";
import type * as lib_whatsappSend from "../lib/whatsappSend.js";
import type * as orders from "../orders.js";
import type * as products from "../products.js";
import type * as speech from "../speech.js";
import type * as tools from "../tools.js";
import type * as usage from "../usage.js";
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
  auth: typeof auth;
  authDb: typeof authDb;
  channels: typeof channels;
  contacts: typeof contacts;
  conversations: typeof conversations;
  crons: typeof crons;
  engine: typeof engine;
  followUp: typeof followUp;
  http: typeof http;
  ingest: typeof ingest;
  knowledge: typeof knowledge;
  leads: typeof leads;
  "lib/auth": typeof lib_auth;
  "lib/gateway": typeof lib_gateway;
  "lib/pricing": typeof lib_pricing;
  "lib/prompt": typeof lib_prompt;
  "lib/shared": typeof lib_shared;
  "lib/toolSchema": typeof lib_toolSchema;
  "lib/whatsappSend": typeof lib_whatsappSend;
  orders: typeof orders;
  products: typeof products;
  speech: typeof speech;
  tools: typeof tools;
  usage: typeof usage;
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
