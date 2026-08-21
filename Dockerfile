# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency files
COPY package*.json tsconfig.json vite.config.ts ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build production bundle
RUN npm run build

# Stage 2: Production runtime stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy compiled assets and server build from builder stage
COPY --from=builder /app/dist ./dist

# Create uploads directory for crop diagnostic images
RUN mkdir -p /app/uploads

EXPOSE 3000

# Run production server
CMD ["node", "dist/server.cjs"]
