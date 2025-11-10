/**
 * Configuration Management
 *
 * 5-layer precedence: CLI flags > env vars > .meritsrc (cwd) > config file > defaults
 * Config locations:
 *   - ./.meritsrc (project-level, created by incept)
 *   - ~/.merits/config.json (global)
 * Secure permissions: 0600
 * Schema validation with Ajv
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Default backend URL for development
 * Used when no backend is configured anywhere
 */
export const DEFAULT_BACKEND_URL = "https://accurate-penguin-901.convex.cloud";

/**
 * Project-level config (stored in CWD after incept)
 */
export interface ProjectConfig {
  backend: {
    type: "convex" | "rest" | "local";
    url: string;
  };
  credentials?: {
    aid: string;
    privateKey: string;
    publicKey: string;
    ksn: number;
  };
}

/**
 * Configuration schema (backend-agnostic)
 */
export interface MeritsConfig {
  version: number;
  dataDir?: string; // Override data directory (for testing)
  backend?: {
    type: "convex" | "rest" | "local";
    url: string;
  };
  outputFormat?: "json" | "pretty" | "raw";
  watchInterval?: number; // milliseconds
  verbose?: boolean;
  color?: boolean;
  defaultIdentity?: string; // Default identity AID
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
  outputFormat: "json", // Changed default to json per cli.md spec
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
    dataDir: { type: "string", minLength: 1 },
    backend: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["convex", "rest", "local"] },
        url: { type: "string", format: "uri" },
      },
      required: ["type", "url"],
      additionalProperties: false,
    },
    outputFormat: { type: "string", enum: ["json", "pretty", "raw"] },
    watchInterval: { type: "number", minimum: 100, maximum: 30000 },
    verbose: { type: "boolean" },
    color: { type: "boolean" },
    defaultIdentity: { type: "string", minLength: 1 },
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
 * Resolve base data directory
 *
 * @param config - Configuration object
 * @returns Absolute path to data directory
 */
export function resolveDataDir(config: Partial<MeritsConfig>): string {
  if (config.dataDir) {
    return path.resolve(config.dataDir);
  }
  return path.join(os.homedir(), ".merits");
}

/**
 * Resolve config file path based on dataDir
 *
 * @param config - Configuration object
 * @returns Absolute path to config.json
 */
export function resolveConfigPath(config: Partial<MeritsConfig>): string {
  return path.join(resolveDataDir(config), "config.json");
}

/**
 * Resolve vault metadata path based on dataDir
 *
 * @param config - Configuration object
 * @returns Absolute path to identities.json
 */
export function resolveVaultPath(config: Partial<MeritsConfig>): string {
  return path.join(resolveDataDir(config), "identities.json");
}

/**
 * Load configuration with 5-layer precedence
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
  let usingDefaultBackend = false;

  // 1. Start with defaults
  let config: MeritsConfig = { ...DEFAULT_CONFIG };

  // 2. Load from global config file
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

  // 3. Load from project-level .merits file (CWD)
  const projectConfig = loadProjectConfig();
  if (projectConfig) {
    config.backend = projectConfig.backend;
  }

  // 4. Apply environment variables
  const envConfig = loadEnvConfig();
  config = { ...config, ...envConfig };

  // 5. Apply CLI overrides
  if (overrides) {
    config = { ...config, ...filterUndefined(overrides) };
  }

  // 6. Fall back to default backend if still not set
  if (!config.backend) {
    config.backend = {
      type: "convex",
      url: DEFAULT_BACKEND_URL,
    };
    usingDefaultBackend = true;
  }

  // Validate final config
  validateConfig(config);

  // Show warning if using default backend
  if (usingDefaultBackend && !process.env.MERITS_VAULT_QUIET) {
    console.warn(
      `⚠️  Using default development backend: ${DEFAULT_BACKEND_URL}`
    );
    console.warn(
      `   Set CONVEX_URL, use --convex-url, or run 'merits incept' to configure`
    );
    console.warn("");
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

  // Data directory override
  if (process.env.MERITS_DATA_DIR) {
    config.dataDir = process.env.MERITS_DATA_DIR;
  }

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
    if (format === "json" || format === "pretty" || format === "raw") {
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

/**
 * Load project-level config from .meritsrc in CWD
 */
function loadProjectConfig(): ProjectConfig | null {
  const projectConfigPath = path.join(process.cwd(), ".meritsrc");
  if (!fs.existsSync(projectConfigPath)) {
    return null;
  }

  try {
    const json = fs.readFileSync(projectConfigPath, "utf-8");
    return JSON.parse(json);
  } catch (err) {
    // Silently ignore errors - project config is optional
    return null;
  }
}

/**
 * Save project-level config to .meritsrc in CWD
 */
export function saveProjectConfig(config: ProjectConfig): void {
  const projectConfigPath = path.join(process.cwd(), ".meritsrc");

  // Write with secure permissions
  const json = JSON.stringify(config, null, 2);
  fs.writeFileSync(projectConfigPath, json, { mode: 0o600 });
}

/**
 * Load credentials from project-level .meritsrc file
 */
export function loadProjectCredentials(): ProjectConfig["credentials"] | null {
  const projectConfig = loadProjectConfig();
  return projectConfig?.credentials || null;
}
