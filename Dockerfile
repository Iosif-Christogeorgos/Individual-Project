# 1. Use Node.js as the base
FROM node:20

# 2. Create a folder for your app on the server
WORKDIR /app

# 3. Copy ALL your files (Frontend and Backend) to the server
COPY . .

# 4. Go into the backend folder and install the libraries
WORKDIR /app/backend
RUN npm install

# 5. Reset working directory to root
WORKDIR /app

# 6. Expose the port DigitalOcean expects
ENV PORT=8080
EXPOSE 8080

# 7. Start the server
CMD ["node", "backend/server.js"]