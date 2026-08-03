FROM node:22-bookworm-slim

WORKDIR /srv/platform-lite
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY seed /seed

ENV HOST=0.0.0.0
ENV PORT=7070
ENV SEED_DIR=/seed
EXPOSE 7070
CMD ["npx", "tsx", "src/cli.ts"]
