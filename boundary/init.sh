#!/bin/bash
# One-time Boundary database initialization script
# Run this after the Boundary container is started for the first time.
#
# Usage: docker compose exec boundary /boundary/init.sh

set -e

echo "=== Initializing Boundary Database ==="

boundary database init \
  -config /boundary/config.hcl \
  -format json 2>&1 | tee /tmp/boundary-init.json

echo ""
echo "=== Boundary Init Complete ==="
echo ""
echo "Look for these values in the output above:"
echo "  - auth_method_id (starts with 'ampw_')"
echo "  - org scope id (starts with 'o_')"
echo "  - admin login_name and password"
echo ""
echo "Add them to your .env file as:"
echo "  BOUNDARY_AUTH_METHOD_ID=ampw_..."
echo "  BOUNDARY_ORG_ID=o_..."
echo "  BOUNDARY_ADMIN_LOGIN=admin"
echo "  BOUNDARY_ADMIN_PASSWORD=<from output>"
