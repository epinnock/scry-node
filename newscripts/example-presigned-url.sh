#!/bin/bash

# Example usage of generate-presigned-url.js
# This script demonstrates how to generate a presigned URL for the Large.png file

echo "🔗 Generating Presigned URL for Large.png"
echo "=========================================="

# Set your R2 credentials (replace with your actual values)
export CLOUDFLARE_ACCESS_KEY_ID="your_access_key_id_here"
export CLOUDFLARE_SECRET_ACCESS_KEY="your_secret_access_key_here"

# Optional: Set expiration time (default: 3600 seconds = 1 hour)
export EXPIRES_IN=7200  # 2 hours

# Optional: Skip accessibility test
# export TEST_ACCESS=false

echo "Using credentials:"
echo "  Access Key ID: ${CLOUDFLARE_ACCESS_KEY_ID}"
echo "  Secret Key: [REDACTED]"
echo "  Expires in: ${EXPIRES_IN} seconds"
echo ""

# Run the presigned URL generator
node scripts/generate-presigned-url.js

echo ""
echo "Note: Replace the credentials above with your actual R2 credentials"
echo "You can also create a .env file with these variables instead"