FROM node:20-slim
WORKDIR /app

# Byreal Skills CLI (read-only pool/position queries for the dashboard data)
RUN npm install -g @byreal-io/byreal-cli

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
