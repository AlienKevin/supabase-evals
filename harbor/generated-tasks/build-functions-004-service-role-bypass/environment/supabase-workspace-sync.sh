#!/usr/bin/env bash
set -euo pipefail

# Supabase's sibling containers resolve `/app` on the nested Docker daemon's
# host, while the agent edits `/app` in the Harbor task container. Mirror the
# current Supabase workspace into the host-visible path without replacing the
# directory inode that Edge Runtime has already bind-mounted.
[ -d /app/supabase ] || exit 0
[ -S /var/run/docker.sock ] || exit 0

# Local-stack tasks mount the nested daemon's `/app` directly into the Harbor
# task container. In that faithful live-workspace mode, edits are already
# visible to sibling Supabase containers and copying would be redundant.
[ -f /app/.harbor-host-workspace ] && exit 0

tar -C /app -cf - supabase | docker run --rm -i \
  -v /app:/host-app alpine:3.20 sh -c \
  'mkdir -p /host-app/supabase && tar -C /host-app -xf -'
