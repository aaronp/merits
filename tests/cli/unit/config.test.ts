/**
 * Config Management Tests
 *
 * Tests for configuration loading, validation, and precedence.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  loadConfig,
  saveConfig,
  initConfig,
  ConfigError,
  DEFAULT_CONFIG,
} from "../../../cli/lib/config";

describe("Config Management", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "merits-test-"));
    configPath = path.join(tempDir, "config.json");
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // Clean up env vars
    delete process.env.CONVEX_URL;
    delete process.env.MERITS_OUTPUT_FORMAT;
    delete process.env.MERITS_WATCH_INTERVAL;
    delete process.env.MERITS_DEFAULT_IDENTITY;
    delete process.env.MERITS_VERBOSE;
    delete process.env.NO_COLOR;
  });

  test("loads defaults when no config file exists", () => {
    const config = loadConfig(configPath, {
      convexUrl: "https://example.convex.cloud",
    });

    expect(config.version).toBe(1);
    expect(config.outputFormat).toBe("text");
    expect(config.watchInterval).toBe(1000);
    expect(config.verbose).toBe(false);
    expect(config.color).toBe(true);
  });

  test("loads config from file", () => {
    const fileConfig = {
      version: 1,
      convexUrl: "https://file.convex.cloud",
      outputFormat: "json" as const,
      watchInterval: 2000,
    };

    fs.writeFileSync(configPath, JSON.stringify(fileConfig, null, 2));

    const config = loadConfig(configPath);

    expect(config.convexUrl).toBe("https://file.convex.cloud");
    expect(config.outputFormat).toBe("json");
    expect(config.watchInterval).toBe(2000);
  });

  test("environment variables override file config", () => {
    const fileConfig = {
      version: 1,
      convexUrl: "https://file.convex.cloud",
      outputFormat: "json" as const,
    };

    fs.writeFileSync(configPath, JSON.stringify(fileConfig, null, 2));

    process.env.CONVEX_URL = "https://env.convex.cloud";
    process.env.MERITS_OUTPUT_FORMAT = "text";

    const config = loadConfig(configPath);

    expect(config.convexUrl).toBe("https://env.convex.cloud");
    expect(config.outputFormat).toBe("text");
  });

  test("CLI flags override everything", () => {
    const fileConfig = {
      version: 1,
      convexUrl: "https://file.convex.cloud",
      outputFormat: "json" as const,
    };

    fs.writeFileSync(configPath, JSON.stringify(fileConfig, null, 2));

    process.env.CONVEX_URL = "https://env.convex.cloud";

    const config = loadConfig(configPath, {
      convexUrl: "https://cli.convex.cloud",
      outputFormat: "compact",
    });

    expect(config.convexUrl).toBe("https://cli.convex.cloud");
    expect(config.outputFormat).toBe("compact");
  });

  test("throws error if convexUrl is missing", () => {
    expect(() => loadConfig(configPath)).toThrow(ConfigError);
  });

  test("validates config schema", () => {
    const invalidConfig = {
      version: 1,
      convexUrl: "https://example.convex.cloud",
      outputFormat: "invalid",
    };

    fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

    expect(() => loadConfig(configPath)).toThrow(ConfigError);
  });

  test("validates watchInterval range", () => {
    const invalidConfig = {
      version: 1,
      convexUrl: "https://example.convex.cloud",
      watchInterval: 50, // Too low
    };

    fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

    expect(() => loadConfig(configPath)).toThrow(ConfigError);
  });

  test("saves config with secure permissions", () => {
    const config = {
      version: 1,
      convexUrl: "https://example.convex.cloud",
      outputFormat: "text" as const,
    };

    saveConfig(config, configPath);

    expect(fs.existsSync(configPath)).toBe(true);

    // Check permissions (0600)
    const stats = fs.statSync(configPath);
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);

    // Check content
    const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(saved.convexUrl).toBe("https://example.convex.cloud");
  });

  test("initConfig creates config file", () => {
    initConfig(configPath, {
      convexUrl: "https://example.convex.cloud",
    });

    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.version).toBe(1);
    expect(config.convexUrl).toBe("https://example.convex.cloud");
  });

  test("initConfig throws if file already exists", () => {
    initConfig(configPath, {
      convexUrl: "https://example.convex.cloud",
    });

    expect(() =>
      initConfig(configPath, {
        convexUrl: "https://example.convex.cloud",
      })
    ).toThrow(ConfigError);
  });

  test("handles malformed JSON in config file", () => {
    fs.writeFileSync(configPath, "{ invalid json }");

    expect(() =>
      loadConfig(configPath, {
        convexUrl: "https://example.convex.cloud",
      })
    ).toThrow();
  });

  test("parses NO_COLOR environment variable", () => {
    process.env.NO_COLOR = "1";

    const config = loadConfig(configPath, {
      convexUrl: "https://example.convex.cloud",
    });

    expect(config.color).toBe(false);
  });

  test("parses MERITS_VERBOSE environment variable", () => {
    process.env.MERITS_VERBOSE = "true";

    const config = loadConfig(configPath, {
      convexUrl: "https://example.convex.cloud",
    });

    expect(config.verbose).toBe(true);
  });
});
