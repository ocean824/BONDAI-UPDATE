import { db } from "../db";
import { eq, and, inArray } from "drizzle-orm";
import { bonds, bondAssignments, distributions, users } from "@shared/schema";
import { createImmutableEvent, type ImmutableEventType } from "./immutableEventService";
import { postJournalEntry, ACCOUNT_CODES } from "./ledgerService";

// Constants for distribution rules
const RECOUPMENT_THRESHOLD = 10000; // $10,000 recoupment requirement
const DISTRIBUTION_SPLIT = 1 / 3; // 1/3 split after recoupment

export interface ReceiptData {
  bondId: number;
  amount: number;
  description: string;
  receivedAt?: Date;
}

// Record a receipt for a bond
export async function recordReceipt(data: ReceiptData): Promise<typeof distributions.$inferSelect | null> {
  const [bond] = await db.select().from(bonds).where(eq(bonds.id, data.bondId));
  if (!bond) throw new Error("Bond not found");

  // Calculate recoupment status
  const allExistingDistributions = await db
    .select()
    .from(distributions)
    .where(and(
      eq(distributions.bondId, data.bondId),
      eq(distributions.status, "EXECUTED")
    ));

  const totalRecouped = allExistingDistributions
    ? allExistingDistributions.reduce((sum: number, d: typeof distributions.$inferSelect) => sum + parseFloat(String(d.recoupmentAmount)), 0)
    : 0;

  const remainingRecoupment = Math.max(0, RECOUPMENT_THRESHOLD - totalRecouped);
  const recoupmentAmount = Math.min(data.amount, remainingRecoupment);
  const distributableAmount = data.amount - recoupmentAmount;

  // Create distribution record
  const [distribution] = await db.insert(distributions).values({
    bondId: data.bondId,
    distributionType: "INTEREST", // Default to interest, could be determined by input
    totalAmount: String(data.amount),
    recoupmentAmount: String(recoupmentAmount),
    distributionAmount: String(distributableAmount),
    status: "PENDING",
    metadata: {
      description: data.description,
      receivedAt: data.receivedAt || new Date(),
    },
  }).returning();

  // Create immutable event
  await createImmutableEvent({
    type: "DISTRIBUTION_EXECUTED" as ImmutableEventType,
    actorId: 0, // System or admin
    actorType: "SYSTEM",
    entityType: "DISTRIBUTION",
    entityId: distribution.id,
    payload: {
      distributionId: distribution.id,
      bondId: data.bondId,
      bondName: bond.name,
      totalAmount: data.amount,
      recoupmentAmount,
      distributableAmount,
      description: data.description,
    },
    correlationId: `distribution-${distribution.id}`,
  });

  return distribution;
}

// Execute distribution - calculate payouts and create ledger entries
export async function executeDistribution(distributionId: number): Promise<{
  distribution: typeof distributions.$inferSelect;
  payouts: { investorId: number; amount: number; investorEmail: string }[];
}> {
  const [distribution] = await db
    .select()
    .from(distributions)
    .where(eq(distributions.id, distributionId));

  if (!distribution || distribution.status !== "PENDING") {
    throw new Error("Distribution not found or already executed");
  }

  // Get all active assignments for this bond
  const assignments = await db
    .select({
      assignmentId: bondAssignments.id,
      investorId: bondAssignments.investorId,
      ownershipPercent: bondAssignments.ownershipPercent,
      faceValueAmount: bondAssignments.faceValueAmount,
      email: users.email,
    })
    .from(bondAssignments)
    .innerJoin(users, eq(bondAssignments.investorId, users.id))
    .where(and(
      eq(bondAssignments.bondId, distribution.bondId),
      eq(bondAssignments.status, "ACTIVE")
    ));

  if (assignments.length === 0) {
    throw new Error("No active assignments for this bond");
  }

  const distributableAmount = parseFloat(String(distribution.distributionAmount));
  const totalOwnership = assignments.reduce(
    (sum, a) => sum + parseFloat(String(a.ownershipPercent)),
    0
  );

  const payouts = assignments.map(a => {
    const ownershipShare = parseFloat(String(a.ownershipPercent)) / totalOwnership;
    const payoutAmount = distributableAmount * ownershipShare;
    
    return {
      investorId: a.investorId,
      amount: payoutAmount,
      investorEmail: a.email || "",
    };
  });

  // Update distribution status
  await db
    .update(distributions)
    .set({
      status: "EXECUTED",
      executedAt: new Date(),
    })
    .where(eq(distributions.id, distributionId));

  // Create ledger entries for distribution
  const totalPayout = payouts.reduce((sum, p) => sum + p.amount, 0);
  const recoupment = parseFloat(String(distribution.recoupmentAmount));

  await postJournalEntry({
    type: "DISTRIBUTION",
    description: `Distribution for bond ${distribution.bondId}`,
    currency: "USD",
    lines: [
      {
        accountCode: ACCOUNT_CODES.CASH_HOLDING,
        debit: totalPayout + recoupment,
        credit: 0,
        description: "Cash received for distribution",
      },
      {
        accountCode: ACCOUNT_CODES.RECOUPMENT_RESERVE,
        debit: 0,
        credit: recoupment,
        description: `Recoupment reserve ($${recoupment.toFixed(2)})`,
      },
      {
        accountCode: ACCOUNT_CODES.DISTRIBUTABLE_EARNINGS,
        debit: 0,
        credit: totalPayout,
        description: "Distributable earnings allocated",
      },
    ],
    metadata: {
      distributionId,
      bondId: distribution.bondId,
      recoupmentAmount: recoupment,
      totalPayout,
      investorCount: payouts.length,
    },
  });

  // Create individual investor payable entries
  for (const payout of payouts) {
    await postJournalEntry({
      type: "DISTRIBUTION_PAYOUT",
      description: `Payout to investor ${payout.investorId}`,
      currency: "USD",
      lines: [
        {
          accountCode: ACCOUNT_CODES.DISTRIBUTABLE_EARNINGS,
          debit: payout.amount,
          credit: 0,
          description: `Payout allocation`,
        },
        {
          accountCode: ACCOUNT_CODES.INVESTOR_PAYABLE,
          debit: 0,
          credit: payout.amount,
          description: `Payout to investor ${payout.investorId}`,
        },
      ],
      metadata: {
        distributionId,
        investorId: payout.investorId,
        payoutAmount: payout.amount,
      },
    });
  }

  return {
    distribution: { ...distribution, status: "EXECUTED" as const },
    payouts,
  };
}

// Get distribution history for a bond
export async function getBondDistributions(bondId: number): Promise<typeof distributions.$inferSelect[]> {
  const dists = await db
    .select()
    .from(distributions)
    .where(eq(distributions.bondId, bondId))
    .orderBy((d) => d.createdAt);

  return dists;
}

// Get distribution history for an investor
export async function getInvestorDistributions(investorId: number): Promise<{
  bondId: number;
  bondName: string;
  distributionType: string;
  totalAmount: number;
  recoupmentAmount: number;
  distributionAmount: number;
  status: string;
  executedAt: Date | null;
}[]> {
  const investorAssignments = await db
    .select({ bondId: bondAssignments.bondId })
    .from(bondAssignments)
    .where(eq(bondAssignments.investorId, investorId));

  const bondIds = Array.from(new Set(investorAssignments.map(a => a.bondId)));
   
  const distributionData = await db
    .select({
      bondId: distributions.bondId,
      bondName: bonds.name,
      distributionType: distributions.distributionType,
      totalAmount: distributions.totalAmount,
      recoupmentAmount: distributions.recoupmentAmount,
      distributionAmount: distributions.distributionAmount,
      status: distributions.status,
      executedAt: distributions.executedAt,
    })
    .from(distributions)
    .innerJoin(bonds, eq(distributions.bondId, bonds.id))
    .where(inArray(distributions.bondId, bondIds));

  type DistributionResult = {
    bondId: number;
    bondName: string;
    distributionType: string;
    totalAmount: number;
    recoupmentAmount: number;
    distributionAmount: number;
    status: string;
    executedAt: Date | null;
  };

  return distributionData.map((d): DistributionResult => ({
    bondId: d.bondId,
    bondName: d.bondName || "",
    distributionType: d.distributionType,
    totalAmount: parseFloat(String(d.totalAmount)),
    recoupmentAmount: parseFloat(String(d.recoupmentAmount)),
    distributionAmount: parseFloat(String(d.distributionAmount)),
    status: d.status,
    executedAt: d.executedAt,
  }));
}

// Get distribution summary/reporting
export async function getDistributionReport(bondId: number): Promise<{
  bondId: number;
  totalReceived: number;
  totalRecouped: number;
  totalDistributed: number;
  investorCount: number;
  recoupmentComplete: boolean;
  distributions: typeof distributions.$inferSelect[];
}> {
  const [bond] = await db.select().from(bonds).where(eq(bonds.id, bondId));
  if (!bond) throw new Error("Bond not found");

  const dists = await getBondDistributions(bondId);
  
  const totalReceived = dists.reduce(
    (sum, d) => sum + parseFloat(String(d.totalAmount)),
    0
  );
  
  const totalRecouped = dists
    .filter(d => d.status === "EXECUTED")
    .reduce((sum, d) => sum + parseFloat(String(d.recoupmentAmount)), 0);
  
  const totalDistributed = dists
    .filter(d => d.status === "EXECUTED")
    .reduce((sum, d) => sum + parseFloat(String(d.distributionAmount)), 0);

  const assignments = await db
    .select()
    .from(bondAssignments)
    .where(and(
      eq(bondAssignments.bondId, bondId),
      eq(bondAssignments.status, "ACTIVE")
    ));

  return {
    bondId,
    totalReceived,
    totalRecouped,
    totalDistributed,
    investorCount: assignments.length,
    recoupmentComplete: totalRecouped >= RECOUPMENT_THRESHOLD,
    distributions: dists,
  };
}
