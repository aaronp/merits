# Performance Benchmarks

Comprehensive performance tests for the Merits messaging system.

## Overview

The performance test suite benchmarks:
- **Direct messaging** (1-to-1) - Send and receive latency
- **Group messaging** (1-to-many) - Scaling from 10 to 300 members
- **Query performance** - Unread message retrieval

## Running Performance Tests

### All Performance Tests

```bash
CONVEX_URL=https://your-deployment.convex.cloud \
  bun test ./tests/cli/e2e/performance.test.ts --timeout 600000
```

### Individual Test Suites

**Direct Message Performance:**
```bash
CONVEX_URL=https://your-deployment.convex.cloud \
  bun test ./tests/cli/e2e/performance.test.ts \
  -t "direct message" --timeout 300000
```

**Small Group (10 members):**
```bash
CONVEX_URL=https://your-deployment.convex.cloud \
  bun test ./tests/cli/e2e/performance.test.ts \
  -t "10 members" --timeout 300000
```

**Medium Group (50 members):**
```bash
CONVEX_URL=https://your-deployment.convex.cloud \
  bun test ./tests/cli/e2e/performance.test.ts \
  -t "50 members" --timeout 300000
```

**Large Group (100 members):**
```bash
CONVEX_URL=https://your-deployment.convex.cloud \
  bun test ./tests/cli/e2e/performance.test.ts \
  -t "100 members" --timeout 600000
```

**Very Large Group (300 members):**
```bash
CONVEX_URL=https://your-deployment.convex.cloud \
  bun test ./tests/cli/e2e/performance.test.ts \
  -t "300 members" --timeout 600000
```

## Performance Metrics

Each test reports:
- **Count**: Number of operations performed
- **Total**: Total time for all operations
- **Average**: Mean latency per operation
- **Min/Max**: Best and worst case latency
- **P50/P95/P99**: Percentile latencies

### Example Output

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
```

## Performance Targets

### Direct Messages
- **Send Average**: < 5 seconds
- **Send P95**: < 10 seconds
- **Receive Average**: < 3 seconds
- **Receive P95**: < 5 seconds

### Group Messages
Send performance scales linearly with group size:
- **Base**: 1 second
- **Per Member**: +50ms overhead
- **Example (100 members)**: < 6 seconds average

Receive performance is constant regardless of group size:
- **Average**: < 5 seconds

## Test Details

### Direct Message Send (100 messages)
Creates two users, promotes them to "user" role, and sends 100 direct messages from Alice to Bob. Measures encryption, signing, and transmission time.

### Direct Message Receive (100 queries)
Prepares 50 messages in Bob's inbox, then queries unread messages 100 times. Measures query and decryption performance.

### Group Message Tests
For each group size (10, 50, 100, 300 members):

1. **Setup Phase**:
   - Create sender account
   - Create N member accounts
   - Create group and add all members

2. **Send Phase**:
   - Send 10 group messages
   - Measure per-member encryption overhead

3. **Receive Phase**:
   - Sample 10 members (or all if fewer)
   - Query unread messages for each
   - Measure consistent receive performance

## Notes

- Tests use separate test users to avoid cross-contamination
- Each test cleans up its workspace after completion
- Group tests become progressively slower with size (expected)
- Large group tests (100, 300 members) require 10-minute timeouts
- Performance depends on network latency and backend load

## Interpreting Results

### Good Performance
- Direct send average < 2 seconds
- Group send scales predictably (linear with size)
- Receive performance stays consistent < 3 seconds

### Investigation Needed
- Direct send average > 5 seconds (check network/backend)
- Group send doesn't scale linearly (encryption overhead issue)
- Receive performance degrades with data volume (indexing issue)

## Troubleshooting

**Test Hangs**: Increase timeout values in performance.test.ts

**Out of Memory**: Reduce messageCount or group sizes

**Network Errors**: Check CONVEX_URL and network connectivity

**Permission Errors**: Ensure bootstrap has run successfully
