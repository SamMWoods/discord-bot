FROM node:20-alpine

WORKDIR /app

# Install deps first (better caching)
COPY package*.json ./
RUN npm ci

# Copy the rest
COPY . .

# Build Typescript -> dist
RUN npm run build

# Start the bot
CMD ["npm", "run", "start"]
