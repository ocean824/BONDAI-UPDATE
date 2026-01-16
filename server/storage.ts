// Reference: javascript_database blueprint
import { 
  users, 
  type User, 
  type InsertUser, 
  judgments, 
  type Judgment, 
  type InsertJudgment,
  bundles,
  type Bundle,
  type InsertBundle,
  bundleJudgments,
  type BundleJudgment,
  type InsertBundleJudgment,
  priceEstimates,
  type PriceEstimate,
  type InsertPriceEstimate,
  bonds,
  type Bond,
  type InsertBond,
  bondDocuments,
  type BondDocument,
  type InsertBondDocument,
  chatSessions,
  type ChatSession,
  type InsertChatSession,
  chatMessages,
  type ChatMessage,
  type InsertChatMessage,
  underwritingCases,
  type UnderwritingCase,
  type InsertUnderwritingCase,
  underwritingParties,
  type UnderwritingParty,
  type InsertUnderwritingParty,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Judgments
  getJudgments(ownerId?: number): Promise<Judgment[]>;
  getJudgment(id: number): Promise<Judgment | undefined>;
  createJudgment(judgment: InsertJudgment): Promise<Judgment>;
  updateJudgment(id: number, data: Partial<InsertJudgment>): Promise<Judgment>;
  
  // Bundles
  getBundles(ownerId?: number): Promise<Bundle[]>;
  getBundle(id: number): Promise<Bundle | undefined>;
  createBundle(bundle: InsertBundle): Promise<Bundle>;
  updateBundle(id: number, data: Partial<InsertBundle>): Promise<Bundle>;
  
  // Bundle Judgments
  getBundleJudgments(bundleId: number): Promise<BundleJudgment[]>;
  addJudgmentToBundle(data: InsertBundleJudgment): Promise<BundleJudgment>;
  removeJudgmentFromBundle(bundleId: number, judgmentId: number): Promise<void>;
  
  // Price Estimates
  getPriceEstimates(judgmentId: number): Promise<PriceEstimate[]>;
  createPriceEstimate(estimate: InsertPriceEstimate): Promise<PriceEstimate>;
  deletePriceEstimates(judgmentId: number, scenarios: string[]): Promise<void>;
  
  // Bonds
  getBonds(ownerId?: number): Promise<Bond[]>;
  getBond(id: number): Promise<Bond | undefined>;
  createBond(bond: InsertBond): Promise<Bond>;
  updateBond(id: number, data: Partial<InsertBond>): Promise<Bond>;
  
  // Bond documents
  createBondDocument(doc: InsertBondDocument): Promise<BondDocument>;
  getBondDocuments(bondId: number, ownerId: number): Promise<BondDocument[]>;
  searchBondDocuments(ownerId: number, query: string): Promise<BondDocument[]>;
  updateBondDocumentAI(id: number, summary: string, tags: string[]): Promise<BondDocument>;
  
  // Chat
  getChatSession(id: number): Promise<ChatSession | undefined>;
  createChatSession(session: InsertChatSession): Promise<ChatSession>;
  getChatMessages(sessionId: number): Promise<ChatMessage[]>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  
  // Underwriting
  getUnderwritingCases(ownerId?: number): Promise<any[]>;
  createUnderwritingCaseWithPartiesAndMetrics(
    ownerId: number,
    caseInput: any,
    parties: any[],
    metrics: any,
    narrative?: string
  ): Promise<any>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  // Judgments
  async getJudgments(ownerId?: number): Promise<Judgment[]> {
    if (ownerId === undefined) {
      // Admin: return all judgments
      return await db.select().from(judgments).orderBy(desc(judgments.createdAt));
    }
    return await db.select().from(judgments).where(eq(judgments.ownerId, ownerId)).orderBy(desc(judgments.createdAt));
  }

  async getJudgment(id: number): Promise<Judgment | undefined> {
    const [judgment] = await db.select().from(judgments).where(eq(judgments.id, id));
    return judgment || undefined;
  }

  async createJudgment(judgment: InsertJudgment): Promise<Judgment> {
    const [created] = await db.insert(judgments).values(judgment).returning();
    return created;
  }

  async updateJudgment(id: number, data: Partial<InsertJudgment>): Promise<Judgment> {
    const [updated] = await db
      .update(judgments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(judgments.id, id))
      .returning();
    return updated;
  }

  // Bundles
  async getBundles(ownerId?: number): Promise<Bundle[]> {
    if (ownerId === undefined) {
      // Admin: return all bundles
      return await db.select().from(bundles).orderBy(desc(bundles.createdAt));
    }
    return await db.select().from(bundles).where(eq(bundles.ownerId, ownerId)).orderBy(desc(bundles.createdAt));
  }

  async getBundle(id: number): Promise<Bundle | undefined> {
    const [bundle] = await db.select().from(bundles).where(eq(bundles.id, id));
    return bundle || undefined;
  }

  async createBundle(bundle: InsertBundle): Promise<Bundle> {
    const [created] = await db.insert(bundles).values(bundle).returning();
    return created;
  }

  async updateBundle(id: number, data: Partial<InsertBundle>): Promise<Bundle> {
    const [updated] = await db
      .update(bundles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(bundles.id, id))
      .returning();
    return updated;
  }

  // Bundle Judgments
  async getBundleJudgments(bundleId: number): Promise<BundleJudgment[]> {
    return await db
      .select()
      .from(bundleJudgments)
      .where(eq(bundleJudgments.bundleId, bundleId))
      .orderBy(desc(bundleJudgments.addedAt));
  }

  async addJudgmentToBundle(data: InsertBundleJudgment): Promise<BundleJudgment> {
    const [created] = await db.insert(bundleJudgments).values(data).returning();
    return created;
  }

  async removeJudgmentFromBundle(bundleId: number, judgmentId: number): Promise<void> {
    await db
      .delete(bundleJudgments)
      .where(
        and(
          eq(bundleJudgments.bundleId, bundleId),
          eq(bundleJudgments.judgmentId, judgmentId)
        )
      );
  }

  // Price Estimates
  async getPriceEstimates(judgmentId: number): Promise<PriceEstimate[]> {
    return await db
      .select()
      .from(priceEstimates)
      .where(eq(priceEstimates.judgmentId, judgmentId))
      .orderBy(desc(priceEstimates.createdAt));
  }

  async createPriceEstimate(estimate: InsertPriceEstimate): Promise<PriceEstimate> {
    const [created] = await db.insert(priceEstimates).values(estimate).returning();
    return created;
  }

  async deletePriceEstimates(judgmentId: number, scenarios: string[]): Promise<void> {
    await db.delete(priceEstimates).where(eq(priceEstimates.judgmentId, judgmentId));
  }

  // Bonds
  async getBonds(ownerId?: number): Promise<Bond[]> {
    if (ownerId === undefined) {
      // Admin: return all bonds
      return await db.select().from(bonds).orderBy(desc(bonds.createdAt));
    }
    return await db.select().from(bonds).where(eq(bonds.ownerId, ownerId)).orderBy(desc(bonds.createdAt));
  }

  async getBond(id: number): Promise<Bond | undefined> {
    const [bond] = await db.select().from(bonds).where(eq(bonds.id, id));
    return bond || undefined;
  }

  async createBond(bond: InsertBond): Promise<Bond> {
    const bondWithStringFaceValue = {
      ...bond,
      faceValue: String(bond.faceValue),
    };
    const [created] = await db.insert(bonds).values(bondWithStringFaceValue).returning();
    return created;
  }

  async updateBond(id: number, data: Partial<InsertBond>): Promise<Bond> {
    const dataWithStringFaceValue = {
      ...data,
      faceValue: data.faceValue !== undefined ? String(data.faceValue) : undefined,
    };
    const [updated] = await db
      .update(bonds)
      .set({ ...dataWithStringFaceValue, updatedAt: new Date() })
      .where(eq(bonds.id, id))
      .returning();
    return updated;
  }

  // Bond documents
  async createBondDocument(doc: InsertBondDocument): Promise<BondDocument> {
    const [created] = await db.insert(bondDocuments).values(doc).returning();
    return created;
  }

  async getBondDocuments(bondId: number, ownerId: number): Promise<BondDocument[]> {
    return await db
      .select()
      .from(bondDocuments)
      .where(
        and(
          eq(bondDocuments.bondId, bondId),
          eq(bondDocuments.ownerId, ownerId)
        )
      )
      .orderBy(desc(bondDocuments.createdAt));
  }

  async searchBondDocuments(ownerId: number, query: string): Promise<BondDocument[]> {
    // Simple search: filter by owner, could add full-text search later
    return await db
      .select()
      .from(bondDocuments)
      .where(eq(bondDocuments.ownerId, ownerId))
      .orderBy(desc(bondDocuments.createdAt));
  }

  async updateBondDocumentAI(id: number, summary: string, tags: string[]): Promise<BondDocument> {
    const [updated] = await db
      .update(bondDocuments)
      .set({ aiSummary: summary, tags: tags as any })
      .where(eq(bondDocuments.id, id))
      .returning();
    return updated;
  }

  // Chat
  async getChatSession(id: number): Promise<ChatSession | undefined> {
    const [session] = await db.select().from(chatSessions).where(eq(chatSessions.id, id));
    return session || undefined;
  }

  async createChatSession(session: InsertChatSession): Promise<ChatSession> {
    const [created] = await db.insert(chatSessions).values(session).returning();
    return created;
  }

  async getChatMessages(sessionId: number): Promise<ChatMessage[]> {
    return await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.createdAt);
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [created] = await db.insert(chatMessages).values(message).returning();
    return created;
  }

  // Underwriting
  async getUnderwritingCases(ownerId?: number): Promise<any[]> {
    if (ownerId === undefined) {
      // Admin: return all cases
      const cases = await db.select().from(underwritingCases).orderBy(desc(underwritingCases.createdAt));
      const result = [];
      for (const c of cases) {
        const parties = await db.select().from(underwritingParties).where(eq(underwritingParties.caseId, c.id));
        result.push({
          id: c.id,
          ownerId: c.ownerId,
          caseInput: c.caseInput,
          metrics: c.metrics,
          narrative: c.narrative,
          createdAt: c.createdAt,
          parties: parties.map(p => p.partyData),
        });
      }
      return result;
    }
    const cases = await db.select().from(underwritingCases).where(eq(underwritingCases.ownerId, ownerId)).orderBy(desc(underwritingCases.createdAt));
    const result = [];
    for (const c of cases) {
      const parties = await db.select().from(underwritingParties).where(eq(underwritingParties.caseId, c.id));
      result.push({
        id: c.id,
        ownerId: c.ownerId,
        caseInput: c.caseInput,
        metrics: c.metrics,
        narrative: c.narrative,
        createdAt: c.createdAt,
        parties: parties.map(p => p.partyData),
      });
    }
    return result;
  }

  async createUnderwritingCaseWithPartiesAndMetrics(
    ownerId: number,
    caseInput: any,
    parties: any[],
    metrics: any,
    narrative?: string
  ): Promise<any> {
    const [underwritingCase] = await db.insert(underwritingCases).values({
      ownerId,
      caseInput,
      metrics,
      narrative: narrative || null,
    }).returning();

    const partyRecords: InsertUnderwritingParty[] = parties.map(p => ({
      caseId: underwritingCase.id,
      partyData: p,
    }));

    if (partyRecords.length > 0) {
      await db.insert(underwritingParties).values(partyRecords);
    }

    return {
      id: underwritingCase.id,
      ownerId: underwritingCase.ownerId,
      caseInput: underwritingCase.caseInput,
      metrics: underwritingCase.metrics,
      narrative: underwritingCase.narrative,
      createdAt: underwritingCase.createdAt,
      parties,
    };
  }
}

export const storage = new DatabaseStorage();
