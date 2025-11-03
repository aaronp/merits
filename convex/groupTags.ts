/**
 * Group Tags - System-defined group identifiers
 *
 * Tags are unique identifiers for system-managed groups.
 * They allow reliable lookup of special groups like onboarding, support, etc.
 *
 * Usage:
 * - Tags must be unique across all groups
 * - Regular user-created groups don't have tags
 * - Only system/admin operations can set tags
 */

/**
 * Valid group tags
 */
export const GROUP_TAGS = {
  ONBOARDING: "onboarding",
} as const;

export type GroupTag = typeof GROUP_TAGS[keyof typeof GROUP_TAGS];
