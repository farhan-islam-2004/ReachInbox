import http from 'http';
import { PrismaClient } from '@prisma/client';
import { Client as EsClient } from '@elastic/elasticsearch';
import app from '../app';
import { env } from '../config/env';
import { getRedisClient } from '../config/redis';
import { authService, setTestGoogleExchangeHook } from '../services/auth.service';
import { emailSchedulerService } from '../services/email-scheduler.service';
import { rateLimitService } from '../services/rate-limit.service';
import { elasticsearchService } from '../services/elasticsearch.service';
import { slackService } from '../services/slack.service';
import { processEmailJob } from '../workers/email.worker';
import { emailQueue } from '../queues/email.queue';
import { SESSION_COOKIE_NAME } from '../middleware/auth.middleware';

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

async function runPhase7Verification() {
  console.log('====================================================');
  console.log('REACHINBOX SCHEDULER — PHASE 7 AUTH & OWNERSHIP TESTS');
  console.log('====================================================\n');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(4002, resolve));
  const baseUrl = 'http://localhost:4002';

  try {
    // --- PART 1: Google OAuth Flow & State Protection ---
    console.log('--- Part 1: Google OAuth Flow & State Security ---');

    // TEST 1: GET /api/auth/google generates OAuth redirect
    const googleAuthRes = await fetch(`${baseUrl}/api/auth/google`, { redirect: 'manual' });
    const authLocation = googleAuthRes.headers.get('location') || '';
    assert(
      googleAuthRes.status === 302 &&
        authLocation.includes('accounts.google.com/o/oauth2/v2/auth') &&
        authLocation.includes('scope=openid%20email%20profile') &&
        authLocation.includes('state='),
      'TEST 1: GET /api/auth/google generates OAuth redirect with valid scopes and state'
    );

    // TEST 2: OAuth state is generated and stored in Redis
    const state = await authService.generateOAuthState();
    const stateInRedis = await redis.get(`oauth:google:state:${state}`);
    const ttl = await redis.ttl(`oauth:google:state:${state}`);
    assert(
      stateInRedis === '1' && ttl > 500 && ttl <= 600,
      `TEST 2: OAuth state generated and stored in Redis with 10m TTL (ttl: ${ttl}s)`
    );

    // TEST 3: Invalid state is rejected
    const invalidCallbackRes = await fetch(
      `${baseUrl}/api/auth/google/callback?code=mock_code&state=non_existent_state_123`
    );
    assert(
      invalidCallbackRes.status === 400,
      'TEST 3: Callback with invalid/unknown state is rejected with HTTP 400'
    );

    // TEST 4: Expired state is rejected
    const expiredState = await authService.generateOAuthState();
    await redis.del(`oauth:google:state:${expiredState}`); // simulate expiration
    const expiredValid = await authService.validateOAuthState(expiredState);
    assert(expiredValid === false, 'TEST 4: Expired state validation returns false');

    // TEST 5: Consumed state cannot be reused (single-use guarantee)
    const singleUseState = await authService.generateOAuthState();
    const firstCheck = await authService.validateOAuthState(singleUseState);
    const secondCheck = await authService.validateOAuthState(singleUseState);
    assert(
      firstCheck === true && secondCheck === false,
      'TEST 5: Consumed OAuth state is deleted immediately and cannot be reused'
    );

    // --- PART 2: Google Identity & User Lifecycle ---
    console.log('\n--- Part 2: Google Identity & Session Management ---');

    const testGoogleSub = `google-sub-${Date.now()}`;
    const testEmail = `google.user.${Date.now()}@example.com`;

    // TEST 6: Google identity creates a new User
    const newUser = await authService.resolveOrCreateGoogleUser({
      sub: testGoogleSub,
      email: testEmail,
      name: 'Google Test User',
      picture: 'https://example.com/avatar.png',
    });
    assert(
      newUser.googleId === testGoogleSub && newUser.email === testEmail,
      'TEST 6: Verified Google identity resolves and creates new User with googleId'
    );

    // TEST 7: Existing Google identity logs into existing User without duplicating
    const existingUser = await authService.resolveOrCreateGoogleUser({
      sub: testGoogleSub,
      email: testEmail,
      name: 'Updated Google Name',
      picture: 'https://example.com/updated_avatar.png',
    });
    const totalUsersWithEmail = await prisma.user.count({ where: { email: testEmail } });
    assert(
      existingUser.id === newUser.id &&
        existingUser.name === 'Updated Google Name' &&
        totalUsersWithEmail === 1,
      'TEST 7: Existing Google identity updates safe profile fields without creating duplicate User'
    );

    // TEST 8: Session is created after successful login
    const session = await authService.createSession(newUser.id);
    const sessionInDb = await prisma.session.findUnique({ where: { id: session.id } });
    const daysUntilExpiry =
      (session.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    assert(
      sessionInDb !== null &&
        sessionInDb.userId === newUser.id &&
        daysUntilExpiry > 6.9 &&
        daysUntilExpiry <= 7.0,
      `TEST 8: Session record created in PostgreSQL with 7-day TTL (${daysUntilExpiry.toFixed(1)} days)`
    );

    // TEST 9: GET /api/auth/me returns authenticated user
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${session.id}`,
      },
    });
    const meData: any = await meRes.json();
    assert(
      meRes.status === 200 &&
        meData.success === true &&
        meData.user.id === newUser.id &&
        meData.user.googleId === testGoogleSub &&
        meData.user.email === testEmail,
      'TEST 9: GET /api/auth/me returns authenticated user payload when valid cookie is presented'
    );

    // TEST 10: Unauthenticated /me returns 401
    const unauthMeRes = await fetch(`${baseUrl}/api/auth/me`);
    assert(
      unauthMeRes.status === 401,
      'TEST 10: Unauthenticated GET /api/auth/me returns HTTP 401 Unauthorized'
    );

    // TEST 11: Logout invalidates session
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${session.id}`,
      },
    });
    const postLogoutMeRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${session.id}`,
      },
    });
    const sessionAfterLogout = await prisma.session.findUnique({ where: { id: session.id } });
    assert(
      logoutRes.status === 200 &&
        postLogoutMeRes.status === 401 &&
        sessionAfterLogout === null,
      'TEST 11: POST /api/auth/logout deletes server session and subsequent /me returns 401'
    );

    // TEST 12: Protected endpoint without session returns 401
    const protectedScheduleRes = await fetch(`${baseUrl}/api/emails/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: 'test@example.com',
        subject: 'Sub',
        body: 'Body',
        scheduledAt: new Date(Date.now() + 60000).toISOString(),
      }),
    });
    const protectedSearchRes = await fetch(`${baseUrl}/api/search/emails?q=test`);
    const protectedSlackRes = await fetch(`${baseUrl}/api/slack/status`);
    assert(
      protectedScheduleRes.status === 401 &&
        protectedSearchRes.status === 401 &&
        protectedSlackRes.status === 401,
      'TEST 12: Protected endpoints (/emails/schedule, /search/emails, /slack/status) return 401 without session'
    );

    // --- PART 3: Multi-Tenant Ownership Security ---
    console.log('\n--- Part 3: Multi-Tenant Ownership Security ---');

    // Setup User A and User B
    const userA = await prisma.user.create({
      data: {
        email: `usera_${Date.now()}@example.com`,
        name: 'User Alpha',
      },
    });
    const sessionA = await authService.createSession(userA.id);

    const userB = await prisma.user.create({
      data: {
        email: `userb_${Date.now()}@example.com`,
        name: 'User Beta',
      },
    });
    const sessionB = await authService.createSession(userB.id);

    const campaignB = await prisma.campaign.create({
      data: {
        userId: userB.id,
        subject: 'User B Campaign',
        body: 'Private campaign content for User B',
        startTime: new Date(),
      },
    });

    const senderB = await prisma.sender.create({
      data: {
        userId: userB.id,
        email: 'senderb@ethereal.email',
        etherealUser: 'senderb_user',
        etherealPassword: 'senderb_pass',
      },
    });

    // TEST 13: User A cannot access User B's campaign
    let userACampaignHijackFailed = false;
    try {
      await emailSchedulerService.scheduleEmail(
        {
          recipient: 'victim@example.com',
          subject: 'Hijack',
          body: 'Body',
          scheduledAt: new Date(Date.now() + 60000).toISOString(),
          campaignId: campaignB.id,
        },
        userA.id
      );
    } catch (err: any) {
      userACampaignHijackFailed = err.message.includes('Campaign not found or does not belong');
    }
    assert(
      userACampaignHijackFailed,
      "TEST 13: User A cannot schedule or hijack User B's campaign (rejected with ownership error)"
    );

    // TEST 14: User A cannot access User B's email
    const emailB = await prisma.email.create({
      data: {
        campaignId: campaignB.id,
        senderId: senderB.id,
        recipient: 'private-b@example.com',
        subject: 'User B Confidential',
        body: 'Confidential B body',
        scheduledAt: new Date(Date.now() + 60000),
        status: 'SCHEDULED',
      },
    });

    const userAFetchEmailBRes = await fetch(`${baseUrl}/api/emails/${emailB.id}`, {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${sessionA.id}`,
      },
    });
    const userBFetchEmailBRes = await fetch(`${baseUrl}/api/emails/${emailB.id}`, {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${sessionB.id}`,
      },
    });
    assert(
      userAFetchEmailBRes.status === 404 && userBFetchEmailBRes.status === 200,
      "TEST 14: User A cannot access User B's email by ID (404/denied for User A; 200 for User B)"
    );

    // TEST 15: User A cannot use User B's sender
    let userASenderHijackFailed = false;
    try {
      await emailSchedulerService.scheduleEmail(
        {
          recipient: 'victim@example.com',
          subject: 'Sender Hijack',
          body: 'Body',
          scheduledAt: new Date(Date.now() + 60000).toISOString(),
          senderId: senderB.id,
        },
        userA.id
      );
    } catch (err: any) {
      userASenderHijackFailed = err.message.includes('Sender not found or does not belong');
    }
    assert(
      userASenderHijackFailed,
      "TEST 15: User A cannot use User B's sender address (rejected with ownership error)"
    );

    // TEST 16: User A cannot access User B's Slack connection
    await prisma.slackConnection.create({
      data: {
        userId: userB.id,
        accessToken: 'xoxb-user-b-mock-token',
        teamId: 'T_USER_B',
        teamName: 'User B Workspace',
      },
    });

    const userASlackStatus = await slackService.getConnectionStatus(userA.id);
    const userBSlackStatus = await slackService.getConnectionStatus(userB.id);
    assert(
      userASlackStatus.connected === false &&
        userBSlackStatus.connected === true &&
        userBSlackStatus.teamName === 'User B Workspace',
      "TEST 16: User A cannot see or access User B's Slack connection"
    );

    // TEST 17: Elasticsearch search is strictly scoped to authenticated user
    console.log('\n--- Part 4: Elasticsearch User Scoping ---');
    await elasticsearchService.ensureIndex();

    const sharedKeyword = `tenant_secret_${Date.now()}`;
    await elasticsearchService.indexEmail({
      emailId: `email_a_${Date.now()}`,
      userId: userA.id,
      senderId: 'sender_a',
      senderEmail: 'a@example.com',
      campaignId: 'camp_a',
      recipient: 'a_recip@example.com',
      subject: `Alpha Topic with ${sharedKeyword}`,
      body: `User A private data with ${sharedKeyword}`,
      status: 'SENT',
      scheduledAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    await elasticsearchService.indexEmail({
      emailId: `email_b_${Date.now()}`,
      userId: userB.id,
      senderId: 'sender_b',
      senderEmail: 'b@example.com',
      campaignId: 'camp_b',
      recipient: 'b_recip@example.com',
      subject: `Beta Topic with ${sharedKeyword}`,
      body: `User B private data with ${sharedKeyword}`,
      status: 'SENT',
      scheduledAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    // User A searches via API
    const userASearchRes = await fetch(`${baseUrl}/api/search/emails?q=${sharedKeyword}`, {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${sessionA.id}`,
      },
    });
    const userASearchData: any = await userASearchRes.json();

    // User B searches via API
    const userBSearchRes = await fetch(`${baseUrl}/api/search/emails?q=${sharedKeyword}`, {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${sessionB.id}`,
      },
    });
    const userBSearchData: any = await userBSearchRes.json();

    const userASeesOnlyA =
      userASearchData.data.every((d: any) => d.userId === userA.id) &&
      userASearchData.data.length === 1;
    const userBSeesOnlyB =
      userBSearchData.data.every((d: any) => d.userId === userB.id) &&
      userBSearchData.data.length === 1;

    assert(
      userASeesOnlyA && userBSeesOnlyB,
      'TEST 17: Elasticsearch search query is scoped by userId — User A never receives User B results'
    );

    // --- PART 5: Phase 4–6 Regressions ---
    console.log('\n--- Part 5: Regressions & Invariants Verification ---');

    // TEST 18: Phase 4 Crash boundary regressions
    const crashEmail = await prisma.email.create({
      data: {
        campaignId: campaignB.id,
        senderId: senderB.id,
        recipient: 'crash-regression@example.com',
        subject: 'Crash Test',
        body: 'Body',
        scheduledAt: new Date(),
        status: 'PROCESSING',
        messageId: null,
      },
    });
    await processEmailJob({
      id: 'mock_crash_job',
      data: { emailId: crashEmail.id },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);
    const reloadedCrash = await prisma.email.findUnique({ where: { id: crashEmail.id } });
    assert(
      Boolean(
        reloadedCrash?.status === 'PROCESSING' &&
          reloadedCrash?.error?.includes('Preserved for operational review')
      ),
      'TEST 18: Phase 4 crash-boundary intact: Ambiguous PROCESSING + NULL messageId is preserved'
    );

    // TEST 19: Phase 5 Rate limiting & min delay regressions
    const testSenderId = `rate-sender-${Date.now()}`;
    const slot1 = await rateLimitService.reserveSendSlot({ senderId: testSenderId });
    const slot2 = await rateLimitService.reserveSendSlot({ senderId: testSenderId });
    assert(
      slot1.allowed === true && slot2.allowed === false && slot2.reason === 'MIN_DELAY',
      'TEST 19: Phase 5 rate-limiting intact: Minimum send delay (2000ms) rejects consecutive reservations'
    );

    // TEST 20: Phase 6 Observability & health checks
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const dbHealthRes = await fetch(`${baseUrl}/api/health/db`);
    const bullBoardRes = await fetch(`${baseUrl}/admin/queues`);
    assert(
      healthRes.status === 200 &&
        dbHealthRes.status === 200 &&
        bullBoardRes.status === 200,
      'TEST 20: Phase 6 intact: Health checks return 200 and Bull Board is accessible at /admin/queues'
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

runPhase7Verification().catch((err) => {
  console.error('Phase 7 test error:', err);
  process.exit(1);
});
