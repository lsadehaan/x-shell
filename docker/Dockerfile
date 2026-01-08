# x-shell.js Docker image
# Includes Node.js, node-pty, and Docker CLI for container exec support

FROM node:20-slim

# Install build tools for node-pty and Docker CLI
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    curl \
    gnupg \
    && curl -fsSL https://get.docker.com | sh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including node-pty)
RUN npm install --legacy-peer-deps && \
    npm install node-pty --save-dev --legacy-peer-deps

# Copy source code
COPY . .

# Build the project
RUN npm run build

# Expose the default port
EXPOSE 3000

# Start the docker-container example server
CMD ["node", "examples/docker-container/server.js"]
