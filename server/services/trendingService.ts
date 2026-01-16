// Trending topics & summaries service
// Wires Node server to FastAPI sidecar and Postgres via Drizzle.

import { config } from "../config";
import { db } from "../db";
import {
  trendingTopics,
  trendingSummaries,
  type TrendingTopic,
  type TrendingSummary,
  type InsertTrendingTopic,
  type InsertTrendingSummary,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";

// ===== Types that mirror the FastAPI contract =====

export type FastApiFetchRequest = {
  source: string;
  limit: number;
  filters?: {
    query?: string;
    category?: string;
    language?: string;
  };
};

export type FastApiTrendingTopic = {
  external_id?: string;
  title: string;
  url?: string;
  source?: string;
  category?: string;
  score?: number;
  published_at?: string;
  metadata?: Record<string, unknown>;
};

export type FastApiFetchResponse = {
  topics: FastApiTrendingTopic[];
};

export type FastApiSummarizeRequest = {
  topics: { title: string; url?: string }[];
  model?: string;
};

export type FastApiSummary = {
  summary: string;
  bullet_points?: string[];
  risk_level?: string;
  sentiment?: string;
  relevance_score?: number;
  model?: string;
};

export type FastApiSummarizeResponse = {
  summaries: FastApiSummary[];
};

function getFastApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.fastapi.internalToken) {
    headers["X-Internal-Token"] = config.fastapi.internalToken;
  }
  return headers;
}

// ===== DB helpers =====

export async function getTrendingTopicsWithLatestSummary(
  limit = 20,
  category?: string
): Promise<(TrendingTopic & { latestSummary: TrendingSummary | null })[]> {
  // Join topics + summaries and collapse in JS to "latest summary per topic"
  let query = db
    .select({
      topic: trendingTopics,
      summary: trendingSummaries,
    })
    .from(trendingTopics)
    .leftJoin(trendingSummaries, eq(trendingSummaries.topicId, trendingTopics.id))
    .orderBy(
      desc(trendingTopics.score),
      desc(trendingTopics.publishedAt),
      desc(trendingSummaries.createdAt)
    );

  if (category) {
    // NOTE: this assumes exact category match; you can loosen later if needed.
    // drizzle-orm's eq here is fine.
    // @ts-ignore - drizzle-orm overloads .where() in ways TS sometimes can't see.
    query = query.where(eq(trendingTopics.category, category));
  }

  const rows = await query;

  const byTopic = new Map<number, { topic: TrendingTopic; latestSummary: TrendingSummary | null }>();

  for (const row of rows) {
    const topic = row.topic as TrendingTopic;
    const summary = (row.summary ?? null) as TrendingSummary | null;
    const existing = byTopic.get(topic.id);

    if (!existing) {
      byTopic.set(topic.id, { topic, latestSummary: summary });
    } else if (
      summary &&
      existing.latestSummary &&
      summary.createdAt &&
      existing.latestSummary.createdAt &&
      summary.createdAt > existing.latestSummary.createdAt
    ) {
      existing.latestSummary = summary;
    }
  }

  return Array.from(byTopic.values())
    .slice(0, limit)
    .map(({ topic, latestSummary }) => ({
      ...topic,
      latestSummary,
    }));
}

// ===== Public API used by Express routes =====

export async function getTrendingTopics(opts?: {
  limit?: number;
  category?: string;
}) {
  const limit = opts?.limit ?? 20;
  const category = opts?.category;
  return getTrendingTopicsWithLatestSummary(limit, category);
}

export async function refreshTrendingTopics(opts?: {
  category?: string;
  limit?: number;
}) {
  if (!config.fastapi.enabled || !config.fastapi.baseUrl) {
    throw new Error("FastAPI trending service is not configured");
  }

  const limit = opts?.limit ?? 20;
  const category = opts?.category ?? "bonds";

  // 1) Fetch raw trending topics from FastAPI
  const fetchBody: FastApiFetchRequest = {
    source: "news",
    limit,
    filters: {
      category,
      query: "bonds OR treasuries OR yields OR fixed income",
      language: "en",
    },
  };

  const fetchRes = await fetch(`${config.fastapi.baseUrl}/api/trending/fetch`, {
    method: "POST",
    headers: getFastApiHeaders(),
    body: JSON.stringify(fetchBody),
  });

  if (!fetchRes.ok) {
    const text = await fetchRes.text();
    throw new Error(`FastAPI /api/trending/fetch error: ${fetchRes.status} ${text}`);
  }

  const fetchJson = (await fetchRes.json()) as FastApiFetchResponse;

  // 2) Insert topics into DB
  const insertedTopics: TrendingTopic[] = [];
  for (const t of fetchJson.topics) {
    const topic: InsertTrendingTopic = {
      source: t.source ?? "news",
      externalId: t.external_id,
      title: t.title,
      url: t.url,
      category: t.category ?? category,
      score: t.score != null ? String(t.score) : undefined,
      publishedAt: t.published_at ? new Date(t.published_at) : undefined,
      metadata: t.metadata ?? {},
    };
    const [created] = await db.insert(trendingTopics).values(topic).returning();
    insertedTopics.push(created);
  }

  if (insertedTopics.length === 0) {
    return [];
  }

  // 3) Ask FastAPI to summarize in batch (preserving order)
  const summarizeBody: FastApiSummarizeRequest = {
    topics: insertedTopics.map((t) => ({
      title: t.title,
      url: t.url ?? undefined,
    })),
    model: "gpt-4.1-mini",
  };

  const summarizeRes = await fetch(
    `${config.fastapi.baseUrl}/api/trending/summarize`,
    {
      method: "POST",
      headers: getFastApiHeaders(),
      body: JSON.stringify(summarizeBody),
    }
  );

  if (!summarizeRes.ok) {
    const text = await summarizeRes.text();
    throw new Error(
      `FastAPI /api/trending/summarize error: ${summarizeRes.status} ${text}`
    );
  }

  const summarizeJson = (await summarizeRes.json()) as FastApiSummarizeResponse;
  const summaries = summarizeJson.summaries ?? [];

  // 4) Insert summaries aligned by index (topic[i] ↔ summary[i])
  const max = Math.min(insertedTopics.length, summaries.length);
  for (let i = 0; i < max; i++) {
    const topic = insertedTopics[i];
    const s = summaries[i];

    // Ensure bulletPoints is a proper string array
    const cleanBulletPoints: string[] = [];
    if (Array.isArray(s.bullet_points)) {
      for (const bp of s.bullet_points) {
        if (typeof bp === "string") {
          cleanBulletPoints.push(bp);
        }
      }
    }

    const summaryData = {
      topicId: topic.id,
      summary: s.summary,
      bulletPoints: cleanBulletPoints,
      riskLevel: s.risk_level,
      sentiment: s.sentiment,
      relevanceScore:
        s.relevance_score != null ? String(s.relevance_score) : undefined,
      model: s.model,
    };
    
    await db.insert(trendingSummaries).values(summaryData).returning();
  }

  // 5) Return final enriched view from DB
  return getTrendingTopicsWithLatestSummary(limit, category);
}
