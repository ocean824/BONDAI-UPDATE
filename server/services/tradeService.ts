import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { auctions, auctionBids, bonds, users } from "@shared/schema";
import { createImmutableEvent, type ImmutableEventType } from "./immutableEventService";
import { postJournalEntry, type JournalEntryLine } from "./ledgerService";

export interface TradeData {
  auctionId: number;
  bondId: number;
  investorId: number;
  amount: string; // Purchase price in dollars
  faceValue: string; // Bond face value
  bondName: string;
  investorEmail: string;
  investorName: string;
}

export interface TradeRecord {
  id: number;
  auctionId: number;
  bondId: number;
  investorId: number;
  amount: string;
  status: "PENDING" | "PAID" | "SETTLED" | "FAILED" | "CANCELLED";
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  settlementId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// In-memory trade storage (replace with DB table in production)
const trades = new Map<number, TradeRecord>();
let tradeIdCounter = 1;

export async function createTradeFromAuction(auctionId: number): Promise<TradeRecord | null> {
  // Get auction with bond and bid details
  const [auction] = await db
    .select({
      id: auctions.id,
      bondId: auctions.bondId,
      reservePrice: auctions.reservePrice,
      winningBidId: auctions.winningBidId,
    })
    .from(auctions)
    .where(eq(auctions.id, auctionId));

  if (!auction || !auction.winningBidId) {
    return null;
  }

  const [winningBid] = await db
    .select({
      id: auctionBids.id,
      auctionId: auctionBids.auctionId,
      investorId: auctionBids.investorId,
      amount: auctionBids.amount,
    })
    .from(auctionBids)
    .where(eq(auctionBids.id, auction.winningBidId));

  if (!winningBid) {
    return null;
  }

  const [bond] = await db
    .select({
      id: bonds.id,
      name: bonds.name,
      faceValue: bonds.faceValue,
    })
    .from(bonds)
    .where(eq(bonds.id, auction.bondId));

  if (!bond) {
    return null;
  }

  const [investor] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, winningBid.investorId));

  if (!investor) {
    return null;
  }

  // Create trade record
  const trade: TradeRecord = {
    id: tradeIdCounter++,
    auctionId: auction.id,
    bondId: bond.id,
    investorId: investor.id,
    amount: winningBid.amount,
    status: "PENDING",
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    settlementId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  trades.set(trade.id, trade);

  // Create immutable event for trade creation
  await createImmutableEvent({
    type: "TRADE_CREATED" as ImmutableEventType,
    actorId: investor.id,
    actorType: "USER",
    entityType: "TRADE",
    entityId: trade.id,
    payload: {
      tradeId: trade.id,
      auctionId: auction.id,
      bondId: bond.id,
      bondName: bond.name,
      amount: winningBid.amount,
      investorId: investor.id,
      investorEmail: investor.email,
    },
    correlationId: `trade-${trade.id}`,
  });

  return trade;
}

export async function getTradeById(tradeId: number): Promise<TradeRecord | null> {
  return trades.get(tradeId) || null;
}

export async function getTradesByInvestor(investorId: number): Promise<TradeRecord[]> {
  const result: TradeRecord[] = [];
  for (const trade of Array.from(trades.values())) {
    if (trade.investorId === investorId) {
      result.push(trade);
    }
  }
  return result;
}

export async function updateTradeStatus(
  tradeId: number,
  status: TradeRecord["status"],
  metadata?: { checkoutSessionId?: string; paymentIntentId?: string }
): Promise<TradeRecord | null> {
  const trade = trades.get(tradeId);
  if (!trade) return null;

  trade.status = status;
  trade.updatedAt = new Date();
  
  if (metadata?.checkoutSessionId) {
    trade.stripeCheckoutSessionId = metadata.checkoutSessionId;
  }
  if (metadata?.paymentIntentId) {
    trade.stripePaymentIntentId = metadata.paymentIntentId;
  }

  return trade;
}

export async function createSettlement(
  tradeId: number,
  investorEmail: string,
  investorName: string,
  bondName: string
): Promise<{ settlementId: string; journalId: number } | null> {
  const trade = trades.get(tradeId);
  if (!trade || trade.status !== "PAID") return null;

  const settlementId = `settle-${Date.now()}-${tradeId}`;
  
  // Create settlement record (simplified - use DB table in production)
  trade.settlementId = settlementId;
  trade.status = "SETTLED";
  trade.updatedAt = new Date();

  // Create immutable event for settlement
  await createImmutableEvent({
    type: "TRADE_SETTLED" as ImmutableEventType,
    actorId: trade.investorId,
    actorType: "USER",
    entityType: "SETTLEMENT",
    entityId: settlementId,
    payload: {
      settlementId,
      tradeId,
      bondId: trade.bondId,
      amount: trade.amount,
      investorEmail,
      bondName,
    },
    correlationId: `settlement-${settlementId}`,
  });

  // Create ledger journal entry for settlement
  const journalId = await postJournalEntry({
    type: "TRADE_SETTLEMENT",
    description: `Settlement for bond purchase: ${bondName}`,
    currency: "USD",
    lines: [
      {
        accountCode: "1200", // Cash/Stripe Clearing
        debit: parseFloat(trade.amount),
        credit: 0,
        description: "Cash received from investor",
      },
      {
        accountCode: "2100", // Investor Payable
        debit: 0,
        credit: parseFloat(trade.amount),
        description: "Investor payable for bond purchase",
      },
    ],
    metadata: {
      tradeId,
      settlementId,
      investorEmail,
    },
  });

  return { settlementId, journalId };
}
