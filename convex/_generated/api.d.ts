/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as _test_helpers from "../_test_helpers.js";
import type * as adapters_ConvexGroupApi from "../adapters/ConvexGroupApi.js";
import type * as adapters_ConvexIdentityAuth from "../adapters/ConvexIdentityAuth.js";
import type * as adapters_ConvexTransport from "../adapters/ConvexTransport.js";
import type * as auth from "../auth.js";
import type * as authorization from "../authorization.js";
import type * as debug from "../debug.js";
import type * as groups from "../groups.js";
import type * as messages from "../messages.js";
import type * as sessions from "../sessions.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  _test_helpers: typeof _test_helpers;
  "adapters/ConvexGroupApi": typeof adapters_ConvexGroupApi;
  "adapters/ConvexIdentityAuth": typeof adapters_ConvexIdentityAuth;
  "adapters/ConvexTransport": typeof adapters_ConvexTransport;
  auth: typeof auth;
  authorization: typeof authorization;
  debug: typeof debug;
  groups: typeof groups;
  messages: typeof messages;
  sessions: typeof sessions;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
