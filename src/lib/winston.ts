import winston from "winston";
import TelegramLogger from "winston-telegram";
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from "../common/config/secrets";

const logger = winston.createLogger({
  level: "debug",
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

let option: TelegramLogger.Options = {
  token: TELEGRAM_BOT_TOKEN!,
  chatId: Number(TELEGRAM_CHAT_ID),
};

const telegramTransport = new TelegramLogger(option);
telegramTransport.setMaxListeners(20);

logger.add(telegramTransport);

export default logger;
