FROM docker:28.3.3-cli AS docker-cli

FROM node:22-bookworm-slim

# The task needs the Docker client for the VM's daemon, not another full
# containerd/runc installation. This avoids downloading hundreds of megabytes
# of daemon packages independently in every fresh Modal VM.
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins

RUN apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      bash ca-certificates curl jq postgresql-client ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Harbor's Codex agent skips its networked runtime installer when the CLI is
# already present. Install both CLIs while the image is built so trial setup
# does not depend on the restricted apt mirror inside the running container.
RUN npm install --global --no-audit --no-fund \
    @openai/codex@0.146.0 \
    @supabase/mcp-server-supabase@0.8.1

# Harbor v0.20 emits Codex MCP config with a single command field. The wrapper
# keeps the server's fixed adapter arguments out of the agent workspace and
# makes that config valid for current Codex releases.
COPY supabase-mcp-wrapper.sh /usr/local/bin/supabase-mcp-harbor
RUN chmod +x /usr/local/bin/supabase-mcp-harbor

# Local-stack evals use the same pinned CLI contract as the source harness.
# Bake it into the image so a trial never needs a networked installer; the
# Docker socket is mounted only for local-stack task environments.
ARG SUPABASE_CLI_VERSION=2.109.1
ARG TARGETARCH
RUN curl -fsSL "https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI_VERSION}/supabase_linux_${TARGETARCH}.tar.gz" \
    | tar -xz -C /usr/local/bin supabase supabase-go \
    && mv /usr/local/bin/supabase /usr/local/bin/supabase-real \
    && chmod +x /usr/local/bin/supabase-real /usr/local/bin/supabase-go

COPY supabase-cli-wrapper.sh /usr/local/bin/supabase
COPY supabase-workspace-sync.sh /usr/local/bin/supabase-harbor-sync
RUN chmod +x /usr/local/bin/supabase /usr/local/bin/supabase-harbor-sync

WORKDIR /app
COPY seed/local/ /app/

# Frontend/local-project evals carry their own package.json. Install that
# declared toolchain in the task image so the unchanged source scorer's
# runViteBuild/runVitest callbacks execute against the same project files.
# The checked-in frontend fixture's old testing-library range is not published
# by the current npm registry, so the image keeps its app dependencies and
# pins the equivalent test packages to the versions used by the source lock.
RUN if [ -f /app/package.json ]; then \
      node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('/app/package.json')); p.devDependencies={vitest:'4.1.8', 'happy-dom':'20.10.2', '@testing-library/dom':'10.4.1', '@testing-library/react':'16.3.2', '@testing-library/jest-dom':'6.9.1', '@supabase/lite':'0.7.1-next.3'}; fs.writeFileSync('/app/package.json', JSON.stringify(p));" \
      && npm install --legacy-peer-deps --no-audit --no-fund; \
    fi

# The local-stack workspace is bind-mounted from the nested Docker host so
# Supabase sibling containers see agent edits live. Snapshot only after the
# declared frontend dependencies are installed, otherwise that mount would
# hide the image's node_modules during source verification.
RUN mkdir -p /opt/task-seed && cp -a /app/. /opt/task-seed/

# The source scorer is installed in the verifier image only. Harbor copies
# tests/ after the agent run, so neither the original EVAL.ts nor its judge
# rubric is visible or writable during the agent phase.
COPY source-runtime/package.json /opt/source-runtime/package.json
RUN cd /opt/source-runtime \
    && npm install --omit=dev --no-audit --no-fund \
    && mkdir -p /opt/source-runtime/node_modules/@supabase-evals/core
COPY source-runtime/core-shim.mjs /opt/source-runtime/core-shim.mjs
COPY source-runtime/core-package.json /opt/source-runtime/node_modules/@supabase-evals/core/package.json
COPY source-runtime/run-source-scorer.mjs /opt/source-runtime/run-source-scorer.mjs
RUN cp /opt/source-runtime/core-shim.mjs /opt/source-runtime/node_modules/@supabase-evals/core/index.js
