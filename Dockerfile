# Stage 1: Build
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
# Prune dev dependencies to save space and potentially memory
RUN npm prune --production

# Stage 2: Runtime
FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js

# Set environment variables
ENV NODE_ENV=production
# Cloud Run will override this, but it's a good default
ENV PORT=8080

# Expose the port (informational)
EXPOSE 8080

# Start the application directly with node
CMD ["node", "server.js"]
