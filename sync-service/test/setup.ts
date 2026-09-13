// Silences pino's structured logs during test runs — the tests assert behavior, not
// log output, and the real logger already gets exercised by the roomManager/relay
// tests calling into code paths that log.
process.env.LOG_LEVEL = "silent";
