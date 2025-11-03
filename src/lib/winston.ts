import winston from "winston";
import TelegramLogger from "winston-telegram";
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from "../common/config/secrets";

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN in environment variables");
}
if (!TELEGRAM_CHAT_ID) {
  throw new Error("Missing TELEGRAM_CHAT_ID in environment variables");
}

const logger = winston.createLogger({
  level: "debug",
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

let option: TelegramLogger.Options = {
  token: TELEGRAM_BOT_TOKEN!,
  chatId: Number(TELEGRAM_CHAT_ID),
};

logger.add(new TelegramLogger(option));
export default logger;
