/**
 * Performance Benchmark: Subprocess vs In-Process CLI Execution
 *
 * This benchmark demonstrates the performance improvement of in-process testing
 * compared to traditional subprocess-based testing.
 *
 * Expected results:
 * - Subprocess: ~50-150ms per command (process spawn overhead)
 * - In-process: ~3-15ms per command (no spawn overhead)
 * - Speedup: 10-50x faster
 *
 * Run with: bun test tests/cli/performance/subprocess-vs-inprocess.bench.ts
 */

import { describe, it, expect } from "bun:test";
import { $ } from "bun";
import { runCliInProcess } from "../helpers/exec";

/**
 * Run CLI command via subprocess (traditional approach)
 */
async function runViaSubprocess(args: string[]): Promise<any> {
  const cliArgs = ["run", "cli/index.ts", ...args];
  const env = { ...process.env, MERITS_VAULT_QUIET: "1" };
  const result = await $`bun ${cliArgs}`.env(env).text();
  return JSON.parse(result.trim());
}

/**
 * Measure execution time in milliseconds
 */
function measure(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  return fn().then(() => performance.now() - start);
}

describe("Performance: Subprocess vs In-Process", () => {
  it("benchmark: gen-key with seed (10 iterations)", async () => {
    const iterations = 10;

    // Warmup (JIT compilation, caching, etc.)
    await runViaSubprocess(["gen-key", "--seed", "warmup"]);
    await runCliInProcess(["gen-key", "--seed", "warmup"], {
      env: { MERITS_VAULT_QUIET: "1" }
    });

    // Benchmark subprocess execution
    const subprocessTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const time = await measure(async () => {
        await runViaSubprocess(["gen-key", "--seed", `test-${i}`]);
      });
      subprocessTimes.push(time);
    }

    // Benchmark in-process execution
    const inprocessTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const time = await measure(async () => {
        await runCliInProcess(["gen-key", "--seed", `test-${i}`], {
          env: { MERITS_VAULT_QUIET: "1" }
        });
      });
      inprocessTimes.push(time);
    }

    // Calculate statistics
    const subprocessAvg = subprocessTimes.reduce((a, b) => a + b, 0) / iterations;
    const inprocessAvg = inprocessTimes.reduce((a, b) => a + b, 0) / iterations;
    const speedup = subprocessAvg / inprocessAvg;

    // Calculate standard deviation
    const subprocessStd = Math.sqrt(
      subprocessTimes.map(t => (t - subprocessAvg) ** 2).reduce((a, b) => a + b, 0) / iterations
    );
    const inprocessStd = Math.sqrt(
      inprocessTimes.map(t => (t - inprocessAvg) ** 2).reduce((a, b) => a + b, 0) / iterations
    );

    // Log results
    console.log("\n=== Performance Benchmark Results ===");
    console.log(`Iterations: ${iterations}`);
    console.log(`\nSubprocess Execution:`);
    console.log(`  Average: ${subprocessAvg.toFixed(2)}ms`);
    console.log(`  StdDev:  ${subprocessStd.toFixed(2)}ms`);
    console.log(`  Min:     ${Math.min(...subprocessTimes).toFixed(2)}ms`);
    console.log(`  Max:     ${Math.max(...subprocessTimes).toFixed(2)}ms`);
    console.log(`\nIn-Process Execution:`);
    console.log(`  Average: ${inprocessAvg.toFixed(2)}ms`);
    console.log(`  StdDev:  ${inprocessStd.toFixed(2)}ms`);
    console.log(`  Min:     ${Math.min(...inprocessTimes).toFixed(2)}ms`);
    console.log(`  Max:     ${Math.max(...inprocessTimes).toFixed(2)}ms`);
    console.log(`\nSpeedup: ${speedup.toFixed(1)}x faster`);
    console.log(`Time saved per test: ${(subprocessAvg - inprocessAvg).toFixed(2)}ms`);
    console.log(`=====================================\n`);

    // Assertions
    expect(inprocessAvg).toBeLessThan(subprocessAvg);
    expect(speedup).toBeGreaterThan(5); // At least 5x faster
  }, 60000); // 60 second timeout for benchmark

  it("single execution comparison", async () => {
    // Single subprocess execution
    const subprocessTime = await measure(async () => {
      await runViaSubprocess(["gen-key", "--seed", "single-test"]);
    });

    // Single in-process execution
    const inprocessTime = await measure(async () => {
      await runCliInProcess(["gen-key", "--seed", "single-test"], {
        env: { MERITS_VAULT_QUIET: "1" }
      });
    });

    console.log(`\nSingle Execution:`);
    console.log(`  Subprocess: ${subprocessTime.toFixed(2)}ms`);
    console.log(`  In-Process: ${inprocessTime.toFixed(2)}ms`);
    console.log(`  Speedup:    ${(subprocessTime / inprocessTime).toFixed(1)}x\n`);

    // In-process should be significantly faster
    expect(inprocessTime).toBeLessThan(subprocessTime);
  });

  it("batch execution comparison (50 commands)", async () => {
    const batchSize = 50;

    // Subprocess batch
    const subprocessStart = performance.now();
    for (let i = 0; i < batchSize; i++) {
      await runViaSubprocess(["gen-key", "--seed", `batch-${i}`]);
    }
    const subprocessTotal = performance.now() - subprocessStart;

    // In-process batch
    const inprocessStart = performance.now();
    for (let i = 0; i < batchSize; i++) {
      await runCliInProcess(["gen-key", "--seed", `batch-${i}`], {
        env: { MERITS_VAULT_QUIET: "1" }
      });
    }
    const inprocessTotal = performance.now() - inprocessStart;

    const speedup = subprocessTotal / inprocessTotal;
    const timeSaved = subprocessTotal - inprocessTotal;

    console.log(`\nBatch Execution (${batchSize} commands):`);
    console.log(`  Subprocess: ${subprocessTotal.toFixed(0)}ms (${(subprocessTotal / batchSize).toFixed(1)}ms per cmd)`);
    console.log(`  In-Process: ${inprocessTotal.toFixed(0)}ms (${(inprocessTotal / batchSize).toFixed(1)}ms per cmd)`);
    console.log(`  Speedup:    ${speedup.toFixed(1)}x faster`);
    console.log(`  Time saved: ${timeSaved.toFixed(0)}ms (${(timeSaved / 1000).toFixed(1)}s)\n`);

    expect(inprocessTotal).toBeLessThan(subprocessTotal);
    expect(speedup).toBeGreaterThan(5);
  }, 120000); // 120 second timeout for large batch
});

describe("Correctness: Both Methods Produce Same Output", () => {
  it("subprocess and in-process produce identical results", async () => {
    const seed = "correctness-test-123";

    // Run via subprocess
    const subprocessResult = await runViaSubprocess(["gen-key", "--seed", seed]);

    // Run in-process
    const inprocessResult = await runCliInProcess(["gen-key", "--seed", seed], {
      env: { MERITS_VAULT_QUIET: "1" }
    });

    // Both should produce identical output
    expect(inprocessResult.json).toEqual(subprocessResult);
    expect(inprocessResult.json.aid).toBe(subprocessResult.aid);
    expect(inprocessResult.json.privateKey).toBe(subprocessResult.privateKey);
    expect(inprocessResult.json.publicKey).toBe(subprocessResult.publicKey);
  });

  it("both methods are deterministic", async () => {
    const seed = "deterministic-test-456";

    // Subprocess run 1
    const sub1 = await runViaSubprocess(["gen-key", "--seed", seed]);

    // Subprocess run 2
    const sub2 = await runViaSubprocess(["gen-key", "--seed", seed]);

    // In-process run 1
    const inp1 = await runCliInProcess(["gen-key", "--seed", seed], {
      env: { MERITS_VAULT_QUIET: "1" }
    });

    // In-process run 2
    const inp2 = await runCliInProcess(["gen-key", "--seed", seed], {
      env: { MERITS_VAULT_QUIET: "1" }
    });

    // All runs should produce identical results
    expect(sub1).toEqual(sub2);
    expect(inp1.json).toEqual(inp2.json);
    expect(sub1).toEqual(inp1.json);
  });
});
