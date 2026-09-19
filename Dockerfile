FROM node:22-bookworm-slim

# Install system dependencies for Sharp, font handling, and SSL certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fontconfig \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Cloud Run defaults
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Cloud Run dedicated serverless engine entrypoint
CMD ["node", "--max-old-space-size=2048", "engine-server.js"]
