FROM node:20-bookworm-slim

# ffmpeg from Debian repos (avoid npm-distributed ffmpeg binaries in production)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
