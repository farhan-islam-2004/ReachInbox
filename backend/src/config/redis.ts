import { ConnectionOptions } from 'bullmq';
import Redis from 'ioredis';
import { env } from './env';

export const redisConnectionOptions: ConnectionOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null,
};

let sharedRedisClient: Redis | null = null;

export const getRedisClient = (): Redis => {
  if (!sharedRedisClient) {
    sharedRedisClient = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      maxRetriesPerRequest: null,
    });
    sharedRedisClient.on('error', (err) => {
      console.error('Redis connection error:', err.message);
    });
  }
  return sharedRedisClient;
};

export const closeRedisConnection = async (): Promise<void> => {
  if (sharedRedisClient) {
    await sharedRedisClient.quit();
    sharedRedisClient = null;
  }
};
