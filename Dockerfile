FROM node:20-bullseye

# System deps (chrome runtime + fonts) + tools (wget/unzip/git)
RUN apt-get update && apt-get install -y \
    fonts-noto fonts-noto-cjk fonts-noto-color-emoji \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
    libdrm2 libgbm1 libasound2 libnss3 libnspr4 \
    libatk-bridge2.0-0 libgtk-3-0 libpango-1.0-0 libpangocairo-1.0-0 \
    libcups2 libdbus-1-3 libxshmfence1 ca-certificates wget gnupg xz-utils unzip git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install node deps first for caching
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Install Chrome in a known location
RUN mkdir -p /app/chrome && \
    cd /app/chrome && \
    wget -q https://storage.googleapis.com/chrome-for-testing-public/123.0.6312.122/linux64/chrome-linux64.zip && \
    unzip -o chrome-linux64.zip && \
    rm chrome-linux64.zip && \
    chmod +x chrome-linux64/chrome
RUN /app/chrome/chrome-linux64/chrome --version

# Copy app source
COPY . .

# Ensure CID_HomeBase exists in cloud builds (Render doesn't fetch submodules)
RUN rm -rf CID_HomeBase \
 && git clone --depth 1 https://github.com/G-Love53/CID_HomeBase CID_HomeBase

# Env
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/app/chrome/chrome-linux64/chrome

EXPOSE 10000
CMD ["npm", "start"]

# cache bust
ARG CACHE_BUST=1770330661
RUN echo $CACHE_BUST
