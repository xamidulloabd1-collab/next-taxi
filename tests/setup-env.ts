import { testDatabaseUrl } from "./helpers/test-db";
// Environment for unit + integration tests (real PostgreSQL/PostGIS test database).
(process.env as Record<string, string>).NODE_ENV = "test";
// Derived from TEST_DATABASE_URL, or from DATABASE_URL in .env with the database renamed to nexttaxi_test.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.AUTH_SECRET = "test-secret-0123456789abcdef0123456789";
process.env.SMS_PROVIDER = "console";
process.env.OTP_DEV_ECHO = "true";
process.env.ROUTING_PROVIDER = "estimate";
process.env.GEOCODING_PROVIDER = "none";
process.env.STORAGE_PROVIDER = "local";
process.env.STORAGE_LOCAL_DIR = "./storage/test";
process.env.DISPATCH_WORKER = "off";
process.env.DATABASE_POOL_MAX = "15";
