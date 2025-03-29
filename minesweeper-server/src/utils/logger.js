// minesweeper-server/src/utils/logger.js
const LOG_LEVEL = process.env.LOG_LEVEL || 'info'; // Set default level

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = levels[LOG_LEVEL.toLowerCase()] ?? levels.info;

function log(level, message, ...args) {
  if (levels[level] <= currentLevel) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}]`, message, ...args);
  }
}

const logger = {
  error: (message, ...args) => log('error', message, ...args),
  warn: (message, ...args) => log('warn', message, ...args),
  info: (message, ...args) => log('info', message, ...args),
  debug: (message, ...args) => log('debug', message, ...args),
};

module.exports = logger;