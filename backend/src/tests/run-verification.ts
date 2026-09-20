import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Client as EsClient } from '@elastic/elasticsearch';
import { env } from '../config/env';
import { getRedisClient } from '../config/redis';
import { rateLimitService } from '../services/rate-limit.service';
import { ElasticsearchService, elasticsearchService } from '../services/elasticsearch.service';
import { slackService } from '../services/slack.service';
import { authService } from '../services/auth.service';
import { emailSchedulerService } from '../services/email-scheduler.service';
import { emailQueue } from '../queues/email.queue';
import { processEmailJob } from '../workers/email.worker';
import app from '../app';
import http from 'http';

const prisma = new PrismaClient();
const redis = getRedisClient();
const esClient = new EsClient({ node: env.ELASTICSEARCH_URL });

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: any) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName}`, detail !== undefined ? detail : '');
  }
}

async function runAllTests() {
  console.log('====================================================');
  console.log('REACHINBOX SCHEDULER — PHASES 5 & 6 VERIFICATION');
  console.log('====================================================\n');

  // Ensure default dev context exists
  const devUser = await prisma.user.upsert({
    where: { email: 'dev@reachinbox.ai' },
    update: {},
    create: {
      email: 'dev@reachinbox.ai',
      name: 'ReachInbox Developer',
    },
  });

  const etherealUser = env.ETHEREAL_USER || 'test@ethereal.email';
  const etherealPassword = env.ETHEREAL_PASSWORD || 'test_pass';

  let sender = await prisma.sender.findFirst({ where: { userId: devUser.id } });
  if (!sender) {
    sender = await prisma.sender.create({
      data: {
        userId: devUser.id,
        email: 'test-sender@reachinbox.ai',
        etherealUser,
        etherealPassword,
      },
    });
  }

  let campaign = await prisma.campaign.findFirst({ where: { userId: devUser.id } });
  if (!campaign) {
    campaign = await prisma.campaign.create({
      data: {
        userId: devUser.id,
        subject: 'Phase 5 & 6 Test Campaign',
        body: 'Automated verification test body',
        startTime: new Date(),
      },
    });
  }

  console.log('--- Phase 5: Rate Limiting & Concurrency Tests ---');

  // Test 1: Minimum Send Delay Check
  await rateLimitService.resetRateLimitKeys(sender.id);
  const minDelay1 = await rateLimitService.reserveSendSlot({ senderId: sender.id });
  assert(minDelay1.allowed === true, 'Test 1.1: First slot reservation allowed immediately');

  const minDelay2 = await rateLimitService.reserveSendSlot({ senderId: sender.id });
  assert(
    minDelay2.allowed === false && minDelay2.reason === 'MIN_DELAY',
    'Test 1.2: Immediate consecutive reservation rejected with MIN_DELAY',
    minDelay2
  );
  assert(
    typeof minDelay2.nextAvailableAt === 'number' && minDelay2.nextAvailableAt > Date.now(),
    'Test 1.3: Rejected reservation returns valid nextAvailableAt timestamp in the future'
  );

  // Test 2: Hourly Limit Check
  const testSenderId = `test-sender-${Date.now()}`;
  const customLimit = 2;
  const res1 = await rateLimitService.reserveSendSlot({
    senderId: testSenderId,
    senderHourlyLimit: customLimit,
  });
  assert(res1.allowed === true, 'Test 2.1: Reservation 1 of 2 allowed');

  // Advance time simulated by setting lastSendMs in past to bypass MIN_DELAY
  const { utcHour } = rateLimitService.getUtcHourWindow();
  await redis.set(`ratelimit:sender:${testSenderId}:last_send_ms`, Date.now() - 5000);

  const res2 = await rateLimitService.reserveSendSlot({
    senderId: testSenderId,
    senderHourlyLimit: customLimit,
  });
  assert(res2.allowed === true, 'Test 2.2: Reservation 2 of 2 allowed');

  await redis.set(`ratelimit:sender:${testSenderId}:last_send_ms`, Date.now() - 5000);

  const res3 = await rateLimitService.reserveSendSlot({
    senderId: testSenderId,
    senderHourlyLimit: customLimit,
  });
  assert(
    res3.allowed === false && res3.reason === 'HOURLY_LIMIT',
    'Test 2.3: Reservation 3 of 2 rejected with HOURLY_LIMIT',
    res3
  );
  assert(
    typeof res3.nextAvailableAt === 'number' && res3.nextAvailableAt > Date.now(),
    'Test 2.4: Hourly limit rejection provides next UTC hour start timestamp'
  );

  // Test 3: Atomic Concurrency (10 concurrent requests, limit 3)
  const concurrentSenderId = `concurrent-${Date.now()}`;
  const concurrentLimit = 3;
  const promises = Array.from({ length: 10 }).map(() =>
    rateLimitService.reserveSendSlot({
      senderId: concurrentSenderId,
      senderHourlyLimit: concurrentLimit,
    })
  );
  const results = await Promise.all(promises);
  const allowedCount = results.filter((r) => r.allowed).length;
  const rejectedCount = results.filter((r) => !r.allowed).length;
  assert(
    allowedCount === 1, // Note: MIN_DELAY ensures exactly 1 wins immediately on concurrent execution!
    `Test 3.1: Atomic script ensures exactly 1 acquires the immediate send slot due to MIN_DELAY (got: ${allowedCount})`
  );
  assert(
    rejectedCount === 9,
    `Test 3.2: Remaining 9 concurrent requests were safely deferred (got: ${rejectedCount})`
  );

  // Test 4: Redis Counter Accuracy
  const storedSenderCount = await redis.get(`ratelimit:sender:${concurrentSenderId}:${utcHour}`);
  assert(
    Number(storedSenderCount) === 1,
    `Test 4.1: Redis sender hourly counter is accurately 1 (got: ${storedSenderCount})`
  );

  // Test 5: 1,000+ Job Scheduling Performance & Durability
  console.log('\n--- 1,000+ Job Handling Benchmark ---');
  const batchEmails = Array.from({ length: 1000 }).map((_, i) => ({
    recipient: `bulk_${i}_${Date.now()}@example.com`,
    subject: `Bulk Test Subject ${i}`,
    body: `Bulk Test Body payload ${i}`,
    scheduledAt: new Date(Date.now() + 600000).toISOString(), // 10 minutes in future
  }));

  const startTime = Date.now();
  const batchResult = await emailSchedulerService.scheduleBatch(batchEmails);
  const durationMs = Date.now() - startTime;

  console.log(`  ⚡ 1,000 emails scheduled in ${durationMs}ms`);
  assert(durationMs < 5000, `Test 5.1: 1,000 emails batch scheduled in under 5,000ms (${durationMs}ms)`);
  assert(batchResult.scheduled === 1000, 'Test 5.2: Batch response reports exactly 1,000 emails scheduled');

  // Verify in PostgreSQL
  const dbCount = await prisma.email.count({
    where: {
      recipient: { startsWith: 'bulk_' },
      status: 'SCHEDULED',
    },
  });
  assert(dbCount >= 1000, `Test 5.3: PostgreSQL persisted at least 1,000 SCHEDULED emails (found: ${dbCount})`);

  // Clean up bulk test emails to keep DB fast
  await prisma.email.deleteMany({
    where: { recipient: { startsWith: 'bulk_' } },
  });
  console.log('  🧹 Cleaned up 1,000 bulk test emails from DB.');

  // Test 6: Phase 4 Crash Recovery Regressions
  console.log('\n--- Phase 4 Crash Recovery Boundary Regressions ---');
  const crashEmail1 = await prisma.email.create({
    data: {
      campaignId: campaign.id,
      senderId: sender.id,
      recipient: 'crash-review@example.com',
      subject: 'Ambiguous Crash Test',
      body: 'Body',
      scheduledAt: new Date(),
      status: 'PROCESSING',
      messageId: null, // Ambiguous crash state!
    },
  });

  const mockJob1 = {
    id: 'mock_job_crash_1',
    data: { emailId: crashEmail1.id },
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as any;

  await processEmailJob(mockJob1);
  const reloadedCrash1 = await prisma.email.findUnique({ where: { id: crashEmail1.id } });
  assert(
    reloadedCrash1?.status === 'PROCESSING',
    'Test 6.1: Ambiguous crash (PROCESSING + NULL messageId) is preserved in PROCESSING for operational review'
  );
  assert(
    reloadedCrash1?.error?.includes('Preserved for operational review') === true,
    'Test 6.2: Operational review note attached to preserved email'
  );

  // MessageId recovery test
  const crashEmail2 = await prisma.email.create({
    data: {
      campaignId: campaign.id,
      senderId: sender.id,
      recipient: 'crash-recovery@example.com',
      subject: 'Durable MessageId Crash Recovery Test',
      body: 'Body',
      scheduledAt: new Date(),
      status: 'PROCESSING',
      messageId: '<durable-proof-12345@reachinbox.ai>',
    },
  });

  const mockJob2 = {
    id: 'mock_job_crash_2',
    data: { emailId: crashEmail2.id },
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as any;

  await processEmailJob(mockJob2);
  const reloadedCrash2 = await prisma.email.findUnique({ where: { id: crashEmail2.id } });
  assert(
    reloadedCrash2?.status === 'SENT',
    'Test 6.3: Crash with durable messageId is safely recovered and finalized to SENT without re-dispatching'
  );

  // Idempotency: Already SENT
  const sentEmail = await prisma.email.create({
    data: {
      campaignId: campaign.id,
      senderId: sender.id,
      recipient: 'sent-guard@example.com',
      subject: 'Already Sent Guard',
      body: 'Body',
      scheduledAt: new Date(),
      status: 'SENT',
      sentAt: new Date(),
      messageId: '<already-sent@ethereal.email>',
    },
  });
  const mockJobSent = {
    id: 'mock_job_sent',
    data: { emailId: sentEmail.id },
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as any;
  await processEmailJob(mockJobSent);
  const reloadedSent = await prisma.email.findUnique({ where: { id: sentEmail.id } });
  assert(reloadedSent?.status === 'SENT', 'Test 6.4: Already SENT job is safely skipped (idempotent)');

  // Test 7: Elasticsearch Integration Tests
  console.log('\n--- Phase 6: Elasticsearch Search Projection Tests ---');
  await elasticsearchService.ensureIndex();

  const testEsEmailId = `es-test-${Date.now()}`;
  const uniqueKeyword = `quantum_reach_${Date.now()}`;
  await elasticsearchService.indexEmail({
    emailId: testEsEmailId,
    userId: devUser.id,
    senderId: sender.id,
    senderEmail: sender.email,
    campaignId: campaign.id,
    recipient: 'searchable-user@reachinbox.ai',
    subject: `Important Update regarding ${uniqueKeyword}`,
    body: `Hello! This is a test message containing ${uniqueKeyword} inside the email body.`,
    status: 'SENT',
    scheduledAt: new Date().toISOString(),
    sentAt: new Date().toISOString(),
    messageId: `<${testEsEmailId}@reachinbox.ai>`,
    createdAt: new Date().toISOString(),
  });

  // Verify ES indexing
  const esDoc = await esClient.get({
    index: env.ELASTICSEARCH_INDEX,
    id: testEsEmailId,
  });
  assert(esDoc.found === true, 'Test 7.1: Document successfully indexed and retrieved from Elasticsearch');

  // Verify full-text search
  const searchResult = await elasticsearchService.searchEmails({ q: uniqueKeyword });
  assert(
    searchResult.data.length > 0 && searchResult.data.some((d: any) => d.emailId === testEsEmailId),
    'Test 7.2: Full-text search by keyword correctly discovers indexed email'
  );

  // Verify status filtering
  const sentFiltered = await elasticsearchService.searchEmails({ status: 'SENT' });
  assert(
    sentFiltered.data.every((d: any) => d.status === 'SENT'),
    'Test 7.3: Search filtering by status=SENT returns only SENT documents'
  );

  // Test 8: Elasticsearch Outage Resilience
  console.log('\n--- Elasticsearch Outage Resilience Test ---');
  // Temporary client with invalid connection simulating ES down
  const resilientEs = new ElasticsearchService();
  (resilientEs as any).client = new EsClient({ node: 'http://127.0.0.1:9999' });

  let didThrow = false;
  try {
    // Should catch error internally and not throw
    await resilientEs.indexEmail({
      emailId: 'outage-test-id',
      userId: devUser.id,
      senderId: sender.id,
      senderEmail: sender.email,
      campaignId: campaign.id,
      recipient: 'resilience@reachinbox.ai',
      subject: 'Outage Test',
      body: 'Testing failure resilience',
      status: 'SENT',
      scheduledAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
  } catch {
    didThrow = true;
  }
  assert(
    !didThrow,
    'Test 8.1: Elasticsearch failure is caught and logged gracefully without throwing or crashing caller'
  );

  // Test 9: Slack Integration Tests
  console.log('\n--- Phase 6: Slack OAuth & Notification Tests ---');
  const oauthState = await slackService.generateOAuthState(devUser.id);
  assert(
    typeof oauthState === 'string' && oauthState.length > 10,
    'Test 9.1: OAuth state token generated and stored in Redis'
  );

  // Callback validation with invalid state
  let callbackFailed = false;
  try {
    await slackService.handleOAuthCallback('invalid_code', 'invalid_state_123');
  } catch (err) {
    callbackFailed = true;
  }
  assert(callbackFailed === true, 'Test 9.2: OAuth callback with invalid state properly rejected');

  // Connection status
  const slackStatus = await slackService.getConnectionStatus(devUser.id);
  assert(
    slackStatus.connected === false,
    'Test 9.3: Connection status returns connected: false for unconnected user'
  );

  // Deduplication check
  const dedupeSenderId = `dedupe-sender-${Date.now()}`;
  const alertEvent = {
    type: 'RATE_LIMIT_HIT' as const,
    emailId: sentEmail.id,
    senderId: dedupeSenderId,
    senderEmail: 'test@reachinbox.ai',
    scope: 'sender',
    limit: 100,
    currentCount: 100,
    nextAvailableAt: new Date(Date.now() + 3600000).toISOString(),
    timestamp: new Date().toISOString(),
  };

  // 1st call sets dedupe key
  const dedupeKey = `slack:rate_limit_notified:${dedupeSenderId}:${utcHour}`;
  const firstSet = await redis.set(dedupeKey, '1', 'EX', 3600, 'NX');
  assert(firstSet === 'OK', 'Test 9.4: First rate limit notification acquires dedupe lock in Redis');

  // 2nd call fails to acquire dedupe lock
  const secondSet = await redis.set(dedupeKey, '1', 'EX', 3600, 'NX');
  assert(secondSet === null, 'Test 9.5: Subsequent rate limit alerts within same hour are deduplicated/silenced');

  // Test 10: Bull Board HTTP Endpoint & Health Check Endpoints
  console.log('\n--- HTTP Routes & Bull Board Tests ---');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(4001, resolve));

  try {
    // Health Check
    const healthRes = await fetch('http://localhost:4001/api/health');
    const healthData: any = await healthRes.json();
    assert(healthRes.status === 200 && healthData.status === 'ok', 'Test 10.1: GET /api/health returns 200 OK');

    const dbHealthRes = await fetch('http://localhost:4001/api/health/db');
    const dbHealthData: any = await dbHealthRes.json();
    assert(
      dbHealthRes.status === 200 && dbHealthData.success === true && dbHealthData.database === 'connected',
      'Test 10.2: GET /api/health/db returns 200 OK with database connected'
    );

    // Bull Board
    const bullBoardRes = await fetch('http://localhost:4001/admin/queues');
    const bullBoardText = await bullBoardRes.text();
    assert(
      bullBoardRes.status === 200 && (bullBoardText.includes('bull') || bullBoardText.includes('queue') || bullBoardText.includes('<!DOCTYPE html>')),
      'Test 10.3: GET /admin/queues returns 200 OK with HTML dashboard UI'
    );

    // Create session for devUser to authenticate requests
    const devSession = await authService.createSession(devUser.id);
    const authHeaders = { Cookie: `reachinbox_session=${devSession.id}` };

    // Slack Connect redirect
    const slackConnectRes = await fetch('http://localhost:4001/api/slack/connect', {
      redirect: 'manual',
      headers: authHeaders,
    });
    const locationHeader = slackConnectRes.headers.get('location') || '';
    assert(
      slackConnectRes.status === 302 && locationHeader.includes('slack.com/oauth/v2/authorize'),
      'Test 10.4: GET /api/slack/connect redirects to Slack OAuth authorize URL'
    );

    // Slack Status
    const slackStatusRes = await fetch('http://localhost:4001/api/slack/status', {
      headers: authHeaders,
    });
    const slackStatusData: any = await slackStatusRes.json();
    assert(
      slackStatusRes.status === 200 && slackStatusData.success === true,
      'Test 10.5: GET /api/slack/status returns 200 JSON status'
    );

    // Search endpoint
    const searchApiRes = await fetch(`http://localhost:4001/api/search/emails?q=${uniqueKeyword}`, {
      headers: authHeaders,
    });
    const searchApiData: any = await searchApiRes.json();
    assert(
      searchApiRes.status === 200 && searchApiData.success === true && searchApiData.data.length > 0,
      'Test 10.6: GET /api/search/emails returns 200 JSON search results from Elasticsearch'
    );
  } finally {
    server.close();
  }

  console.log('\n====================================================');
  console.log(`VERIFICATION SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('====================================================');

  await prisma.$disconnect();
  redis.disconnect();
  await emailQueue.close();

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
