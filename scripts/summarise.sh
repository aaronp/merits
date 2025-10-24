#!/bin/bash

# Generate a summary of all convex TypeScript files

OUTPUT_FILE="merits-summary.txt"

# Clear the output file
> "$OUTPUT_FILE"

# Find all .ts files in the convex directory and process them
find convex -name "*.ts" -type f | sort | while read -r file; do
    # Get just the filename
    filename=$(basename "$file")

    # Add header
    echo "# $filename:" >> "$OUTPUT_FILE"

    # Add file contents
    cat "$file" >> "$OUTPUT_FILE"

    # Add blank line for separation
    echo "" >> "$OUTPUT_FILE"
done

echo "Summary generated: $OUTPUT_FILE"
