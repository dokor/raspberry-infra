FROM node:22-bookworm-slim

ARG CODEX_VERSION=latest

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g "@openai/codex@${CODEX_VERSION}"

RUN mkdir -p /app /workspace /home/node/.codex \
  && chown -R node:node /app /workspace /home/node/.codex

COPY --chown=node:node server.mjs /app/server.mjs

USER node
ENV CODEX_HOME=/home/node/.codex
WORKDIR /workspace

RUN git init -q \
  && git config user.email "codex-bridge@localhost" \
  && git config user.name "codex-bridge"

EXPOSE 3010

CMD ["node", "/app/server.mjs"]
