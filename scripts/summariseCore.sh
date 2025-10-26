#!/usr/bin/env bash
# Generate a summary of core TypeScript files for easy review
# Includes core interfaces, core implementation, runtime, and client transport

set -euo pipefail

# Output file
OUTPUT_FILE="core-summary.txt"

# Source directories
CORE_INTERFACES_DIR="core/interfaces"
CORE_DIR="core"
CORE_RUNTIME_DIR="core/runtime"
CLIENT_FILE="client/convex-transport.ts"

# Check if directories exist
if [ ! -d "$CORE_DIR" ]; then
    echo "Error: Directory $CORE_DIR not found"
    exit 1
fi

# Clear output file
> "$OUTPUT_FILE"

# Write header
cat >> "$OUTPUT_FILE" << 'EOF'
============================================================================================
TypeScript source files from core/ and client/ for Merits messaging system
============================================================================================


EOF

# Section 1: Core Interfaces
echo "" >> "$OUTPUT_FILE"
echo "================================================================================" >> "$OUTPUT_FILE"
echo "SECTION 1: CORE INTERFACES" >> "$OUTPUT_FILE"
echo "================================================================================" >> "$OUTPUT_FILE"

interface_count=0
if [ -d "$CORE_INTERFACES_DIR" ]; then
    for file in $(find "$CORE_INTERFACES_DIR" -name "*.ts" -type f | sort); do
        filename=$(basename "$file")

        echo "" >> "$OUTPUT_FILE"
        echo "================================================================================" >> "$OUTPUT_FILE"
        echo "# core/interfaces/$filename" >> "$OUTPUT_FILE"
        echo "================================================================================" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"

        cat "$file" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"

        interface_count=$((interface_count + 1))
    done
fi

# Section 2: Core Implementation Files
echo "" >> "$OUTPUT_FILE"
echo "================================================================================" >> "$OUTPUT_FILE"
echo "SECTION 2: CORE IMPLEMENTATION" >> "$OUTPUT_FILE"
echo "================================================================================" >> "$OUTPUT_FILE"

core_count=0
if [ -d "$CORE_DIR" ]; then
    # Process files in core/ directory (not in subdirectories)
    for file in $(find "$CORE_DIR" -maxdepth 1 -name "*.ts" -type f | sort); do
        filename=$(basename "$file")

        echo "" >> "$OUTPUT_FILE"
        echo "================================================================================" >> "$OUTPUT_FILE"
        echo "# core/$filename" >> "$OUTPUT_FILE"
        echo "================================================================================" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"

        cat "$file" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"

        core_count=$((core_count + 1))
    done
fi

# Section 3: Core Runtime
echo "" >> "$OUTPUT_FILE"
echo "================================================================================" >> "$OUTPUT_FILE"
echo "SECTION 3: CORE RUNTIME" >> "$OUTPUT_FILE"
echo "================================================================================" >> "$OUTPUT_FILE"

runtime_count=0
if [ -d "$CORE_RUNTIME_DIR" ]; then
    for file in $(find "$CORE_RUNTIME_DIR" -name "*.ts" -type f | sort); do
        filename=$(basename "$file")

        echo "" >> "$OUTPUT_FILE"
        echo "================================================================================" >> "$OUTPUT_FILE"
        echo "# core/runtime/$filename" >> "$OUTPUT_FILE"
        echo "================================================================================" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"

        cat "$file" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"

        runtime_count=$((runtime_count + 1))
    done
fi

# Section 4: Client Transport
echo "" >> "$OUTPUT_FILE"
echo "================================================================================" >> "$OUTPUT_FILE"
echo "SECTION 4: CLIENT TRANSPORT" >> "$OUTPUT_FILE"
echo "================================================================================" >> "$OUTPUT_FILE"

client_count=0
if [ -f "$CLIENT_FILE" ]; then
    echo "" >> "$OUTPUT_FILE"
    echo "================================================================================" >> "$OUTPUT_FILE"
    echo "# $CLIENT_FILE" >> "$OUTPUT_FILE"
    echo "================================================================================" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"

    cat "$CLIENT_FILE" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"

    client_count=$((client_count + 1))
fi

# Count total files and lines
total_count=$((interface_count + core_count + runtime_count + client_count))
line_count=$(wc -l < "$OUTPUT_FILE")

echo "" >> "$OUTPUT_FILE"

echo "✓ Generated $OUTPUT_FILE" >&2
echo "  Core interfaces: $interface_count" >&2
echo "  Core implementation: $core_count" >&2
echo "  Core runtime: $runtime_count" >&2
echo "  Client transport: $client_count" >&2
echo "  Total files: $total_count" >&2
echo "  Total lines: $line_count" >&2

# Output to stdout for pbcopy
cat "$OUTPUT_FILE"
