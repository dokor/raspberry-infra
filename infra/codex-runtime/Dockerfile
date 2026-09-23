FROM node:22-bookworm-slim

ARG CODEX_VERSION=0.156.1

LABEL org.opencontainers.image.title="codex-runtime"
LABEL org.opencontainers.image.description="Shared Codex CLI runtime for the Dokor homelab"
LABEL org.opencontainers.image.source="https://github.com/dokor/raspberry-infra"
LABEL org.opencontainers.image.version="${CODEX_VERSION}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    bubblewrap \
    ca-certificates \
    curl \
    git \
    openssh-client \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g "@openai/codex@${CODEX_VERSION}" \
  && command -v codex \
  && codex --version
