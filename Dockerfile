# 1. Use Node.js as the base
FROM node:24-slim

# 2. Create a folder for your app on the server
WORKDIR /app

# 3. Copy ALL your files (Frontend and Backend) to the server
COPY . .

# 4. Go into the backend folder and install the exact locked libraries (no test tools)
WORKDIR /app/backend
RUN npm ci --omit=dev

# 5. Reset working directory to root
WORKDIR /app

# 6. Expose the port DigitalOcean expects
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# 7. Run as an unprivileged user (the server never writes to disk)
USER node

# 8. Start the server
CMD ["node", "backend/server.js"]
