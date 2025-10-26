#!/usr/bin/env bash
# Generate a summary of all CLI TypeScript files for easy review
# Concatenates all .ts files from cli/ including lib files and tests

set -euo pipefail

# Output file
OUTPUT_FILE="cli-summary.txt"

# Source directories
CLI_DIR="cli"
LIB_DIR="$CLI_DIR/lib"
TESTS_DIR="tests/cli/unit"

# Check if directory exists
if [ ! -d "$CLI_DIR" ]; then
    echo "Error: Directory $CLI_DIR not found"
    exit 1
fi

# Clear output file
> "$OUTPUT_FILE"

# Write header
cat >> "$OUTPUT_FILE" << 'EOF'
============================================================================================
TypeScript source files from cli/ including implementation files and test files.
============================================================================================


EOF

# Section 1: Main CLI files
echo "" >> "$OUTPUT_FILE"
echo "================================================================================" >> "$OUTPUT_FILE"
echo "SECTION 1: MAIN CLI FILES" >> "$OUTPUT_FILE"
echo "================================================================================" >> "$OUTPUT_FILE"

# Add index.ts
if [ -f "$CLI_DIR/index.ts" ]; then
    echo "" >> "$OUTPUT_FILE"
    echo "================================================================================" >> "$OUTPUT_FILE"
    echo "# index.ts" >> "$OUTPUT_FILE"
    echo "================================================================================" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
    cat "$CLI_DIR/index.ts" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
fi

# Section 2: Library files
echo "" >> "$OUTPUT_FILE"
echo "================================================================================" >> "$OUTPUT_FILE"
echo "SECTION 2: LIBRARY FILES" >> "$OUTPUT_FILE"
echo "================================================================================" >> "$OUTPUT_FILE"

lib_count=0
if [ -d "$LIB_DIR" ]; then
    # Process files in lib/ directory (not vault)
    for file in $(find "$LIB_DIR" -maxdepth 1 -name "*.ts" -type f | sort); do
        filename=$(basename "$file")

        echo "" >> "$OUTPUT_FILE"
        echo "================================================================================" >> "$OUTPUT_FILE"
        echo "# lib/$filename" >> "$OUTPUT_FILE"
        echo "================================================================================" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"

        cat "$file" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"

        lib_count=$((lib_count + 1))
    done

    # Process vault files
    if [ -d "$LIB_DIR/vault" ]; then
        echo "" >> "$OUTPUT_FILE"
        echo "================================================================================" >> "$OUTPUT_FILE"
        echo "VAULT IMPLEMENTATION" >> "$OUTPUT_FILE"
        echo "================================================================================" >> "$OUTPUT_FILE"

        for file in $(find "$LIB_DIR/vault" -name "*.ts" -type f | sort); do
            filename=$(basename "$file")

            echo "" >> "$OUTPUT_FILE"
            echo "================================================================================" >> "$OUTPUT_FILE"
            echo "# lib/vault/$filename" >> "$OUTPUT_FILE"
            echo "================================================================================" >> "$OUTPUT_FILE"
            echo "" >> "$OUTPUT_FILE"

            cat "$file" >> "$OUTPUT_FILE"
            echo "" >> "$OUTPUT_FILE"

            lib_count=$((lib_count + 1))
        done
    fi
fi

# Section 3: Test files
echo "" >> "$OUTPUT_FILE"
echo "================================================================================" >> "$OUTPUT_FILE"
echo "SECTION 3: TEST FILES" >> "$OUTPUT_FILE"
echo "================================================================================" >> "$OUTPUT_FILE"

test_count=0
if [ -d "$TESTS_DIR" ]; then
    for file in $(find "$TESTS_DIR" -name "*.ts" -type f | sort); do
        filename=$(basename "$file")

        echo "" >> "$OUTPUT_FILE"
        echo "================================================================================" >> "$OUTPUT_FILE"
        echo "# tests/cli/unit/$filename" >> "$OUTPUT_FILE"
        echo "================================================================================" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"

        cat "$file" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"

        test_count=$((test_count + 1))
    done
fi

# Section 4: Documentation
echo "" >> "$OUTPUT_FILE"
echo "================================================================================" >> "$OUTPUT_FILE"
echo "SECTION 4: DOCUMENTATION" >> "$OUTPUT_FILE"
echo "================================================================================" >> "$OUTPUT_FILE"

doc_count=0
for doc_file in cli/README.md docs/cli-phase-1.md docs/cli-milestone-0-complete.md; do
    if [ -f "$doc_file" ]; then
        filename=$(basename "$doc_file")

        echo "" >> "$OUTPUT_FILE"
        echo "================================================================================" >> "$OUTPUT_FILE"
        echo "# $doc_file" >> "$OUTPUT_FILE"
        echo "================================================================================" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"

        cat "$doc_file" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"

        doc_count=$((doc_count + 1))
    fi
done

# Count total files and lines
total_count=$((lib_count + test_count + doc_count + 1))  # +1 for index.ts
line_count=$(wc -l < "$OUTPUT_FILE")

echo "" >> "$OUTPUT_FILE"

echo "✓ Generated $OUTPUT_FILE" >&2
echo "  Main files: 1 (index.ts)" >&2
echo "  Library files: $lib_count" >&2
echo "  Test files: $test_count" >&2
echo "  Documentation: $doc_count" >&2
echo "  Total files: $total_count" >&2
echo "  Total lines: $line_count" >&2

# Output to stdout for pbcopy
cat "$OUTPUT_FILE"
