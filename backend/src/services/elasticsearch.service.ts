import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env';

export interface EmailSearchQuery {
  q?: string;
  status?: string;
  page?: number;
  limit?: number;
  userId?: string;
}

export interface EmailDocument {
  emailId: string;
  userId: string;
  senderId: string;
  senderEmail: string;
  campaignId: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt?: string | null;
  messageId?: string | null;
  createdAt: string;
}

export class ElasticsearchService {
  private client: Client;
  private indexName: string;
  private isIndexInitialized: boolean = false;

  constructor() {
    this.indexName = env.ELASTICSEARCH_INDEX;
    this.client = new Client({
      node: env.ELASTICSEARCH_URL,
    });
  }

  /**
   * Verifies if Elasticsearch cluster is reachable.
   */
  public async ping(): Promise<boolean> {
    try {
      return await this.client.ping();
    } catch {
      return false;
    }
  }

  /**
   * Initializes the emails index with strict mappings if it does not already exist,
   * or updates the mapping to ensure userId is indexed for tenant isolation.
   */
  public async ensureIndex(): Promise<void> {
    if (this.isIndexInitialized) return;

    try {
      const exists = await this.client.indices.exists({ index: this.indexName });
      if (!exists) {
        await this.client.indices.create({
          index: this.indexName,
          mappings: {
            properties: {
              emailId: { type: 'keyword' },
              userId: { type: 'keyword' },
              senderId: { type: 'keyword' },
              senderEmail: { type: 'keyword' },
              campaignId: { type: 'keyword' },
              recipient: {
                type: 'text',
                fields: { keyword: { type: 'keyword' } },
              },
              subject: { type: 'text' },
              body: { type: 'text' },
              status: { type: 'keyword' },
              scheduledAt: { type: 'date' },
              sentAt: { type: 'date' },
              messageId: { type: 'keyword' },
              createdAt: { type: 'date' },
            },
          },
        });
        console.log(`[Elasticsearch] Initialized index: ${this.indexName}`);
      } else {
        // Ensure userId field exists in mapping
        await this.client.indices.putMapping({
          index: this.indexName,
          properties: {
            userId: { type: 'keyword' },
          },
        });
      }
      this.isIndexInitialized = true;
    } catch (error) {
      console.warn(`[Elasticsearch] Index initialization warning:`, error instanceof Error ? error.message : error);
    }
  }

  /**
   * Indexes or updates an email document projection.
   * Resilient: Failure to index does not interrupt delivery.
   */
  public async indexEmail(doc: EmailDocument): Promise<void> {
    try {
      await this.ensureIndex();
      await this.client.index({
        index: this.indexName,
        id: doc.emailId,
        document: doc,
        refresh: 'wait_for',
      });
      console.log(`[Elasticsearch] Indexed email document: ${doc.emailId} (user: ${doc.userId}, status: ${doc.status})`);
    } catch (error) {
      console.warn(`[Elasticsearch] Indexing failed for email ${doc.emailId}:`, error instanceof Error ? error.message : error);
    }
  }

  /**
   * Performs full-text search across subject, body, recipient, and sender email.
   * Scopes search results strictly to the authenticated user via term filter on userId.
   */
  public async searchEmails(params: EmailSearchQuery) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.max(1, Math.min(100, params.limit || 20));
    const from = (page - 1) * limit;

    const mustClauses: any[] = [];
    const filterClauses: any[] = [];

    // Enforce tenant isolation if userId is provided
    if (params.userId) {
      filterClauses.push({
        bool: {
          should: [
            { term: { userId: params.userId } },
            { term: { 'userId.keyword': params.userId } },
          ],
          minimum_should_match: 1,
        },
      });
    }

    if (params.q && params.q.trim()) {
      mustClauses.push({
        multi_match: {
          query: params.q.trim(),
          fields: ['subject^2', 'body', 'recipient', 'senderEmail'],
          fuzziness: 'AUTO',
        },
      });
    } else {
      mustClauses.push({ match_all: {} });
    }

    if (params.status) {
      filterClauses.push({
        bool: {
          should: [
            { term: { status: params.status } },
            { term: { 'status.keyword': params.status } },
          ],
          minimum_should_match: 1,
        },
      });
    }

    try {
      await this.ensureIndex();
      const response = await this.client.search({
        index: this.indexName,
        from,
        size: limit,
        query: {
          bool: {
            must: mustClauses,
            filter: filterClauses,
          },
        },
        sort: [{ scheduledAt: { order: 'desc' } }],
      });

      const hits = response.hits.hits.map((hit: any) => hit._source);
      const total = typeof response.hits.total === 'number' ? response.hits.total : response.hits.total?.value || 0;

      return {
        success: true,
        data: hits,
        page,
        limit,
        total,
      };
    } catch (error) {
      console.error(`[Elasticsearch] Search query error:`, error instanceof Error ? error.message : error);
      throw new Error(`Elasticsearch query failed: ${error instanceof Error ? error.message : 'Service unavailable'}`);
    }
  }
}

export const elasticsearchService = new ElasticsearchService();
