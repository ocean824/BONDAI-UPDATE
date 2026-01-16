import { db } from "../db";
import { 
  suretyTrusts, 
  suretyCases, 
  suretyCollateral, 
  suretyIndemnitors, 
  suretyDocuments,
  bonds,
  type SuretyCase,
  type SuretyTrust,
  type SuretyUnderwritingDecision
} from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { createImmutableEvent, type ImmutableEventType } from "./immutableEventService";

// ===== SURETY CLAIMS TRACKING =====

export interface SuretyClaimData {
  caseId: number;
  claimType: "PRINCIPAL_DEFAULT" | "INTEREST_DEFAULT" | "CUSTOMER_CLAIM" | "REGULATORY_FINE" | "OTHER";
  claimAmount: number;
  claimDescription: string;
  claimantName: string;
  incidentDate?: Date;
  filedDate?: Date;
}

export interface SuretyClaim {
  id: number;
  caseId: number;
  claimType: string;
  claimAmount: number;
  claimDescription: string;
  claimantName: string;
  incidentDate: Date | null;
  filedDate: Date | null;
  status: "FILED" | "UNDER_REVIEW" | "APPROVED" | "DENIED" | "PAID" | "CLOSED";
  paidAmount: number | null;
  decisionDate: Date | null;
  createdAt: Date;
}

// In-memory claims storage (replace with DB table in production)
const suretyClaims = new Map<number, SuretyClaim>();
let claimIdCounter = 1;

export async function fileSuretyClaim(data: SuretyClaimData): Promise<SuretyClaim> {
  const [suretyCase] = await db
    .select()
    .from(suretyCases)
    .where(eq(suretyCases.id, data.caseId));

  if (!suretyCase) {
    throw new Error("Surety case not found");
  }

  const claim: SuretyClaim = {
    id: claimIdCounter++,
    caseId: data.caseId,
    claimType: data.claimType,
    claimAmount: data.claimAmount,
    claimDescription: data.claimDescription,
    claimantName: data.claimantName,
    incidentDate: data.incidentDate || null,
    filedDate: data.filedDate || new Date(),
    status: "FILED",
    paidAmount: null,
    decisionDate: null,
    createdAt: new Date(),
  };

  suretyClaims.set(claim.id, claim);

  // Create immutable event
  await createImmutableEvent({
    type: "SURETY_CLAIMS" as ImmutableEventType,
    actorId: 0,
    actorType: "SYSTEM",
    entityType: "SURETY_CLAIM",
    entityId: claim.id,
    payload: {
      claimId: claim.id,
      caseId: data.caseId,
      claimType: data.claimType,
      claimAmount: data.claimAmount,
      claimantName: data.claimantName,
    },
    correlationId: `surety-claim-${claim.id}`,
  });

  // Update case status
  await db
    .update(suretyCases)
    .set({ status: "UNDER_REVIEW" })
    .where(eq(suretyCases.id, data.caseId));

  return claim;
}

export async function getSuretyClaims(caseId: number): Promise<SuretyClaim[]> {
  const claims: SuretyClaim[] = [];
  for (const claim of Array.from(suretyClaims.values())) {
    if (claim.caseId === caseId) {
      claims.push(claim);
    }
  }
  return claims.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function approveSuretyClaim(claimId: number, paidAmount: number): Promise<SuretyClaim | null> {
  const claim = suretyClaims.get(claimId);
  if (!claim) return null;

  claim.status = "PAID";
  claim.paidAmount = paidAmount;
  claim.decisionDate = new Date();

  // Create immutable event
  await createImmutableEvent({
    type: "SURETY_CLAIMS" as ImmutableEventType,
    actorId: 0,
    actorType: "ADMIN",
    entityType: "SURETY_CLAIM_APPROVED",
    entityId: claimId,
    payload: {
      claimId,
      caseId: claim.caseId,
      approvedAmount: paidAmount,
    },
    correlationId: `surety-claim-${claimId}`,
  });

  return claim;
}

// ===== SURETY RECONCILIATION =====

export interface SuretyReconciliation {
  id: number;
  trustId: number;
  periodStart: Date;
  periodEnd: Date;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "DISCREPANCY_FOUND";
  
  // Exposure reconciliation
  recordedExposure: number;
  calculatedExposure: number;
  exposureDiscrepancy: number;
  
  // Collateral reconciliation
  recordedCollateral: number;
  calculatedCollateral: number;
  collateralDiscrepancy: number;
  
  // Claims reconciliation
  recordedClaimsPaid: number;
  calculatedClaimsPaid: number;
  claimsDiscrepancy: number;
  
  // Overall
  totalDiscrepancy: number;
  notes: string;
  completedAt: Date | null;
  createdAt: Date;
}

const reconciliations: Map<number, SuretyReconciliation> = new Map();
let reconciliationIdCounter = 1;

export async function createReconciliation(
  trustId: number,
  periodStart: Date,
  periodEnd: Date
): Promise<SuretyReconciliation> {
  // Get trust data
  const [trust] = await db
    .select()
    .from(suretyTrusts)
    .where(eq(suretyTrusts.id, trustId));

  if (!trust) {
    throw new Error("Surety trust not found");
  }

  // Calculate actual exposure from active cases
  const activeCases = await db
    .select()
    .from(suretyCases)
    .where(and(
      eq(suretyCases.suretyTrustId, trustId),
      sql`${suretyCases.status} IN ('APPROVED', 'APPROVED_WITH_COLLATERAL', 'ACTIVE')`
    ));

  const calculatedExposure = activeCases.reduce(
    (sum, c) => sum + parseFloat(c.bondPenalSum || "0"),
    0
  );

  const recordedExposure = parseFloat(trust.currentExposure || "0");

  // Calculate actual collateral posted
  const collateralRecords = await db
    .select()
    .from(suretyCollateral)
    .innerJoin(suretyCases, eq(suretyCollateral.caseId, suretyCases.id))
    .where(and(
      eq(suretyCases.suretyTrustId, trustId),
      eq(suretyCollateral.status, "POSTED")
    ));

  const calculatedCollateral = collateralRecords.reduce(
    (sum, r) => sum + parseFloat(r.surety_collateral.postedAmount || "0"),
    0
  );

  // Get trust collateral total
  const recordedCollateral = collateralRecords.reduce(
    (sum, r) => sum + parseFloat(r.surety_collateral.requiredAmount || "0"),
    0
  );

  // Calculate claims paid (from our in-memory store)
  let calculatedClaimsPaid = 0;
  for (const claim of Array.from(suretyClaims.values())) {
    const [claimCase] = await db
      .select()
      .from(suretyCases)
      .where(eq(suretyCases.id, claim.caseId));
    
    if (claimCase?.suretyTrustId === trustId && claim.status === "PAID") {
      calculatedClaimsPaid += claim.paidAmount || 0;
    }
  }

  // Calculate discrepancies
  const exposureDiscrepancy = recordedExposure - calculatedExposure;
  const collateralDiscrepancy = recordedCollateral - calculatedCollateral;
  const claimsDiscrepancy = 0; // Would need claims table
  const totalDiscrepancy = Math.abs(exposureDiscrepancy) + Math.abs(collateralDiscrepancy);

  const reconciliation: SuretyReconciliation = {
    id: reconciliationIdCounter++,
    trustId,
    periodStart,
    periodEnd,
    status: totalDiscrepancy > 0 ? "DISCREPANCY_FOUND" : "PENDING",
    recordedExposure,
    calculatedExposure,
    exposureDiscrepancy,
    recordedCollateral,
    calculatedCollateral,
    collateralDiscrepancy,
    recordedClaimsPaid: 0,
    calculatedClaimsPaid,
    claimsDiscrepancy,
    totalDiscrepancy,
    notes: "",
    completedAt: null,
    createdAt: new Date(),
  };

  reconciliations.set(reconciliation.id, reconciliation);

  // Create immutable event
  await createImmutableEvent({
    type: "SURETY_RECONCILIATION" as ImmutableEventType,
    actorId: 0,
    actorType: "SYSTEM",
    entityType: "SURETY_RECONCILIATION",
    entityId: reconciliation.id,
    payload: {
      reconciliationId: reconciliation.id,
      trustId,
      exposureDiscrepancy,
      collateralDiscrepancy,
      totalDiscrepancy,
    },
    correlationId: `reconciliation-${reconciliation.id}`,
  });

  return reconciliation;
}

export async function getReconciliations(trustId: number): Promise<SuretyReconciliation[]> {
  const result: SuretyReconciliation[] = [];
  for (const rec of Array.from(reconciliations.values())) {
    if (rec.trustId === trustId) {
      result.push(rec);
    }
  }
  return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

// ===== TRUST EXPOSURE REPORTING =====

export interface TrustExposureReport {
  trustId: number;
  trustName: string;
  
  // Limits
  singleBondLimit: number;
  aggregateLimit: number;
  currentExposure: number;
  availableCapacity: number;
  utilizationPercent: number;
  
  // Active cases
  activeCasesCount: number;
  activeCasesTotal: number;
  casesByStatus: Record<string, number>;
  
  // Collateral
  totalCollateralRequired: number;
  totalCollateralPosted: number;
  collateralCoveragePercent: number;
  
  // Claims
  claimsFiled: number;
  claimsPaid: number;
  pendingClaims: number;
  
  // Risk metrics
  averageBondSize: number;
  largestBondExposure: number;
  riskDistribution: Record<string, number>;
}

export async function generateTrustExposureReport(trustId: number): Promise<TrustExposureReport | null> {
  const [trust] = await db
    .select()
    .from(suretyTrusts)
    .where(eq(suretyTrusts.id, trustId));

  if (!trust) return null;

  const cases = await db
    .select()
    .from(suretyCases)
    .where(eq(suretyCases.suretyTrustId, trustId));

  const singleBondLimit = parseFloat(trust.maxSingleBondLimit || "0");
  const aggregateLimit = parseFloat(trust.aggregateBondLimit || "0");
  const currentExposure = parseFloat(trust.currentExposure || "0");

  // Calculate metrics
  const activeCases = cases.filter(c => 
    ["APPROVED", "APPROVED_WITH_COLLATERAL", "ACTIVE"].includes(c.status)
  );
  
  const activeCasesTotal = activeCases.reduce(
    (sum, c) => sum + parseFloat(c.bondPenalSum || "0"),
    0
  );

  const casesByStatus: Record<string, number> = {};
  for (const c of cases) {
    casesByStatus[c.status] = (casesByStatus[c.status] || 0) + 1;
  }

  // Collateral metrics
  const collateralRecords = await db
    .select()
    .from(suretyCollateral)
    .innerJoin(suretyCases, eq(suretyCollateral.caseId, suretyCases.id))
    .where(eq(suretyCases.suretyTrustId, trustId));

  const totalCollateralRequired = collateralRecords.reduce(
    (sum, r) => sum + parseFloat(r.surety_collateral.requiredAmount || "0"),
    0
  );
   
  const totalCollateralPosted = collateralRecords
    .filter(r => r.surety_collateral.status === "POSTED")
    .reduce((sum, r) => sum + parseFloat(r.surety_collateral.postedAmount || "0"), 0);

  // Claims metrics
  let claimsFiled = 0;
  let claimsPaid = 0;
  let pendingClaims = 0;

  for (const claim of Array.from(suretyClaims.values())) {
    const [claimCase] = await db
      .select()
      .from(suretyCases)
      .where(eq(suretyCases.id, claim.caseId));
    
    if (claimCase?.suretyTrustId === trustId) {
      claimsFiled++;
      if (claim.status === "PAID") {
        claimsPaid++;
      } else if (claim.status === "FILED" || claim.status === "UNDER_REVIEW") {
        pendingClaims++;
      }
    }
  }

  // Risk distribution
  const riskDistribution: Record<string, number> = {
    LOW: 0,
    MODERATE: 0,
    HIGH: 0,
  };

  for (const c of activeCases) {
    const riskScore = parseFloat(c.principalRiskScore || "50");
    if (riskScore < 40) riskDistribution.LOW++;
    else if (riskScore < 70) riskDistribution.MODERATE++;
    else riskDistribution.HIGH++;
  }

  return {
    trustId,
    trustName: trust.name,
    singleBondLimit,
    aggregateLimit,
    currentExposure,
    availableCapacity: aggregateLimit > 0 ? Math.max(0, aggregateLimit - currentExposure) : Infinity,
    utilizationPercent: aggregateLimit > 0 ? (currentExposure / aggregateLimit) * 100 : 0,
    activeCasesCount: activeCases.length,
    activeCasesTotal,
    casesByStatus,
    totalCollateralRequired,
    totalCollateralPosted,
    collateralCoveragePercent: totalCollateralRequired > 0 
      ? (totalCollateralPosted / totalCollateralRequired) * 100 
      : 100,
    claimsFiled,
    claimsPaid,
    pendingClaims,
    averageBondSize: activeCases.length > 0 ? activeCasesTotal / activeCases.length : 0,
    largestBondExposure: activeCases.length > 0 
      ? Math.max(...activeCases.map(c => parseFloat(c.bondPenalSum || "0")))
      : 0,
    riskDistribution,
  };
}

// ===== PORTFOLIO-LEVEL SURETY REPORTING =====

export async function getSuretyPortfolioReport(): Promise<{
  totalTrusts: number;
  totalExposure: number;
  totalCapacity: number;
  utilizationPercent: number;
  trusts: Array<{
    id: number;
    name: string;
    exposure: number;
    capacity: number;
    utilization: number;
    activeCases: number;
  }>;
  aggregateRiskScore: number;
}> {
  const trusts = await db.select().from(suretyTrusts);

  let totalExposure = 0;
  let totalCapacity = 0;
  let weightedRiskScore = 0;

  const trustSummaries = [];

  for (const trust of trusts) {
    const exposure = parseFloat(trust.currentExposure || "0");
    const capacity = parseFloat(trust.aggregateBondLimit || "0");
    
    totalExposure += exposure;
    totalCapacity += capacity === Infinity ? 0 : capacity;

    // Get active cases count for this trust
    const cases = await db
      .select()
      .from(suretyCases)
      .where(and(
        eq(suretyCases.suretyTrustId, trust.id),
        sql`${suretyCases.status} IN ('APPROVED', 'APPROVED_WITH_COLLATERAL', 'ACTIVE')`
      ));

    const avgRiskScore = cases.length > 0
      ? cases.reduce((sum, c) => sum + parseFloat(c.principalRiskScore || "50"), 0) / cases.length
      : 50;

    weightedRiskScore += exposure * avgRiskScore;

    trustSummaries.push({
      id: trust.id,
      name: trust.name,
      exposure,
      capacity: capacity === Infinity ? -1 : capacity,
      utilization: capacity > 0 ? (exposure / capacity) * 100 : 0,
      activeCases: cases.length,
    });
  }

  return {
    totalTrusts: trusts.length,
    totalExposure,
    totalCapacity: totalCapacity === 0 ? Infinity : totalCapacity,
    utilizationPercent: totalCapacity > 0 ? (totalExposure / totalCapacity) * 100 : 0,
    trusts: trustSummaries,
    aggregateRiskScore: totalExposure > 0 ? weightedRiskScore / totalExposure : 50,
  };
}
