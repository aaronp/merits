/**
 * Output Formatters
 *
 * Three modes: json (default), pretty (indented JSON), raw (minimal JSON)
 * Async signatures for future vault decryption support
 * Colorized output with chalk
 * RFC8785 canonicalized JSON for deterministic test snapshots
 */

import chalk from "chalk";

/**
 * Output format types (updated to match cli.md spec)
 */
export type OutputFormat = "json" | "pretty" | "raw";

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
    case "pretty":
      return formatPretty(messages, options);
    case "raw":
      return formatRaw(messages, options);
    default:
      throw new Error(`Unknown format: ${format}. Must be one of: json, pretty, raw`);
  }
}

/**
 * Format as JSON (canonicalized for deterministic snapshots)
 */
function formatJSON(
  messages: EncryptedMessage[],
  options: FormatOptions
): string {
  // Determine data to include
  const data = options.verbose
    ? messages
    : messages.map((msg) => ({
        id: msg.id,
        from: msg.from,
        to: msg.to,
        typ: msg.typ,
        ct: msg.ct,
      }));

  // Use canonical JSON (RFC8785) for deterministic output
  return canonicalizeJSON(data);
}

/**
 * Format as pretty (indented JSON)
 */
function formatPretty(
  messages: EncryptedMessage[],
  options: FormatOptions
): string {
  const data = options.verbose
    ? messages
    : messages.map((msg) => ({
        id: msg.id,
        from: msg.from,
        to: msg.to,
        typ: msg.typ,
        ct: msg.ct,
      }));

  return JSON.stringify(data, null, 2);
}

/**
 * Format as raw (minimal JSON, no indentation)
 */
function formatRaw(
  messages: EncryptedMessage[],
  options: FormatOptions
): string {
  const data = options.verbose
    ? messages
    : messages.map((msg) => ({
        id: msg.id,
        from: msg.from,
        to: msg.to,
        typ: msg.typ,
        ct: msg.ct,
      }));

  return JSON.stringify(data);
}

/**
 * Canonicalize JSON according to RFC8785
 * - Sort object keys deterministically
 * - No whitespace (except for pretty format)
 */
function canonicalizeJSON(obj: any): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalizeJSON).join(",")}]`;
  }

  // Sort object keys
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map((key) => {
    return `${JSON.stringify(key)}:${canonicalizeJSON(obj[key])}`;
  });

  return `{${entries.join(",")}}`;
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

    // Show ciphertext (decryption handled by backend)
    const ctLabel = color ? chalk.yellow("Ciphertext:") : "Ciphertext:";
    lines.push(`${ctLabel} ${truncate(msg.ct, 64)}`);

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

// Removed formatCompact - replaced by "raw" format

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

    case "pretty": {
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

    case "raw":
      return JSON.stringify({ name, ...identity });

    default:
      throw new Error(`Unknown format: ${format}. Must be one of: json, pretty, raw`);
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

    case "pretty": {
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

    case "raw":
      return JSON.stringify(group);

    default:
      throw new Error(`Unknown format: ${format}. Must be one of: json, pretty, raw`);
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
