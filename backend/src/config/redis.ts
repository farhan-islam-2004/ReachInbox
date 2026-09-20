import { ConnectionOptions } from 'bullmq';
import Redis from 'ioredis';
import { env } from './env';

const getRedisConfig = (): { options: ConnectionOptions; url?: string } => {
  const redisUrl = process.env.REDIS_URL || env.REDIS_URL;
  if (redisUrl) {
    try {
      const parsed = new URL(redisUrl);
      return {
        url: redisUrl,
        options: {
          host: parsed.hostname,
          port: Number(parsed.port) || 6379,
          username: parsed.username || undefined,
          password: parsed.password || undefined,
          maxRetriesPerRequest: null,
          tls: parsed.protocol === 'rediss:' ? {} : undefined,
        },
      };
    } catch {
      // Fallback if URL parsing fails
    }
  }

  return {
    options: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      maxRetriesPerRequest: null,
    },
  };
};

const redisConfig = getRedisConfig();
export const redisConnectionOptions: ConnectionOptions = redisConfig.options;

let sharedRedisClient: Redis | null = null;

export const getRedisClient = (): Redis => {
  if (!sharedRedisClient) {
    if (redisConfig.url) {
      sharedRedisClient = new Redis(redisConfig.url, { maxRetriesPerRequest: null });
    } else {
      sharedRedisClient = new Redis(redisConfig.options as any);
    }
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
