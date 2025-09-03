import { Options } from "./../../node_modules/winston-telegram/lib/winston-telegram.d";
import winston from "winston";
import TelegramLogger from "winston-telegram";
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from "../common/config/secrets";

const logger = winston.createLogger({
  level: "debug",
  format: winston.format.json(),
  transports: [new winston.transports.Console()], // console in cả debug],
});

let option: TelegramLogger.Options = {
  token: TELEGRAM_BOT_TOKEN!,
  chatId: Number(TELEGRAM_CHAT_ID),
};

logger.add(new TelegramLogger(option));
export default logger;
