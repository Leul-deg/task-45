process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test_secret";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost";
process.env.ENABLE_CRON = "false";
process.env.DATA_ENCRYPTION_KEY =
  process.env.DATA_ENCRYPTION_KEY ||
  "0000000000000000000000000000000000000000000000000000000000000000";
