import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { 
  bonds, 
  judgments, 
  bondDocuments, 
  bondProcessDocuments,
  suretyCases,
  suretyTrusts,
  users 
} from "@shared/schema";
import fs from "fs/promises";
import path from "path";
import archiver from "archiver";
import { createWriteStream } from "fs";

export interface DueDiligencePack {
  bondId: number;
  bondName: string;
  documents: DueDiligenceDocument[];
  metadata: DueDiligenceMetadata;
  generatedAt: Date;
}

export interface DueDiligenceDocument {
  name: string;
  type: string;
  path: string;
  size: number;
  summary?: string;
}

export interface DueDiligenceMetadata {
  bondId: number;
  bondName: string;
  faceValue: number;
  status: string;
  createdAt: string;
  documentCount: number;
  totalSize: number;
}

// Document generation service
export async function generateDueDiligencePack(bondId: number): Promise<DueDiligencePack | null> {
  const [bond] = await db
    .select()
    .from(bonds)
    .where(eq(bonds.id, bondId));

  if (!bond) return null;

  // Get supporting documents
  const docs = await db
    .select()
    .from(bondDocuments)
    .where(eq(bondDocuments.bondId, bondId));

  const documentList: DueDiligenceDocument[] = docs.map(d => ({
    name: d.filename,
    type: d.kind,
    path: d.storagePath,
    size: d.sizeBytes,
    summary: d.aiSummary || undefined,
  }));

  // Get process documents
  const processDocs = await db
    .select()
    .from(bondProcessDocuments)
    .where(eq(bondProcessDocuments.bondId, bondId));

  for (const pd of processDocs) {
    documentList.push({
      name: pd.filename,
      type: pd.docType,
      path: pd.storagePath,
      size: 0, // Would need to check file size
      summary: undefined,
    });
  }

  const totalSize = documentList.reduce((sum, d) => sum + d.size, 0);

  return {
    bondId,
    bondName: bond.name,
    documents: documentList,
    metadata: {
      bondId,
      bondName: bond.name,
      faceValue: parseFloat(bond.faceValue || "0"),
      status: bond.status,
      createdAt: new Date().toISOString(),
      documentCount: documentList.length,
      totalSize,
    },
    generatedAt: new Date(),
  };
}

// Create ZIP file of due diligence pack
export async function createDueDiligenceZip(bondId: number): Promise<string | null> {
  const pack = await generateDueDiligencePack(bondId);
  if (!pack) return null;

  const zipPath = `/tmp/due_diligence_${bondId}_${Date.now()}.zip`;
  
  const archive = archiver("zip", { zlib: { level: 9 } });
  const output = createWriteStream(zipPath);

  return new Promise((resolve, reject) => {
    output.on("close", () => resolve(zipPath));
    archive.on("error", reject);

    archive.pipe(output);

    // Add metadata JSON
    archive.append(JSON.stringify(pack.metadata, null, 2), { name: "metadata.json" });

    // Add each document
    for (const doc of pack.documents) {
      if (doc.path) {
        archive.file(doc.path, { name: doc.name });
      }
    }

    archive.finalize();
  });
}

// Email service using SMTP (could use SendGrid, Mailgun, etc.)
export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  path?: string;
  content?: Buffer;
  contentType?: string;
}

// In-memory email queue (replace with DB-backed queue in production)
const emailQueue: Array<{
  id: string;
  message: EmailMessage;
  status: "PENDING" | "SENT" | "FAILED";
  attempts: number;
  lastAttempt: Date | null;
  error?: string;
  createdAt: Date;
}> = [];

let emailQueueCounter = 1;

// Mock email sending (replace with actual SMTP/SendGrid in production)
export async function sendEmail(message: EmailMessage): Promise<{ success: boolean; messageId: string }> {
  // In production, this would use nodemailer, SendGrid, or similar
  console.log(`[EMAIL] Sending to: ${Array.isArray(message.to) ? message.to.join(", ") : message.to}`);
  console.log(`[EMAIL] Subject: ${message.subject}`);
  
  const messageId = `msg_${emailQueueCounter++}`;
  
  // Add to queue for "sending"
  emailQueue.push({
    id: messageId,
    message,
    status: "SENT",
    attempts: 1,
    lastAttempt: new Date(),
    createdAt: new Date(),
  });

  return { success: true, messageId };
}

// Queue email for later sending
export function queueEmail(message: EmailMessage): string {
  const id = `queued_${emailQueueCounter++}`;
  
  emailQueue.push({
    id,
    message,
    status: "PENDING",
    attempts: 0,
    lastAttempt: null,
    createdAt: new Date(),
  });

  return id;
}

// Get queued emails
export function getEmailQueue(): typeof emailQueue {
  return [...emailQueue];
}

// Process queued emails (would be run by a cron job or worker)
export async function processEmailQueue(): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  for (const item of emailQueue) {
    if (item.status !== "PENDING") continue;
    if (item.attempts >= 3) {
      item.status = "FAILED";
      item.error = "Max attempts reached";
      failed++;
      continue;
    }

    try {
      const result = await sendEmail(item.message);
      item.status = result.success ? "SENT" : "FAILED";
      item.lastAttempt = new Date();
      processed++;
    } catch (error: any) {
      item.status = "FAILED";
      item.error = error.message;
      item.attempts++;
    }
  }

  return { processed, failed };
}

// ===== DOCUMENT TEMPLATES =====

export function generateBondPurchaseAgreement(data: {
  bondName: string;
  faceValue: number;
  investorName: string;
  investorEmail: string;
  purchasePrice: number;
  purchaseDate: Date;
}): string {
  return `
BOND PURCHASE AGREEMENT

This Bond Purchase Agreement ("Agreement") is entered into as of ${data.purchaseDate.toLocaleDateString()}.

PARTIES:
- Issuer: BondAI Platform
- Purchaser: ${data.investorName} (${data.investorEmail})

BOND DETAILS:
- Bond Name: ${data.bondName}
- Face Value: $${data.faceValue.toLocaleString()}
- Purchase Price: $${data.purchasePrice.toLocaleString()}

TERMS AND CONDITIONS:
1. The Purchaser agrees to purchase the above-referenced bond at the purchase price.
2. The bond represents a secured interest in the underlying judgment assets.
3. This purchase is subject to the terms and conditions of the BondAI Platform.

SIGNATURES:
_______________________    Date: _______________
${data.investorName} (Purchaser)

_______________________    Date: _______________
BondAI Platform (Issuer)
  `.trim();
}

export function generateDistributionNotice(data: {
  investorName: string;
  investorEmail: string;
  bondName: string;
  distributionAmount: number;
  distributionDate: Date;
  description: string;
}): string {
  return `
DISTRIBUTION NOTICE

Dear ${data.investorName},

We are pleased to inform you of a distribution for your bond investment.

INVESTMENT: ${data.bondName}
DISTRIBUTION AMOUNT: $${data.distributionAmount.toLocaleString()}
DISTRIBUTION DATE: ${data.distributionDate.toLocaleDateString()}

DESCRIPTION: ${data.description}

This distribution represents your share of receipts collected on the underlying bond assets.

If you have any questions, please contact support@bondai.app.

Thank you for your investment.

Best regards,
BondAI Platform
  `.trim();
}

export function generateTradeConfirmation(data: {
  investorName: string;
  investorEmail: string;
  bondName: string;
  tradeAmount: number;
  tradeDate: Date;
  tradeType: "BUY" | "SELL";
}): string {
  return `
TRADE CONFIRMATION

Dear ${data.investorName},

Your ${data.tradeType} order has been executed.

TRADE DETAILS:
- Type: ${data.tradeType}
- Bond: ${data.bondName}
- Amount: $${data.tradeAmount.toLocaleString()}
- Date: ${data.tradeDate.toLocaleDateString()}
- Reference: TC-${Date.now()}

This confirmation serves as your receipt for the transaction.

BondAI Platform
  `.trim();
}

// ===== EMAIL TEMPLATES =====

export function sendDueDiligencePack(
  investorEmail: string,
  investorName: string,
  bondName: string,
  zipPath: string
): EmailMessage {
  return {
    to: investorEmail,
    subject: `Due Diligence Package: ${bondName}`,
    html: `
      <h2>Due Diligence Package Ready</h2>
      <p>Dear ${investorName},</p>
      <p>Your due diligence package for <strong>${bondName}</strong> is ready for download.</p>
      <p>Please find the attached ZIP file containing all relevant documents and evidence.</p>
      <p>This package is for informational purposes only and does not constitute investment advice.</p>
      <p>Best regards,<br>BondAI Platform</p>
    `,
    attachments: [
      {
        filename: `due_diligence_${bondName.replace(/\s+/g, "_")}.zip`,
        path: zipPath,
        contentType: "application/zip",
      },
    ],
  };
}

export function sendDistributionNotification(
  email: string,
  name: string,
  bondName: string,
  amount: number,
  date: Date
): EmailMessage {
  return {
    to: email,
    subject: `Distribution Received: ${bondName}`,
    html: `
      <h2>Distribution Received</h2>
      <p>Dear ${name},</p>
      <p>You have received a distribution for your investment in <strong>${bondName}</strong>.</p>
      <p><strong>Amount:</strong> $${amount.toLocaleString()}<br>
      <strong>Date:</strong> ${date.toLocaleDateString()}</p>
      <p>The distribution will be processed according to the bond terms.</p>
      <p>Best regards,<br>BondAI Platform</p>
    `,
  };
}

export function sendTradeConfirmationEmail(
  email: string,
  name: string,
  bondName: string,
  amount: number,
  date: Date,
  type: "BUY" | "SELL"
): EmailMessage {
  return {
    to: email,
    subject: `Trade Confirmed: ${type} ${bondName}`,
    html: `
      <h2>Trade Confirmation</h2>
      <p>Dear ${name},</p>
      <p>Your ${type} order has been executed:</p>
      <ul>
        <li><strong>Bond:</strong> ${bondName}</li>
        <li><strong>Amount:</strong> $${amount.toLocaleString()}</li>
        <li><strong>Date:</strong> ${date.toLocaleDateString()}</li>
        <li><strong>Type:</strong> ${type}</li>
      </ul>
      <p>Best regards,<br>BondAI Platform</p>
    `,
  };
}

// ===== BOND DOCUMENT GENERATION =====

export interface BondDocumentData {
  bondId: number;
  bondName: string;
  faceValue: number;
  ownerName: string;
  ownerEmail: string;
  issuanceDate: Date;
  maturityDate?: Date;
  couponRate?: number;
  jurisdiction: string;
}

export async function generateBondInstrument(data: BondDocumentData): Promise<string> {
  // In production, this would use a PDF generation library like PDFKit or Puppeteer
  return `
BOND INSTRUMENT

Bond ID: ${data.bondId}
Bond Name: ${data.bondName}

ISSUER: BondAI Platform
OWNER: ${data.ownerName} (${data.ownerEmail})

FACE VALUE: $${data.faceValue.toLocaleString()}
ISSUANCE DATE: ${data.issuanceDate.toLocaleDateString()}
${data.maturityDate ? `MATURITY DATE: ${data.maturityDate.toLocaleDateString()}` : ""}
${data.couponRate ? `COUPON RATE: ${data.couponRate}%` : ""}
JURISDICTION: ${data.jurisdiction}

This bond represents a secured interest in the underlying judgment assets as described in the Due Diligence Package.

ISSUED BY: BondAI Platform
DATE: ${new Date().toLocaleDateString()}
  `.trim();
}
