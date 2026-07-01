FROM node:20-slim
WORKDIR /app

# Byreal CLIs (read-only pool/position/quote queries + perps signals for the bot)
RUN npm install -g @byreal-io/byreal-cli @byreal-io/byreal-perps-cli

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080
EXPOSE 8080
# Telegram bot (keyless) with a health server on PORT; needs TELEGRAM_BOT_TOKEN env
CMD ["node", "src/bot.js"]
