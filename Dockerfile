# Use an official Node.js runtime as a parent image
FROM node:20-slim AS base

# Set the working directory
WORKDIR /app

# Copy root package files and install dependencies using workspaces
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
# Use --ignore-scripts for potentially faster/safer installs in CI/CD
RUN npm ci --ignore-scripts

# Copy the rest of the application code
COPY . .

# ARG/ENV for VITE_BACKEND_URL removed, using import.meta.env.DEV in App.tsx instead

# Build the client application
RUN npm run build --workspace=client

# Build the server application
RUN npm run build --workspace=server

# Expose the port the app runs on (default inspector server port)
EXPOSE 3000

# Define the command to run the application
# Assuming the server serves the built client assets
CMD ["node", "server/build/index.js"]