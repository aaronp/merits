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
import type * as _dev_utils from "../_dev_utils.js";
import type * as accessControl from "../accessControl.js";
import type * as adapters_ConvexGroupApi from "../adapters/ConvexGroupApi.js";
import type * as adapters_ConvexGroupChatApi from "../adapters/ConvexGroupChatApi.js";
import type * as adapters_ConvexIdentityAuth from "../adapters/ConvexIdentityAuth.js";
import type * as adapters_ConvexTransport from "../adapters/ConvexTransport.js";
import type * as allowList from "../allowList.js";
import type * as auth from "../auth.js";
import type * as authorization_bootstrap from "../authorization_bootstrap.js";
import type * as debug from "../debug.js";
import type * as denyList from "../denyList.js";
import type * as errors from "../errors.js";
import type * as groups from "../groups.js";
import type * as messages from "../messages.js";
import type * as permissions from "../permissions.js";
import type * as permissions_admin from "../permissions_admin.js";
import type * as sessions from "../sessions.js";
import type * as testHelpers from "../testHelpers.js";
import type * as userStatus from "../userStatus.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  _dev_utils: typeof _dev_utils;
  accessControl: typeof accessControl;
  "adapters/ConvexGroupApi": typeof adapters_ConvexGroupApi;
  "adapters/ConvexGroupChatApi": typeof adapters_ConvexGroupChatApi;
  "adapters/ConvexIdentityAuth": typeof adapters_ConvexIdentityAuth;
  "adapters/ConvexTransport": typeof adapters_ConvexTransport;
  allowList: typeof allowList;
  auth: typeof auth;
  authorization_bootstrap: typeof authorization_bootstrap;
  debug: typeof debug;
  denyList: typeof denyList;
  errors: typeof errors;
  groups: typeof groups;
  messages: typeof messages;
  permissions: typeof permissions;
  permissions_admin: typeof permissions_admin;
  sessions: typeof sessions;
  testHelpers: typeof testHelpers;
  userStatus: typeof userStatus;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
