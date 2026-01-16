import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import { underwritingCases, underwritingParties, bonds, users } from "@shared/schema";
import { createImmutableEvent, type ImmutableEventType } from "./immutableEventService";

// ===== RISK SCORING MODEL =====

export interface RiskScoreFactors {
  // Financial factors (0-100 weights)
  claimToAssetRatio: number;        // Lower is better
  collectionProbability: number;    // Based on historical data
  debtorFinancialHealth: number;    // 0-100 score
  assetLiquidity: number;           // 0-100 (cash/equivalents vs real estate)
  
  // Legal factors (0-100 weights)
  lienPositionStrength: number;     // First lien vs junior
  jurisdictionFavorability: number; // State-level recovery rates
  documentationQuality: number;     // completeness of judgment docs
  
  // Market factors (0-100 weights)
  marketConditions: number;         // Current collection environment
  industryRisk: number;             // Debtor industry risk profile
  economicConditions: number;       // Regional economic health
}

export interface RiskScoreResult {
  overallScore: number;             // 0-100 (higher = lower risk)
  riskTier: "LOW" | "MODERATE" | "HIGH" | "SPECULATIVE";
  confidence: number;               // 0-1 (confidence in the score)
  factors: RiskScoreFactors;
  factorWeights: Record<keyof RiskScoreFactors, number>;
  recoveryProbability: number;      // Expected recovery % of claim
  expectedLoss: number;             // Expected loss % of claim
  valueAtRisk: number;              // VaR at 95% confidence
  monteCarloResults?: MonteCarloResult;
}

export interface MonteCarloResult {
  simulations: number;
  meanRecovery: number;
  medianRecovery: number;
  stdDev: number;
  percentile5: number;
  percentile25: number;
  percentile50: number;
  percentile75: number;
  percentile95: number;
  probabilityOfLoss: number;        // P(recovery < 50% of face value)
  probabilityOfHighRecovery: number; // P(recovery > 80% of face value)
}

// ===== PROBABILITY MODELING =====

export function calculateRiskScore(
  factors: RiskScoreFactors,
  weights?: Partial<Record<keyof RiskScoreFactors, number>>
): RiskScoreResult {
  // Default weights based on importance
  const defaultWeights: Record<keyof RiskScoreFactors, number> = {
    claimToAssetRatio: 0.20,
    collectionProbability: 0.20,
    debtorFinancialHealth: 0.15,
    assetLiquidity: 0.10,
    lienPositionStrength: 0.10,
    jurisdictionFavorability: 0.08,
    documentationQuality: 0.07,
    marketConditions: 0.05,
    industryRisk: 0.03,
    economicConditions: 0.02,
  };

  const factorWeights = { ...defaultWeights, ...weights };

  // Calculate weighted score (invert so higher = better)
  let weightedSum = 0;
  const factorScores: Record<string, number> = {};

  for (const [key, weight] of Object.entries(factorWeights)) {
    const factorKey = key as keyof RiskScoreFactors;
    const value = factors[factorKey];
    
    // Invert certain factors so higher input = higher score
    let adjustedValue = value;
    if (key === "claimToAssetRatio") {
      // Lower ratio is better (0% ratio = 100 score, 200%+ ratio = 0 score)
      adjustedValue = Math.max(0, 100 - (value - 100) * 0.5);
    }
    
    factorScores[key] = adjustedValue;
    weightedSum += adjustedValue * weight;
  }

  const overallScore = Math.round(weightedSum);

  // Determine risk tier
  let riskTier: RiskScoreResult["riskTier"];
  if (overallScore >= 80) riskTier = "LOW";
  else if (overallScore >= 60) riskTier = "MODERATE";
  else if (overallScore >= 40) riskTier = "HIGH";
  else riskTier = "SPECULATIVE";

  // Calculate confidence based on data completeness
  const dataPointsProvided = Object.values(factors).filter(v => v > 0).length;
  const confidence = dataPointsProvided / Object.keys(factors).length;

  // Recovery probability (inverse of risk)
  const recoveryProbability = overallScore;

  // Expected loss calculation
  const expectedLoss = 100 - recoveryProbability;

  // Value at Risk (95% confidence) - simplified
  const volatility = (1 - confidence) * 30; // Higher uncertainty = higher VaR
  const valueAtRisk = Math.round(expectedLoss + 1.65 * volatility);

  return {
    overallScore,
    riskTier,
    confidence,
    factors,
    factorWeights,
    recoveryProbability,
    expectedLoss,
    valueAtRisk: Math.min(valueAtRisk, 100),
  };
}

// ===== MONTE CARLO SIMULATION =====

export function runMonteCarloSimulation(
  baseRecoveryRate: number,
  volatility: number = 0.2,
  simulations: number = 10000
): MonteCarloResult {
  const results: number[] = [];
  const faceValue = 100000; // Normalized face value

  for (let i = 0; i < simulations; i++) {
    // Box-Muller transform for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    // Apply volatility to base rate
    const recoveryRate = Math.max(0, Math.min(1.5, baseRecoveryRate / 100 + z * volatility));
    const recoveryAmount = faceValue * recoveryRate;
    
    results.push(recoveryRate * 100); // Store as percentage
  }

  results.sort((a, b) => a - b);

  // Calculate percentiles
  const getPercentile = (p: number) => {
    const idx = Math.floor(p * results.length);
    return results[Math.min(idx, results.length - 1)];
  };

  const meanRecovery = results.reduce((a, b) => a + b, 0) / results.length;
  const medianRecovery = getPercentile(0.5);
  const stdDev = Math.sqrt(
    results.reduce((sum, val) => sum + Math.pow(val - meanRecovery, 2), 0) / results.length
  );

  // Probability calculations
  const lossCount = results.filter(r => r < 50).length;
  const highRecoveryCount = results.filter(r => r > 80).length;

  return {
    simulations,
    meanRecovery: Math.round(meanRecovery * 100) / 100,
    medianRecovery: Math.round(medianRecovery * 100) / 100,
    stdDev: Math.round(stdDev * 100) / 100,
    percentile5: Math.round(getPercentile(0.05) * 100) / 100,
    percentile25: Math.round(getPercentile(0.25) * 100) / 100,
    percentile50: Math.round(getPercentile(0.50) * 100) / 100,
    percentile75: Math.round(getPercentile(0.75) * 100) / 100,
    percentile95: Math.round(getPercentile(0.95) * 100) / 100,
    probabilityOfLoss: Math.round((lossCount / simulations) * 10000) / 100,
    probabilityOfHighRecovery: Math.round((highRecoveryCount / simulations) * 10000) / 100,
  };
}

// ===== COMPREHENSIVE UNDERWRITING REPORT =====

export interface UnderwritingReport {
  caseId: number;
  caseTitle: string;
  bondId: number | null;
  bondName: string | null;
  
  // Executive summary
  overallRiskScore: number;
  riskTier: string;
  recommendation: "STRONG_BUY" | "BUY" | "HOLD" | "PASS" | "AVOID";
  keyConcerns: string[];
  keyStrengths: string[];
  
  // Financial analysis
  claimAmount: number;
  baseBondAmount: number | null;
  totalAssets: number;
  recoveryEstimate: number;
  recoveryAsPercentOfClaim: number;
  
  // Risk analysis
  riskFactors: RiskScoreResult;
  monteCarloAnalysis: MonteCarloResult | null;
  
  // Legal analysis
  lienStrength: string;
  jurisdictionRating: string;
  documentationStatus: string;
  
  // Recommendations
  suggestedBondAmount: number;
  suggestedMargin: number;
  suggestedPricing: {
    discountRate: number;
    targetIRR: number;
    purchasePrice: number;
  };
  
  // Generated at
  generatedAt: Date;
}

export async function generateUnderwritingReport(
  caseId: number
): Promise<UnderwritingReport | null> {
  // Fetch case data
  const [underwritingCase] = await db
    .select()
    .from(underwritingCases)
    .where(eq(underwritingCases.id, caseId));

  if (!underwritingCase) return null;

  const caseInput = underwritingCase.caseInput as Record<string, unknown>;
  const metrics = underwritingCase.metrics as Record<string, unknown>;

  // Fetch parties
  const parties = await db
    .select()
    .from(underwritingParties)
    .where(eq(underwritingParties.caseId, caseId));

  // Fetch related bond if exists
  let bondId: number | null = null;
  let bondName: string | null = null;
  
  // Calculate risk factors from case data
  const factors: RiskScoreFactors = {
    claimToAssetRatio: calculateClaimToAssetRatio(
      Number(caseInput.claimAmount) || 0,
      Number(caseInput.attachedAssetsValue) || 0
    ),
    collectionProbability: calculateCollectionProbability(parties),
    debtorFinancialHealth: 50, // Default - would need more data
    assetLiquidity: calculateAssetLiquidity(parties),
    lienPositionStrength: calculateLienStrength(caseInput),
    jurisdictionFavorability: 50, // Default
    documentationQuality: calculateDocumentationQuality(caseInput),
    marketConditions: 50, // Default
    industryRisk: 50, // Default
    economicConditions: 50, // Default
  };

  const riskScoreResult = calculateRiskScore(factors);
  riskScoreResult.monteCarloResults = runMonteCarloSimulation(
    riskScoreResult.recoveryProbability,
    0.25 - (riskScoreResult.confidence * 0.1), // Less confidence = more volatility
    5000
  );

  // Generate recommendations
  const suggestedBondAmount = Number(metrics.estimatedTotalRecovery) || 
    (Number(caseInput.claimAmount) || 0) * 0.5;
  
  const suggestedMargin = Math.max(0, 100 - riskScoreResult.overallScore);
  const suggestedPricing = calculateSuggestedPricing(
    Number(caseInput.claimAmount) || 0,
    riskScoreResult.recoveryProbability,
    suggestedMargin
  );

  // Determine recommendation
  const recommendation = determineRecommendation(riskScoreResult);

  // Extract key concerns and strengths
  const { keyConcerns, keyStrengths } = analyzeKeyFactors(factors, riskScoreResult);

  return {
    caseId,
    caseTitle: String(caseInput.title || "Untitled Case"),
    bondId,
    bondName,
    overallRiskScore: riskScoreResult.overallScore,
    riskTier: riskScoreResult.riskTier,
    recommendation,
    keyConcerns,
    keyStrengths,
    claimAmount: Number(caseInput.claimAmount) || 0,
    baseBondAmount: Number(caseInput.baseBondAmount) || null,
    totalAssets: Number(caseInput.attachedAssetsValue) || 0,
    recoveryEstimate: Number(metrics.estimatedTotalRecovery) || 0,
    recoveryAsPercentOfClaim: Number(metrics.collectionAsPctOfClaim) || 0,
    riskFactors: riskScoreResult,
    monteCarloAnalysis: riskScoreResult.monteCarloResults || null,
    lienStrength: factors.lienPositionStrength > 70 ? "STRONG" : 
                  factors.lienPositionStrength > 40 ? "MODERATE" : "WEAK",
    jurisdictionRating: factors.jurisdictionFavorability > 70 ? "FAVORABLE" :
                        factors.jurisdictionFavorability > 40 ? "NEUTRAL" : "CHALLENGING",
    documentationStatus: factors.documentationQuality > 70 ? "COMPLETE" :
                         factors.documentationQuality > 40 ? "PARTIAL" : "INCOMPLETE",
    suggestedBondAmount: Math.round(suggestedBondAmount),
    suggestedMargin,
    suggestedPricing,
    generatedAt: new Date(),
  };
}

// ===== HELPER FUNCTIONS =====

function calculateClaimToAssetRatio(claimAmount: number, assetsValue: number): number {
  if (claimAmount === 0) return 100;
  const ratio = (claimAmount / assetsValue) * 100;
  return Math.min(200, ratio);
}

function calculateCollectionProbability(parties: Array<{ partyData: unknown }>): number {
  let totalPct = 0;
  let count = 0;
  
  for (const party of parties) {
    const data = party.partyData as Record<string, unknown>;
    const pct = Number(data.expectedCollectionPct) || 50;
    totalPct += pct;
    count++;
  }
  
  if (count === 0) return 50;
  return totalPct / count;
}

function calculateAssetLiquidity(parties: Array<{ partyData: unknown }>): number {
  // Simplified - would need more detailed asset data
  return 50;
}

function calculateLienStrength(caseInput: Record<string, unknown>): number {
  // Based on qualitative factors
  const canPlaceRealEstate = caseInput.canPlaceRealEstateLien === true ? 30 : 0;
  const canPlaceBusiness = caseInput.canPlaceBusinessLien === true ? 20 : 0;
  const hasSecondFiling = caseInput.secondFilingDate ? 10 : 0;
  
  return Math.min(100, 40 + canPlaceRealEstate + canPlaceBusiness + hasSecondFiling);
}

function calculateDocumentationQuality(caseInput: Record<string, unknown>): number {
  let score = 50;
  
  if (caseInput.creditBankingSummary) score += 10;
  if (caseInput.addressesSummary) score += 5;
  if (caseInput.realEstateSummary) score += 10;
  if (caseInput.appraisalSummary) score += 10;
  if (caseInput.loansAndLiensSummary) score += 5;
  if (caseInput.countyFilingsSummary) score += 5;
  if (caseInput.secretaryOfStateSummary) score += 5;
  
  return Math.min(100, score);
}

function calculateSuggestedPricing(
  claimAmount: number,
  recoveryProbability: number,
  margin: number
): { discountRate: number; targetIRR: number; purchasePrice: number } {
  const baseRecovery = claimAmount * (recoveryProbability / 100);
  const discountRate = margin;
  const targetIRR = 15 + (100 - recoveryProbability) * 0.3; // Higher risk = higher target IRR
  const purchasePrice = baseRecovery * ((100 - margin) / 100);
  
  return {
    discountRate: Math.round(discountRate * 10) / 10,
    targetIRR: Math.round(targetIRR * 10) / 10,
    purchasePrice: Math.round(purchasePrice),
  };
}

function determineRecommendation(riskScore: RiskScoreResult): 
  "STRONG_BUY" | "BUY" | "HOLD" | "PASS" | "AVOID" {
  if (riskScore.overallScore >= 80 && riskScore.confidence >= 0.7) return "STRONG_BUY";
  if (riskScore.overallScore >= 65) return "BUY";
  if (riskScore.overallScore >= 50) return "HOLD";
  if (riskScore.overallScore >= 35) return "PASS";
  return "AVOID";
}

function analyzeKeyFactors(
  factors: RiskScoreFactors,
  riskScore: RiskScoreResult
): { keyConcerns: string[]; keyStrengths: string[] } {
  const concerns: string[] = [];
  const strengths: string[] = [];
  
  if (factors.claimToAssetRatio > 100) {
    concerns.push("Claim amount exceeds attached assets value");
  }
  if (factors.assetLiquidity < 40) {
    concerns.push("Assets primarily illiquid (real estate, equipment)");
  }
  if (factors.lienPositionStrength < 40) {
    concerns.push("Weak lien position or junior claims");
  }
  if (factors.documentationQuality < 50) {
    concerns.push("Incomplete documentation package");
  }
  
  if (factors.assetLiquidity > 70) {
    strengths.push("Assets include significant liquid holdings");
  }
  if (factors.lienPositionStrength > 70) {
    strengths.push("Strong first-position liens");
  }
  if (factors.documentationQuality > 80) {
    strengths.push("Complete documentation package");
  }
  if (riskScore.confidence > 0.8) {
    strengths.push("High confidence in risk assessment");
  }
  
  return { keyConcerns: concerns, keyStrengths: strengths };
}

// ===== PORTFOLIO UNDERWRITING VIEW =====

export async function getPortfolioUnderwritingSummary(): Promise<{
  totalCases: number;
  averageRiskScore: number;
  riskTierDistribution: Record<string, number>;
  recommendedBondAmount: number;
  totalPotentialRecovery: number;
  portfolioVaR95: number;
}> {
  const cases = await db
    .select()
    .from(underwritingCases);

  if (cases.length === 0) {
    return {
      totalCases: 0,
      averageRiskScore: 0,
      riskTierDistribution: {},
      recommendedBondAmount: 0,
      totalPotentialRecovery: 0,
      portfolioVaR95: 0,
    };
  }

  let totalScore = 0;
  const tierCounts: Record<string, number> = {};
  let totalRecovery = 0;

  for (const caseData of cases) {
    const metrics = caseData.metrics as Record<string, unknown>;
    const estimatedRecovery = Number(metrics.estimatedTotalRecovery) || 0;
    totalRecovery += estimatedRecovery;
    
    // Simplified scoring for portfolio view
    const collectionPct = Number(metrics.collectionAsPctOfClaim) || 0.5;
    const score = Math.round(collectionPct * 100);
    totalScore += score;
    
    let tier = "MODERATE";
    if (score >= 80) tier = "LOW";
    else if (score < 40) tier = "HIGH";
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
  }

  const avgScore = totalScore / cases.length;
  const avgRecovery = totalRecovery / cases.length;

  return {
    totalCases: cases.length,
    averageRiskScore: Math.round(avgScore),
    riskTierDistribution: tierCounts,
    recommendedBondAmount: Math.round(totalRecovery * 0.5),
    totalPotentialRecovery: Math.round(totalRecovery),
    portfolioVaR95: Math.round(totalRecovery * (1 - avgScore / 100) * 1.65),
  };
}
