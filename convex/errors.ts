/**
 * Structured errors for Convex mutations
 *
 * Provides error codes and context for better client-side handling
 */

import { ConvexError } from "convex/values";

export class MeritsError extends ConvexError<{
  code: string;
  message: string;
  context?: Record<string, any>;
}> {
  public code: string;
  public context?: Record<string, any>;

  constructor(
    code: string,
    message: string,
    context?: Record<string, any>
  ) {
    super({ code, message, context });
    this.code = code;
    this.context = context;
    this.name = "MeritsError";
  }

  toJSON() {
    return {
      error: this.code,
      message: this.data.message,
      context: this.context,
    };
  }
}

/**
 * Authentication and authorization errors
 */
export class AuthError extends MeritsError {
  constructor(message: string, context?: Record<string, any>) {
    super("AUTH_ERROR", message, context);
    this.name = "AuthError";
  }
}

export class ChallengeError extends MeritsError {
  constructor(message: string, context?: Record<string, any>) {
    super("CHALLENGE_ERROR", message, context);
    this.name = "ChallengeError";
  }
}

export class SignatureError extends MeritsError {
  constructor(message: string, context?: Record<string, any>) {
    super("SIGNATURE_ERROR", message, context);
    this.name = "SignatureError";
  }
}

/**
 * Resource errors
 */
export class NotFoundError extends MeritsError {
  constructor(resource: string, identifier: string, context?: Record<string, any>) {
    super(
      "NOT_FOUND",
      `${resource} not found: ${identifier}`,
      { resource, identifier, ...context }
    );
    this.name = "NotFoundError";
  }
}

export class AlreadyExistsError extends MeritsError {
  constructor(resource: string, identifier: string, context?: Record<string, any>) {
    super(
      "ALREADY_EXISTS",
      `${resource} already exists: ${identifier}`,
      { resource, identifier, ...context }
    );
    this.name = "AlreadyExistsError";
  }
}

/**
 * Validation errors
 */
export class ValidationError extends MeritsError {
  constructor(field: string, message: string, context?: Record<string, any>) {
    super(
      "VALIDATION_ERROR",
      `Validation failed for ${field}: ${message}`,
      { field, ...context }
    );
    this.name = "ValidationError";
  }
}

/**
 * Permission errors
 */
export class PermissionError extends MeritsError {
  constructor(action: string, context?: Record<string, any>) {
    super(
      "PERMISSION_DENIED",
      `Permission denied: ${action}`,
      { action, ...context }
    );
    this.name = "PermissionError";
  }
}

/**
 * Access control errors
 */
export class AccessDeniedError extends MeritsError {
  constructor(reason: string, context?: Record<string, any>) {
    super(
      "ACCESS_DENIED",
      `Access denied: ${reason}`,
      { reason, ...context }
    );
    this.name = "AccessDeniedError";
  }
}

// Trigger redeployment
