#!/bin/sh
set -eu

# Harbor v0.20 writes a Codex stdio MCP server as a single command string.
# Keep that upstream integration intact while giving current Codex a single
# executable to launch; the fixed arguments stay outside the agent workspace.
exec /usr/local/bin/mcp-server-supabase \
  --api-url http://platform-lite:7070 \
  --access-token dev-token \
  --features docs,account,database,development,debugging,functions
