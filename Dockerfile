# Imagen multi-stage del microservicio disponibilidad (Node 22, usuario no root, sin copiar .env).

# ── Etapa 1: dependencias de producción ──────────────────────────────────────────────────────────
FROM node:22-alpine AS dependencias
USER root
WORKDIR /app
COPY package.json package-lock.json ./
COPY node_modules ./node_modules
RUN npm prune --omit=dev --no-audit

# ── Etapa 2: compilación TypeScript ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS compilacion
USER root
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY node_modules ./node_modules
COPY src ./src
RUN chmod +x node_modules/.bin/* && npm run build

# ── Etapa 3: imagen final de ejecución ───────────────────────────────────────────────────────────
FROM node:22-alpine AS produccion
ENV NODE_ENV=production \
    PORT_DISPONIBILIDAD=3003
WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node --from=dependencias /app/node_modules ./node_modules
COPY --chown=node:node --from=compilacion /app/dist ./dist
COPY --chown=node:node contracts/v2/inventory.proto ./contracts/v2/inventory.proto

USER node
EXPOSE 3003

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT_DISPONIBILIDAD||process.env.PORT||3003)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
