import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

let mongoServer: MongoMemoryServer;

// Set test environment variables
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_key_for_unit_tests_only";
process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.STREAMING_BASE_URL = "http://localhost:5000/stream";

import { redisConnection } from "../src/config/redis";

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
  try {
    await redisConnection.quit();
  } catch {
    redisConnection.disconnect();
  }
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});
