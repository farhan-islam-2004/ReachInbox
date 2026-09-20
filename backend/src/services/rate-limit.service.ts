import { getRedisClient } from '../config/redis';
import { env } from '../config/env';

export interface RateLimitReservationInput {
  senderId: string;
  campaignId?: string;
  campaignHourlyLimit?: number | null;
  senderHourlyLimit?: number | null;
}

export type RateLimitBlockReason = 'HOURLY_LIMIT' | 'MIN_DELAY';

export interface RateLimitResult {
  allowed: boolean;
  reason?: RateLimitBlockReason;
  limit?: number;
  currentCount?: number;
  nextAvailableAt?: number;
  scope?: string;
}

export interface RateLimitHitEvent {
  type: 'RATE_LIMIT_HIT';
  emailId: string;
  senderId: string;
  senderEmail?: string;
  recipient?: string;
  scope: string;
  limit: number;
  currentCount: number;
  nextAvailableAt: string;
  timestamp: string;
}

const RATE_LIMIT_LUA_SCRIPT = `
local senderHourlyKey = KEYS[1]
local globalHourlyKey = KEYS[2]
local senderLastSendKey = KEYS[3]
local campaignHourlyKey = KEYS[4]

local effectiveLimit = tonumber(ARGV[1])
local campaignLimit = tonumber(ARGV[2])
local minDelayMs = tonumber(ARGV[3])
local currentTimestamp = tonumber(ARGV[4])
local keyTtl = tonumber(ARGV[5])

-- 1. Check Minimum Send Delay
local lastSend = tonumber(redis.call('GET', senderLastSendKey) or '0')
local elapsed = currentTimestamp - lastSend
if minDelayMs > 0 and elapsed < minDelayMs then
    local nextEligible = lastSend + minDelayMs
    return { 0, 'MIN_DELAY', tostring(nextEligible), 0, effectiveLimit }
end

-- 2. Check Sender Hourly Counter
local currentSenderCount = tonumber(redis.call('GET', senderHourlyKey) or '0')
if currentSenderCount >= effectiveLimit then
    return { 0, 'HOURLY_LIMIT', '0', currentSenderCount, effectiveLimit }
end

-- 3. Check Campaign Hourly Counter (if specified)
if campaignLimit > 0 and campaignHourlyKey ~= '' then
    local currentCampaignCount = tonumber(redis.call('GET', campaignHourlyKey) or '0')
    if currentCampaignCount >= campaignLimit then
        return { 0, 'HOURLY_LIMIT', '0', currentCampaignCount, campaignLimit }
    end
end

-- 4. Atomic Reservation
local newSenderCount = redis.call('INCR', senderHourlyKey)
redis.call('EXPIRE', senderHourlyKey, keyTtl)

if campaignLimit > 0 and campaignHourlyKey ~= '' then
    redis.call('INCR', campaignHourlyKey)
    redis.call('EXPIRE', campaignHourlyKey, keyTtl)
end

redis.call('INCR', globalHourlyKey)
redis.call('EXPIRE', globalHourlyKey, keyTtl)

redis.call('SET', senderLastSendKey, currentTimestamp, 'EX', keyTtl)

return { 1, 'OK', '0', newSenderCount, effectiveLimit }
`;

export class RateLimitService {
  /**
   * Calculates the UTC hour string (e.g. 2026-09-20T01) and the timestamp when the next UTC hour starts.
   */
  public getUtcHourWindow(date: Date = new Date()): { utcHour: string; nextHourTimestampMs: number } {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');

    const utcHour = `${year}-${month}-${day}T${hour}`;
    const nextHourTimestampMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours() + 1, 0, 0, 0);

    return { utcHour, nextHourTimestampMs };
  }

  /**
   * Atomically evaluates and reserves rate-limit and minimum-delay capacity in Redis.
   */
  public async reserveSendSlot(input: RateLimitReservationInput): Promise<RateLimitResult> {
    const redis = getRedisClient();
    const now = new Date();
    const currentMs = now.getTime();
    const { utcHour, nextHourTimestampMs } = this.getUtcHourWindow(now);

    const globalLimit = env.MAX_EMAILS_PER_HOUR;
    const senderLimit = input.senderHourlyLimit || globalLimit;
    const campaignLimit = input.campaignHourlyLimit && input.campaignHourlyLimit > 0 ? input.campaignHourlyLimit : 0;

    const effectiveLimit = Math.min(globalLimit, senderLimit, campaignLimit > 0 ? campaignLimit : Infinity);
    const minDelayMs = env.MIN_EMAIL_DELAY_MS;
    const keyTtl = 7200; // 2 hours

    const senderHourlyKey = `ratelimit:sender:${input.senderId}:${utcHour}`;
    const globalHourlyKey = `ratelimit:global:${utcHour}`;
    const senderLastSendKey = `ratelimit:sender:${input.senderId}:last_send_ms`;
    const campaignHourlyKey = input.campaignId && campaignLimit > 0 ? `ratelimit:campaign:${input.campaignId}:${utcHour}` : '';

    const rawResult = (await redis.eval(
      RATE_LIMIT_LUA_SCRIPT,
      4,
      senderHourlyKey,
      globalHourlyKey,
      senderLastSendKey,
      campaignHourlyKey,
      effectiveLimit,
      campaignLimit,
      minDelayMs,
      currentMs,
      keyTtl
    )) as [number, string, string, number, number];

    const allowed = rawResult[0] === 1;
    const reason = rawResult[1] as RateLimitBlockReason | 'OK';
    const nextAvailableTime = Number(rawResult[2]);
    const currentCount = Number(rawResult[3]);
    const limit = Number(rawResult[4]);

    if (!allowed) {
      if (reason === 'MIN_DELAY') {
        return {
          allowed: false,
          reason: 'MIN_DELAY',
          nextAvailableAt: nextAvailableTime,
          scope: 'sender_min_delay',
        };
      }

      return {
        allowed: false,
        reason: 'HOURLY_LIMIT',
        limit,
        currentCount,
        nextAvailableAt: nextHourTimestampMs,
        scope: input.campaignHourlyLimit && input.campaignHourlyLimit <= effectiveLimit ? 'campaign' : 'sender',
      };
    }

    return {
      allowed: true,
      currentCount,
      limit,
    };
  }

  /**
   * Resets rate-limit keys for testing purposes.
   */
  public async resetRateLimitKeys(senderId: string): Promise<void> {
    const redis = getRedisClient();
    const { utcHour } = this.getUtcHourWindow();
    await redis.del(
      `ratelimit:sender:${senderId}:${utcHour}`,
      `ratelimit:global:${utcHour}`,
      `ratelimit:sender:${senderId}:last_send_ms`
    );
  }
}

export const rateLimitService = new RateLimitService();
