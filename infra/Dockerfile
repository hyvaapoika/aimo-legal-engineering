FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json turbo.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY data ./data
RUN pnpm install --frozen-lockfile && pnpm --filter @aimo/web build
ENV NODE_ENV=production
EXPOSE 4000 3100
CMD ["pnpm", "start"]
