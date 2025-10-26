/**
 * Output Formatters
 *
 * Three modes: json, text, compact
 * Async signatures for future vault decryption support
 * Colorized output with chalk
 */

import chalk from "chalk";
import type { MeritsVault } from "./vault/MeritsVault";

/**
 * Output format types
 */
export type OutputFormat = "json" | "text" | "compact";

/**
 * Encrypted message structure (from Transport interface)
 */
export interface EncryptedMessage {
  id: string;
  from: string;
  to: string;
  ct: string;
  typ: string;
  ek?: string;
  alg?: string;
  ttlMs: number;
  createdAt: number;
  sig: string[];
  ksn: number;
}

/**
 * Formatter options
 */
export interface FormatOptions {
  verbose?: boolean;
  color?: boolean;
  vault?: MeritsVault;
  identityName?: string;
}

/**
 * Format messages for output
 *
 * @param messages - Array of encrypted messages
 * @param format - Output format (json|text|compact)
 * @param options - Formatting options
 * @returns Formatted string
 *
 * @example
 * ```typescript
 * const output = await formatMessages(messages, 'text', { verbose: true, color: true });
 * console.log(output);
 * ```
 */
export async function formatMessages(
  messages: EncryptedMessage[],
  format: OutputFormat,
  options: FormatOptions = {}
): Promise<string> {
  switch (format) {
    case "json":
      return formatJSON(messages, options);
    case "text":
      return await formatText(messages, options);
    case "compact":
      return await formatCompact(messages, options);
    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

/**
 * Format as JSON
 */
function formatJSON(
  messages: EncryptedMessage[],
  options: FormatOptions
): string {
  if (options.verbose) {
    return JSON.stringify(messages, null, 2);
  }

  // Minimal JSON (no signatures, metadata)
  const minimal = messages.map((msg) => ({
    id: msg.id,
    from: msg.from,
    to: msg.to,
    typ: msg.typ,
    ct: msg.ct,
  }));

  return JSON.stringify(minimal, null, 2);
}

/**
 * Format as human-readable text
 */
async function formatText(
  messages: EncryptedMessage[],
  options: FormatOptions
): Promise<string> {
  const color = options.color ?? true;
  const lines: string[] = [];

  for (const msg of messages) {
    const fromLabel = color ? chalk.blue("From:") : "From:";
    const toLabel = color ? chalk.blue("To:") : "To:";
    const typeLabel = color ? chalk.blue("Type:") : "Type:";
    const timeLabel = color ? chalk.blue("Time:") : "Time:";

    lines.push(`${fromLabel} ${msg.from}`);
    lines.push(`${toLabel} ${msg.to}`);
    lines.push(`${typeLabel} ${msg.typ}`);
    lines.push(`${timeLabel} ${formatTimestamp(msg.createdAt)}`);

    // Decrypt if vault provided
    if (options.vault && options.identityName) {
      try {
        const plaintext = await options.vault.decrypt(
          options.identityName,
          msg.ct,
          { ek: msg.ek, alg: msg.alg }
        );
        const contentLabel = color ? chalk.green("Content:") : "Content:";
        lines.push(`${contentLabel} ${plaintext}`);
      } catch (err) {
        const ctLabel = color ? chalk.yellow("Ciphertext:") : "Ciphertext:";
        lines.push(`${ctLabel} ${truncate(msg.ct, 64)}`);
      }
    } else {
      const ctLabel = color ? chalk.yellow("Ciphertext:") : "Ciphertext:";
      lines.push(`${ctLabel} ${truncate(msg.ct, 64)}`);
    }

    if (options.verbose) {
      const idLabel = color ? chalk.dim("ID:") : "ID:";
      const sigLabel = color ? chalk.dim("Signature:") : "Signature:";
      const ksnLabel = color ? chalk.dim("KSN:") : "KSN:";

      lines.push(`${idLabel} ${msg.id}`);
      lines.push(`${sigLabel} ${msg.sig.join(", ")}`);
      lines.push(`${ksnLabel} ${msg.ksn}`);

      if (msg.ek) {
        const ekLabel = color ? chalk.dim("Ephemeral Key:") : "Ephemeral Key:";
        lines.push(`${ekLabel} ${msg.ek}`);
      }
      if (msg.alg) {
        const algLabel = color ? chalk.dim("Algorithm:") : "Algorithm:";
        lines.push(`${algLabel} ${msg.alg}`);
      }
    }

    lines.push(""); // Blank line between messages
  }

  return lines.join("\n");
}

/**
 * Format as compact one-line-per-message
 */
async function formatCompact(
  messages: EncryptedMessage[],
  options: FormatOptions
): Promise<string> {
  const color = options.color ?? true;
  const lines: string[] = [];

  for (const msg of messages) {
    const time = formatTimestamp(msg.createdAt);
    const from = truncate(msg.from, 12);
    const typ = msg.typ;

    let line: string;

    // Try to decrypt if vault provided
    if (options.vault && options.identityName) {
      try {
        const plaintext = await options.vault.decrypt(
          options.identityName,
          msg.ct,
          { ek: msg.ek, alg: msg.alg }
        );
        const content = truncate(plaintext, 40);
        line = `${time} ${from} [${typ}] ${content}`;
      } catch (err) {
        const ct = truncate(msg.ct, 40);
        line = `${time} ${from} [${typ}] <encrypted: ${ct}>`;
      }
    } else {
      const ct = truncate(msg.ct, 40);
      line = `${time} ${from} [${typ}] <encrypted: ${ct}>`;
    }

    lines.push(color ? chalk.white(line) : line);
  }

  return lines.join("\n");
}

/**
 * Format identity for output
 */
export async function formatIdentity(
  name: string,
  identity: {
    aid: string;
    ksn: number;
    metadata?: Record<string, any>;
  },
  format: OutputFormat,
  options: FormatOptions = {}
): Promise<string> {
  const color = options.color ?? true;

  switch (format) {
    case "json":
      return JSON.stringify({ name, ...identity }, null, 2);

    case "text": {
      const nameLabel = color ? chalk.blue("Name:") : "Name:";
      const aidLabel = color ? chalk.blue("AID:") : "AID:";
      const ksnLabel = color ? chalk.blue("KSN:") : "KSN:";

      const lines = [
        `${nameLabel} ${name}`,
        `${aidLabel} ${identity.aid}`,
        `${ksnLabel} ${identity.ksn}`,
      ];

      if (identity.metadata && options.verbose) {
        const metaLabel = color ? chalk.blue("Metadata:") : "Metadata:";
        lines.push(`${metaLabel} ${JSON.stringify(identity.metadata, null, 2)}`);
      }

      return lines.join("\n");
    }

    case "compact":
      return `${name} (${truncate(identity.aid, 24)}) KSN=${identity.ksn}`;

    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

/**
 * Format group for output
 */
export async function formatGroup(
  group: {
    id: string;
    name: string;
    members: string[];
    createdAt: number;
  },
  format: OutputFormat,
  options: FormatOptions = {}
): Promise<string> {
  const color = options.color ?? true;

  switch (format) {
    case "json":
      return JSON.stringify(group, null, 2);

    case "text": {
      const idLabel = color ? chalk.blue("ID:") : "ID:";
      const nameLabel = color ? chalk.blue("Name:") : "Name:";
      const membersLabel = color ? chalk.blue("Members:") : "Members:";
      const createdLabel = color ? chalk.blue("Created:") : "Created:";

      const lines = [
        `${idLabel} ${group.id}`,
        `${nameLabel} ${group.name}`,
        `${membersLabel} ${group.members.length}`,
        `${createdLabel} ${formatTimestamp(group.createdAt)}`,
      ];

      if (options.verbose) {
        lines.push("");
        lines.push("Member AIDs:");
        for (const aid of group.members) {
          lines.push(`  - ${aid}`);
        }
      }

      return lines.join("\n");
    }

    case "compact":
      return `${group.name} (${group.members.length} members) - ${formatTimestamp(group.createdAt)}`;

    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

// --- Helpers ---

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * Format timestamp as human-readable string
 */
function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  return date.toISOString().replace("T", " ").slice(0, 19);
}
