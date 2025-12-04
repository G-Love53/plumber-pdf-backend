FROM node:20-bullseye

# Install Chrome dependencies AND unzip
RUN apt-get update && apt-get install -y \
    fonts-noto fonts-noto-cjk fonts-noto-color-emoji \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
    libdrm2 libgbm1 libasound2 libnss3 libnspr4 \
    libatk-bridge2.0-0 libgtk-3-0 libpango-1.0-0 libpangocairo-1.0-0 \
    libcups2 libdbus-1-3 libxshmfence1 ca-certificates wget gnupg xz-utils unzip \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install dependencies INCLUDING puppeteer
RUN npm ci --omit=dev || npm install --omit=dev

# Install Chrome directly in a known location
RUN mkdir -p /app/chrome && \
    cd /app/chrome && \
    wget -q https://storage.googleapis.com/chrome-for-testing-public/123.0.6312.122/linux64/chrome-linux64.zip && \
    unzip chrome-linux64.zip && \
    rm chrome-linux64.zip && \
    chmod +x chrome-linux64/chrome

# Copy application files
COPY src ./src
COPY templates ./templates
COPY mapping ./mapping

# Set environment variables
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/app/chrome/chrome-linux64/chrome

EXPOSE 10000

CMD ["npm", "start"]
