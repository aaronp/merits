# Performance Testing Suite

## Overview

We've added comprehensive performance benchmarks to validate the Merits messaging system at scale.

## Test Files

### 1. `performance.test.ts` - Comprehensive Benchmarks

Full performance test suite with detailed metrics:

- **Direct Message Send**: 100 messages, detailed percentile analysis
- **Direct Message Receive**: 100 queries of inbox with 50 messages
- **Group Messages**: Tests with 10, 50, 100, and 300 members

**Run time**: 10-60 minutes depending on tests selected

**Usage**:
```bash
# All tests (will take a long time!)
CONVEX_URL=<your-url> bun test ./tests/cli/e2e/performance.test.ts --timeout 600000

# Single group size
CONVEX_URL=<your-url> bun test ./tests/cli/e2e/performance.test.ts -t "10 members"
```

### 2. `performance-quick.test.ts` - Quick CI Tests

Faster performance validation suitable for CI/CD:

- **Direct Messages**: 10 messages
- **Group Messages**: 5 members, 5 messages
- **Unread Queries**: 10 queries

**Run time**: 2-5 minutes

**Usage**:
```bash
CONVEX_URL=<your-url> bun test ./tests/cli/e2e/performance-quick.test.ts --timeout 130000
```

### 3. `PERFORMANCE.md` - Detailed Documentation

Complete guide including:
- How to run each test
- Performance targets and SLAs
- Interpreting results
- Troubleshooting guide

## Key Metrics Tracked

### Latency Metrics
- **Average (mean)**: Overall performance
- **P50 (median)**: Typical user experience
- **P95**: 95th percentile - nearly all users
- **P99**: 99th percentile - edge cases
- **Min/Max**: Best and worst case

### Operations Tested
- **Send latency**: Time to encrypt, sign, and transmit
- **Receive latency**: Time to query and decrypt
- **Group scaling**: Performance vs group size
- **Query performance**: Inbox retrieval speed

## Performance Targets

| Operation | Target (Average) | Target (P95) |
|-----------|------------------|--------------|
| Direct Send | < 5s | < 10s |
| Direct Receive | < 3s | < 5s |
| Group Send (10) | < 1.5s | < 3s |
| Group Send (50) | < 3.5s | < 6s |
| Group Send (100) | < 6s | < 10s |
| Group Send (300) | < 16s | < 25s |

## Example Output

```
📊 Performance Metrics: Direct Message Send
   Count:    100 operations
   Total:    145230.50ms
   Average:  1452.31ms
   Min:      982.45ms
   Max:      3201.12ms
   P50:      1389.23ms
   P95:      2104.67ms
   P99:      2890.45ms

✅ Performance acceptable (avg 1452.31ms < 5000ms)
```

## Running the Tests

### Prerequisites
1. Set `CONVEX_URL` environment variable
2. Ensure database is bootstrapped
3. Have sufficient test timeout configured

### Quick Validation (Recommended for Development)
```bash
# Fast smoke test (~2-5 minutes)
CONVEX_URL=https://your-deployment.convex.cloud \
  bun test ./tests/cli/e2e/performance-quick.test.ts
```

### Full Benchmarks (Recommended for Release Testing)
```bash
# Complete suite (~30-60 minutes)
CONVEX_URL=https://your-deployment.convex.cloud \
  bun test ./tests/cli/e2e/performance.test.ts
```

### Specific Scale Tests
```bash
# Test specific group size
CONVEX_URL=https://your-deployment.convex.cloud \
  bun test ./tests/cli/e2e/performance.test.ts -t "50 members"
```

## CI/CD Integration

### GitHub Actions Example
```yaml
- name: Quick Performance Check
  run: |
    CONVEX_URL=${{ secrets.CONVEX_TEST_URL }} \
      bun test ./tests/cli/e2e/performance-quick.test.ts --timeout 130000
```

### Performance Regression Detection
Compare metrics across runs:
```bash
# Run and save results
bun test ./tests/cli/e2e/performance-quick.test.ts > perf-results.txt

# Compare with baseline
# (metrics are printed in structured format for easy parsing)
```

## Interpreting Results

### ✅ Good Performance
- Average latencies well below targets
- P95/P99 show consistent performance
- Linear scaling with group size

### ⚠️ Warning Signs
- Average approaching or exceeding targets
- Large gap between average and P95 (inconsistent)
- Non-linear scaling (exponential growth)

### ❌ Issues to Investigate
- Averages significantly over targets
- P95 > 2x average (high variance)
- Timeouts or failures

## Troubleshooting

**Tests hang**: Increase timeout values, check network connectivity

**Out of memory**: Reduce message counts or group sizes in test code

**Inconsistent results**: Run multiple times, check backend load

**Permission errors**: Verify bootstrap has completed successfully

## Future Enhancements

Potential additions to the performance suite:

- [ ] Concurrent sending (multiple senders)
- [ ] Message delivery confirmation latency
- [ ] Key rotation performance impact
- [ ] Database size impact on query performance
- [ ] Network bandwidth measurements
- [ ] Memory usage profiling

## Notes

- Performance depends on network latency, backend load, and database state
- Tests create isolated users to avoid cross-contamination
- Larger group tests (100, 300 members) require significant time
- Results may vary between test runs - look for trends over multiple runs
