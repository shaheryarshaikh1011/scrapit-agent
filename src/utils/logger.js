const chalk = require('chalk');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4
};

class Logger {
  constructor(level = 'INFO') {
    this.level = LOG_LEVELS[level] || LOG_LEVELS.INFO;
  }

  setLevel(level) {
    this.level = LOG_LEVELS[level] || LOG_LEVELS.INFO;
  }

  debug(...args) {
    if (this.level <= LOG_LEVELS.DEBUG) {
      console.log(chalk.gray('[DEBUG]'), ...args);
    }
  }

  info(...args) {
    if (this.level <= LOG_LEVELS.INFO) {
      console.log(chalk.blue('[INFO]'), ...args);
    }
  }

  success(...args) {
    if (this.level <= LOG_LEVELS.INFO) {
      console.log(chalk.green('[SUCCESS]'), ...args);
    }
  }

  warn(...args) {
    if (this.level <= LOG_LEVELS.WARN) {
      console.log(chalk.yellow('[WARN]'), ...args);
    }
  }

  error(...args) {
    if (this.level <= LOG_LEVELS.ERROR) {
      console.log(chalk.red('[ERROR]'), ...args);
    }
  }

  step(num, total, message) {
    if (this.level <= LOG_LEVELS.INFO) {
      console.log(chalk.cyan(`[${num}/${total}]`), message);
    }
  }

  banner(text) {
    console.log('\n' + chalk.bold.magenta('═'.repeat(50)));
    console.log(chalk.bold.magenta(`  ${text}`));
    console.log(chalk.bold.magenta('═'.repeat(50)) + '\n');
  }
}

module.exports = new Logger();
module.exports.Logger = Logger;
