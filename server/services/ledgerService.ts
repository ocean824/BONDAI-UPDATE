import crypto from "crypto";

// Chart of accounts codes
export const ACCOUNT_CODES = {
  // Asset accounts
  CASH_STRIPE: "1200", // Cash/Stripe clearing account
  CASH_HOLDING: "1210", // Cash holding account for distributions
  
  // Liability accounts
  INVESTOR_PAYABLE: "2100", // Amounts owed to investors
  ISSUER_PAYABLE: "2200", // Amounts owed to bond issuers
  PLATFORM_FEES: "2300", // Platform fee payable
  
  // Equity/Reserve accounts
  RECOUPMENT_RESERVE: "3100", // Recoupment reserve for surety
  DISTRIBUTABLE_EARNINGS: "3200", // Earnings available for distribution
  
  // Revenue accounts
  BOND_SALES_REVENUE: "4100", // Revenue from bond sales
  INTEREST_INCOME: "4200", // Interest income from bonds
  
  // Expense accounts
  PLATFORM_FEES_EXPENSE: "5100", // Platform operating expenses
  SURETY_CLAIMS: "5200", // Surety claims paid out
};

// Account names for display
export const ACCOUNT_NAMES: Record<string, string> = {
  "1200": "Cash - Stripe Clearing",
  "1210": "Cash - Holding Account",
  "2100": "Investor Payable",
  "2200": "Issuer Payable",
  "2300": "Platform Fees Payable",
  "3100": "Recoupment Reserve",
  "3200": "Distributable Earnings",
  "4100": "Bond Sales Revenue",
  "4200": "Interest Income",
  "5100": "Platform Expenses",
  "5200": "Surety Claims",
};

export interface JournalEntryLine {
  accountCode: string;
  debit: number;
  credit: number;
  description: string;
}

export interface JournalEntryData {
  type: string;
  description: string;
  currency: string;
  lines: JournalEntryLine[];
  metadata?: Record<string, unknown>;
}

interface JournalRecord extends JournalEntryData {
  id: number;
  journalHash: string;
  previousHash: string;
  timestamp: Date;
  isBalanced: boolean;
}

interface PostingRecord {
  id: number;
  journalId: number;
  accountCode: string;
  debit: number;
  credit: number;
  balance: number;
}

// In-memory storage (replace with DB tables in production)
const journals: JournalRecord[] = [];
const postings: Map<string, number> = new Map(); // accountCode -> balance
let journalIdCounter = 1;
let lastJournalHash = "GENESIS";

export async function postJournalEntry(data: JournalEntryData): Promise<number> {
  // Validate that debits equal credits
  const totalDebits = data.lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredits = data.lines.reduce((sum, line) => sum + line.credit, 0);

  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new Error(
      `Unbalanced journal entry: debits (${totalDebits}) != credits (${totalCredits})`
    );
  }

  // Create journal record with hash chain
  const timestamp = new Date();
  const journalContent = JSON.stringify({
    type: data.type,
    description: data.description,
    lines: data.lines,
    timestamp: timestamp.toISOString(),
    previousHash: lastJournalHash,
  });

  const journalHash = crypto
    .createHash("sha256")
    .update(journalContent)
    .digest("hex");

  const journal: JournalRecord = {
    id: journalIdCounter++,
    ...data,
    journalHash,
    previousHash: lastJournalHash,
    timestamp,
    isBalanced: Math.abs(totalDebits - totalCredits) < 0.01,
  };

  journals.push(journal);
  lastJournalHash = journalHash;

  // Create postings and update balances
  for (const line of data.lines) {
    const postingId = `${journal.id}-${line.accountCode}`;
    
    postings.set(
      line.accountCode,
      (postings.get(line.accountCode) || 0) + line.debit - line.credit
    );
  }

  console.log(`[Ledger] Journal #${journal.id} posted - ${data.type}`);

  return journal.id;
}

export async function getJournalById(journalId: number): Promise<JournalRecord | null> {
  return journals.find((j) => j.id === journalId) || null;
}

export async function getJournalEntries(
  filters?: { type?: string; startDate?: Date; endDate?: Date }
): Promise<JournalRecord[]> {
  let result = [...journals];

  if (filters?.type) {
    result = result.filter((j) => j.type === filters.type);
  }

  if (filters?.startDate) {
    result = result.filter((j) => j.timestamp >= filters.startDate!);
  }

  if (filters?.endDate) {
    result = result.filter((j) => j.timestamp <= filters.endDate!);
  }

  return result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

export async function getAccountBalance(accountCode: string): Promise<number> {
  return postings.get(accountCode) || 0;
}

export async function getTrialBalance(): Promise<
  { accountCode: string; accountName: string; debit: number; credit: number; balance: number }[]
> {
  const result: {
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    balance: number;
  }[] = [];

  for (const [accountCode, balance] of Array.from(postings.entries())) {
    const lines = journals.flatMap((j) =>
      j.lines.filter((l) => l.accountCode === accountCode)
    );

    const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);

    result.push({
      accountCode,
      accountName: ACCOUNT_NAMES[accountCode] || `Account ${accountCode}`,
      debit: totalDebit,
      credit: totalCredit,
      balance,
    });
  }

  return result.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

export async function verifyLedgerIntegrity(): Promise<{
  valid: boolean;
  issues: string[];
}> {
  const issues: string[] = [];

  // Check all journals are balanced
  for (const journal of journals) {
    const totalDebits = journal.lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredits = journal.lines.reduce((sum, l) => sum + l.credit, 0);

    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      issues.push(`Journal #${journal.id} is unbalanced`);
    }
  }

  // Verify hash chain
  for (let i = 1; i < journals.length; i++) {
    const current = journals[i];
    const previous = journals[i - 1];

    const journalContent = JSON.stringify({
      type: current.type,
      description: current.description,
      lines: current.lines,
      timestamp: current.timestamp.toISOString(),
      previousHash: previous.journalHash,
    });

    const expectedHash = crypto
      .createHash("sha256")
      .update(journalContent)
      .digest("hex");

    if (current.journalHash !== expectedHash || current.previousHash !== previous.journalHash) {
      issues.push(`Journal #${current.id} hash chain is broken`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
