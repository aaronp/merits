/**
 * Configuration Management
 *
 * 4-layer precedence: CLI flags > env vars > config file > defaults
 * Config location: ~/.merits/config.json
 * Secure permissions: 0600
 * Schema validation with Ajv
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Configuration schema (backend-agnostic)
 */
export interface MeritsConfig {
  version: number;
  backend?: {
    type: "convex" | "rest" | "local";
    url: string;
  };
  outputFormat?: "json" | "text" | "compact";
  watchInterval?: number; // milliseconds
  defaultIdentity?: string;
  verbose?: boolean;
  color?: boolean;
}

/**
 * Config with required backend (after resolution)
 */
export interface ResolvedConfig extends Omit<Required<MeritsConfig>, 'backend'> {
  backend: {
    type: "convex" | "rest" | "local";
    url: string;
  };
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: MeritsConfig = {
  version: 1,
  outputFormat: "text",
  watchInterval: 1000,
  verbose: false,
  color: true,
};

/**
 * JSON schema for validation
 */
const CONFIG_SCHEMA = {
  type: "object",
  properties: {
    version: { type: "number", enum: [1] },
    backend: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["convex", "rest", "local"] },
        url: { type: "string", format: "uri" },
      },
      required: ["type", "url"],
      additionalProperties: false,
    },
    outputFormat: { type: "string", enum: ["json", "text", "compact"] },
    watchInterval: { type: "number", minimum: 100, maximum: 30000 },
    defaultIdentity: { type: "string", minLength: 1 },
    verbose: { type: "boolean" },
    color: { type: "boolean" },
  },
  required: ["version"],
  additionalProperties: false,
};

/**
 * Config validation error
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    public code: "INVALID_SCHEMA" | "FILE_ERROR" | "MISSING_REQUIRED"
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Load configuration with 4-layer precedence
 *
 * @param configPath - Path to config file (default: ~/.merits/config.json)
 * @param overrides - CLI flags and env var overrides
 * @returns Merged and validated configuration
 *
 * @example
 * ```typescript
 * const config = loadConfig('~/.merits/config.json', {
 *   convexUrl: process.env.CONVEX_URL,
 *   outputFormat: opts.format,
 *   verbose: opts.verbose,
 * });
 * ```
 */
export function loadConfig(
  configPath?: string,
  overrides?: Partial<MeritsConfig>
): ResolvedConfig {
  // 1. Start with defaults
  let config: MeritsConfig = { ...DEFAULT_CONFIG };

  // 2. Load from file
  const filePath = resolveConfigPath(configPath);
  if (fs.existsSync(filePath)) {
    try {
      const fileConfig = loadConfigFile(filePath);
      config = { ...config, ...fileConfig };
    } catch (err) {
      if (err instanceof ConfigError) throw err;
      const error = new ConfigError(
        `Failed to load config from ${filePath}: ${err}`,
        "FILE_ERROR"
      );
      throw error;
    }
  }

  // 3. Apply environment variables
  const envConfig = loadEnvConfig();
  config = { ...config, ...envConfig };

  // 4. Apply CLI overrides
  if (overrides) {
    config = { ...config, ...filterUndefined(overrides) };
  }

  // Validate final config
  validateConfig(config);

  // Ensure required fields are present
  if (!config.backend) {
    const error = new ConfigError(
      "backend is required (set via --backend-url + --backend-type, CONVEX_URL env var, or config file)",
      "MISSING_REQUIRED"
    );
    throw error;
  }

  if (!config.backend.url) {
    const error = new ConfigError(
      "backend.url is required (set via --backend-url, CONVEX_URL env var, or config file)",
      "MISSING_REQUIRED"
    );
    throw error;
  }

  return config as ResolvedConfig;
}

/**
 * Save configuration to file
 *
 * @param config - Configuration to save
 * @param configPath - Path to config file (default: ~/.merits/config.json)
 */
export function saveConfig(
  config: MeritsConfig,
  configPath?: string
): void {
  const filePath = resolveConfigPath(configPath);
  const dir = path.dirname(filePath);

  // Ensure directory exists with secure permissions
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // Validate before saving
  validateConfig(config);

  // Write with secure permissions
  const json = JSON.stringify(config, null, 2);
  fs.writeFileSync(filePath, json, { mode: 0o600 });
}

/**
 * Initialize config file with defaults if it doesn't exist
 *
 * @param configPath - Path to config file (default: ~/.merits/config.json)
 * @param initialConfig - Initial configuration values
 */
export function initConfig(
  configPath?: string,
  initialConfig?: Partial<MeritsConfig>
): void {
  const filePath = resolveConfigPath(configPath);

  if (fs.existsSync(filePath)) {
    throw new ConfigError(
      `Config file already exists at ${filePath}`,
      "FILE_ERROR"
    );
  }

  const config: MeritsConfig = {
    ...DEFAULT_CONFIG,
    ...filterUndefined(initialConfig || {}),
  };

  saveConfig(config, filePath);
}

// --- Private helpers ---

/**
 * Resolve config file path
 */
function resolveConfigPath(configPath?: string): string {
  if (configPath) {
    return configPath.startsWith("~")
      ? path.join(os.homedir(), configPath.slice(1))
      : path.resolve(configPath);
  }
  return path.join(os.homedir(), ".merits", "config.json");
}

/**
 * Load config from file
 */
function loadConfigFile(filePath: string): Partial<MeritsConfig> {
  const json = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(json);
}

/**
 * Load config from environment variables
 *
 * MIGRATION: Still accepts CONVEX_URL for backward compatibility
 */
function loadEnvConfig(): Partial<MeritsConfig> {
  const config: Partial<MeritsConfig> = {};

  // NEW: Explicit backend config
  if (process.env.MERITS_BACKEND_TYPE && process.env.MERITS_BACKEND_URL) {
    const type = process.env.MERITS_BACKEND_TYPE;
    if (type === "convex" || type === "rest" || type === "local") {
      config.backend = {
        type,
        url: process.env.MERITS_BACKEND_URL,
      };
    }
  }
  // LEGACY: Map CONVEX_URL to backend config for backward compatibility
  else if (process.env.CONVEX_URL) {
    config.backend = {
      type: "convex",
      url: process.env.CONVEX_URL,
    };
  }

  if (process.env.MERITS_OUTPUT_FORMAT) {
    const format = process.env.MERITS_OUTPUT_FORMAT;
    if (format === "json" || format === "text" || format === "compact") {
      config.outputFormat = format;
    }
  }

  if (process.env.MERITS_WATCH_INTERVAL) {
    const interval = parseInt(process.env.MERITS_WATCH_INTERVAL, 10);
    if (!isNaN(interval)) {
      config.watchInterval = interval;
    }
  }

  if (process.env.MERITS_DEFAULT_IDENTITY) {
    config.defaultIdentity = process.env.MERITS_DEFAULT_IDENTITY;
  }

  if (process.env.MERITS_VERBOSE === "true" || process.env.MERITS_VERBOSE === "1") {
    config.verbose = true;
  }

  if (process.env.NO_COLOR === "1" || process.env.NO_COLOR === "true") {
    config.color = false;
  }

  return config;
}

/**
 * Validate config against schema
 */
function validateConfig(config: MeritsConfig): void {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv); // Add format validators (uri, etc.)
  const validate = ajv.compile(CONFIG_SCHEMA);

  if (!validate(config)) {
    const errors = validate.errors
      ?.map((err) => `${err.instancePath} ${err.message}`)
      .join(", ");
    const error = new ConfigError(
      `Invalid configuration: ${errors}`,
      "INVALID_SCHEMA"
    );
    throw error;
  }
}

/**
 * Filter out undefined values from object
 */
function filterUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key as keyof T] = value;
    }
  }
  return result;
}
