# Stage 1: Build TS to JS
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run typechain && npm run build

# Stage 2
FROM node:18-alpine
WORKDIR /app
# Copy dist and package
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
#  dependencies for production
RUN npm install --omit=dev

CMD ["node", "dist/main.js"]