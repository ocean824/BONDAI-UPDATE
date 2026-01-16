# BondAI Platform - Complete Documentation

**Version:** 2.0.0  
**Last Updated:** January 15, 2026  
**Repository:** [ocean824/BONDAI-UPDATE](https://github.com/ocean824/BONDAI-UPDATE)

---

## Table of Contents

1. [Executive Overview](#executive-overview)
2. [System Architecture](#system-architecture)
3. [User Roles & Access Control](#user-roles--access-control)
4. [Features & Functionality](#features--functionality)
5. [API Reference](#api-reference)
6. [Database Schema](#database-schema)
7. [Security & Compliance](#security--compliance)
8. [Installation & Deployment](#installation--deployment)
9. [Testing](#testing)
10. [Troubleshooting](#troubleshooting)

---

## Executive Overview

BondAI is a comprehensive judgment debt underwriting and bond trading platform that enables:

- **Judgment Processing**: AI-powered extraction and analysis of court judgment documents
- **Bond Creation**: Transform judgments into tradable bond instruments
- **Underwriting Engine**: Risk scoring and Monte Carlo simulation for bond evaluation
- **Surety System**: Bond surety management with trust tracking and collateral management
- **Bond Exchange**: Auction-based marketplace for bond trading
- **Distribution Engine**: Dividend and interest payment distribution to investors
- **Immutable Audit**: Hash-chained event logging for regulatory compliance

### Core Value Proposition

1. **AI-Powered Analysis**: OpenAI GPT-4 for extraction and analysis
2. **Regulatory Compliance**: Immutable audit trail and double-entry ledger
3. **End-to-End Workflow**: Judgment → Bond → Underwriting → Surety → Exchange → Distribution
4. **Investor Portal**: Self-service auction participation and portfolio management

---

## System Architecture

### Technology Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React + Vite)                   │
├─────────────────────────────────────────────────────────────────┤
│  - TypeScript + React                                            │
│  - Tailwind CSS + Radix UI                                       │
│  - TanStack Query (React Query)                                  │
│  - wouter for routing                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend (Node.js + Express)                  │
├─────────────────────────────────────────────────────────────────┤
│  - TypeScript 5.x                                                │
│  - Drizzle ORM                                                   │
│  - PostgreSQL (Neon Serverless)                                  │
│  - OpenAI API                                                    │
│  - Stripe Payments                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Database (PostgreSQL)                       │
├─────────────────────────────────────────────────────────────────┤
│  - 22 tables with full relations                                 │
│  - Migrations via Drizzle Kit                                    │
│  - Real-time transaction support                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Service Architecture

```
server/
├── index.ts              # Express server entry point
├── routes.ts             # Main API routes (2200+ lines)
├── routes/
│   └── exchange.ts       # Exchange/trading routes
├── services/
│   ├── aiExtractionService.ts         # AI judgment extraction
│   ├── bondAiService.ts               # AI bond drafting
│   ├── tradeService.ts                # Trade execution
│   ├── ledgerService.ts               # Double-entry accounting
│   ├── immutableEventService.ts       # Hash-chained audit
│   ├── assignmentService.ts           # Bond ownership
│   ├── distributionService.ts         # Dividend distribution
│   ├── underwritingEnhancedService.ts # Risk scoring
│   ├── suretyEnhancedService.ts       # Surety management
│   ├── documentEmailService.ts        # Document generation
│   ├── suretyUnderwritingService.ts   # Surety underwriting
│   ├── bondPerfectionService.ts       # Bond perfection
│   └── ...
├── middleware/
│   ├── auth.ts              # JWT authentication
│   └── security.ts          # Rate limiting, CORS
├── webhookHandlers.ts       # Stripe webhooks
└── storage.ts               # Database operations
```

---

## User Roles & Access Control

### Role Matrix

| Feature | Analyst | Investor | Admin |
|---------|---------|----------|-------|
| Upload Judgments | ✅ | ❌ | ✅ |
| Create Bundles | ✅ | ❌ | ✅ |
| Create Bonds | ✅ | ❌ | ✅ |
| Underwrite Bonds | ✅ | ❌ | ✅ |
| Surety Operations | ❌ | ❌ | ✅ (PIN required) |
| View Exchange | ❌ | ✅ | ✅ |
| Place Bids | ❌ | ✅ | ✅ |
| Generate Documents | ❌ | ❌ | ✅ |
| View Audit Logs | ❌ | ❌ | ✅ |
| User Management | ❌ | ❌ | ✅ |

### Authentication Flow

```
1. User logs in via /api/auth/login
2. JWT token issued with role claims
3. Token stored in localStorage
4. Subsequent requests include Bearer token
5. Role-based middleware enforces access
```

---

## Features & Functionality

### 1. Judgment Management

**Workflow:**
```
Upload PDF/Word → AI Extraction → Manual Review → Pricing Analysis → Bond Creation
```

**API Endpoints:**
- `POST /api/judgments` - Create judgment
- `POST /api/judgments/:id/extract` - AI extract from document
- `POST /api/judgments/:id/price` - Calculate pricing scenarios
- `GET /api/judgments/:id/price-estimates` - View price estimates

**Features:**
- PDF and DOCX document upload (25MB limit)
- AI extraction with confidence scores
- Multi-scenario pricing (base, optimistic, stressed)
- Recovery score prediction

### 2. Bond Management

**Bond Lifecycle:**
```
Judgment → Bond Creation → Perfection → Underwriting → Surety → Exchange Listing → Trading
```

**API Endpoints:**
- `POST /api/bonds` - Create bond
- `GET /api/bonds` - List bonds
- `PATCH /api/bonds/:id/score` - Update AI risk score
- `POST /api/bonds/:id/draft` - Generate AI bond document
- `POST /api/bonds/:id/perfect` - Perfect bond for exchange

**Features:**
- CUSIP/ISIN generation
- AI-powered risk scoring (0-100)
- Risk tier classification (low/moderate/high)
- Bond document generation

### 3. Underwriting Engine

**Risk Assessment:**
```
Bond Data → Factor Analysis → Monte Carlo Simulation → Risk Score → Recommendation
```

**API Endpoints:**
- `POST /api/underwriting/cases` - Create underwriting case
- `GET /api/underwriting/cases` - List cases
- `POST /api/underwriting/cases/:id/risk-score` - Calculate risk score
- `POST /api/underwriting/cases/:id/report` - Generate underwriting report

**Monte Carlo Simulation:**
- 10,000 iterations per analysis
- Probability distribution for recovery rates
- Confidence intervals (90%, 95%, 99%)
- Stress testing scenarios

### 4. Surety System

**Surety Workflow:**
```
Trust Setup → Case Creation → Underwriting → Approval → Collateral → Activation → Release
```

**API Endpoints:**
- `GET /api/admin/surety/trusts` - List surety trusts
- `POST /api/admin/surety/trusts` - Create trust
- `POST /api/admin/surety/underwrite` - Run surety underwriting
- `POST /api/admin/surety/cases/:id/approve` - Approve case
- `POST /api/admin/surety/cases/:id/collateral` - Record collateral
- `POST /api/admin/surety/cases/:id/activate` - Activate surety
- `GET /api/admin/surety/trusts/:id/exposure` - Trust exposure report

**PIN Protection:**
- All surety operations require `X-Surety-PIN` header
- Configured via `SURETY_ADMIN_PIN` environment variable

### 5. Bond Exchange

**Auction Flow:**
```
Bond Perfected → Auction Created → Bids Placed → Reserve Met → Trade Created → Settlement
```

**Investor API Endpoints:**
- `GET /api/investor/auctions` - List active auctions
- `POST /api/investor/auctions/:id/bids` - Place bid
- `GET /api/investor/my-bids` - View my bids
- `GET /api/investor/holdings` - View bond holdings
- `GET /api/bonds/:id/cap-table` - View ownership cap table

**Admin API Endpoints:**
- `POST /api/admin/bonds/:id/perfect` - Create auction
- `POST /api/investor/trades/:id/checkout` - Stripe checkout
- `POST /api/investor/trades/:id/settle` - Manual settlement

### 6. Distribution Engine

**Dividend Distribution:**
```
Receipt Recorded → Distribution Created → 1/3 Recoupment → Payout Calculation → Execution
```

**API Endpoints:**
- `POST /api/admin/bonds/:id/receipt` - Record receipt
- `POST /api/bonds/:id/distributions` - Create distribution
- `POST /api/admin/distributions/:id/execute` - Execute payout
- `GET /api/bonds/:id/distributions` - View distribution history

### 7. Document Engine

**Generated Documents:**
- Bond Term Sheet
- Bond Instrument
- Perfection Certificate
- General Indemnity Agreement (GIA)
- Surety Trust Resolution
- Underwriting Report
- Exchange Offering Sheet
- Investor Subscription Agreement
- Trade Confirmation

**API Endpoints:**
- `GET /api/admin/docs/steps` - Available document steps
- `POST /api/admin/bonds/:bondId/generate-docs` - Generate documents
- `GET /api/bonds/:id/due-diligence` - Due diligence metadata
- `POST /api/bonds/:id/due-diligence/zip` - Generate ZIP package
- `POST /api/admin/email/send` - Send email

### 8. Ledger & Audit

**Double-Entry Accounting:**
```
Trade → Journal Entry → Posting → Account Balance Update
```

**API Endpoints:**
- `GET /api/admin/ledger/accounts` - Chart of accounts
- `POST /api/admin/ledger/accounts` - Create account
- `GET /api/admin/ledger/trial-balance` - Trial balance report

**Immutable Audit:**
- Hash-chained event logging (SHA-256)
- Chain verification API
- Full audit trail

**API Endpoints:**
- `GET /api/admin/audit/events` - All audit events
- `GET /api/admin/audit/verify-chain` - Verify chain integrity
- `GET /api/admin/audit/entity/:type/:id` - Entity events

---

## API Reference

### Authentication

```typescript
// Login
POST /api/auth/login
Body: { email: string, password: string }
Response: { user: User, token: string }

// Register
POST /api/auth/register
Body: { email: string, password: string, name: string, role: "analyst" | "investor" }
Response: { user: User, token: string }

// Get current user
GET /api/auth/me
Headers: Authorization: Bearer <token>
Response: { user: User }
```

### Judgments

```typescript
// List judgments
GET /api/judgments
Response: Judgment[]

// Create judgment
POST /api/judgments
Body: { debtorName: string, caseNumber: string, judgmentAmount: string, notes?: string }
Response: Judgment

// AI extract from document
POST /api/judgments/:id/extract
Body: { rawText: string }
Response: JudgmentExtractionResult

// Calculate pricing
POST /api/judgments/:id/price
Body: { targetIRR: number, discountRate: number, expectedRecoveryPct: number }
Response: { scenarios: PricingScenario[] }
```

### Bonds

```typescript
// List bonds
GET /api/bonds
Response: Bond[]

// Create bond
POST /api/bonds
Body: { name: string, faceValue: number, jurisdiction?: string, ... }
Response: Bond

// Update risk score
PATCH /api/bonds/:id/score
Body: { bondScore: number, riskTier: "low" | "moderate" | "high" }
Response: Bond

// Perfect bond for exchange
POST /api/admin/bonds/:id/perfect
Body: { reservePrice: number, auctionDurationDays?: number }
Response: { auction: Auction, message: string }
```

### Underwriting

```typescript
// List cases
GET /api/underwriting/cases
Response: UnderwritingCase[]

// Create case
POST /api/underwriting/cases
Body: { caseInput: Record, parties: Record[] }
Response: UnderwritingCase

// Calculate risk score
POST /api/underwriting/cases/:id/risk-score
Body: { iterations?: number }
Response: RiskScoreResult

// Generate report
POST /api/underwriting/cases/:id/report
Response: UnderwritingReport
```

### Surety

```typescript
// List trusts
GET /api/admin/surety/trusts
Headers: X-Surety-PIN: <pin>
Response: { trusts: SuretyTrust[] }

// Create trust
POST /api/admin/surety/trusts
Headers: X-Surety-PIN: <pin>
Body: { name: string, maxSingleBondLimit: number, aggregateBondLimit: number }
Response: { trust: SuretyTrust }

// Run underwriting
POST /api/admin/surety/underwrite
Headers: X-Surety-PIN: <pin>
Body: { bondId: number, suretyTrustId: number, bondPenalSum: number, principalRiskScore: number }
Response: { underwritingResult, case: SuretyCase }

// Get exposure report
GET /api/admin/surety/trusts/:id/exposure
Headers: X-Surety-PIN: <pin>
Response: SuretyExposureReport
```

### Exchange

```typescript
// List auctions
GET /api/investor/auctions
Response: { auctions: Auction[] }

// Place bid
POST /api/investor/auctions/:id/bids
Body: { amount: number }
Response: { bid: AuctionBid, message: string }

// View holdings
GET /api/investor/holdings
Response: { holdings: BondAssignment[] }

// Create trade
POST /api/investor/trades/:id/checkout
Response: { url: string } // Stripe checkout URL
```

### Distributions

```typescript
// Record receipt
POST /api/admin/bonds/:id/receipt
Body: { amount: number, receivedAt: string, notes?: string }
Response: { receipt: BondReceipt }

// Create distribution
POST /api/bonds/:id/distributions
Body: { recordDate: string, exDate: string, paymentDate: string, totalAmount: string, perUnitAmount: string }
Response: { distribution: Distribution }

// Execute payout
POST /api/admin/distributions/:id/execute
Response: { message: string, payments: number, totalAmount: number }
```

### Ledger

```typescript
// Get trial balance
GET /api/admin/ledger/trial-balance
Response: {
  balances: { accountCode, accountName, accountType, balance, balanceType }[],
  totalDebits: number,
  totalCredits: number,
  isBalanced: boolean
}

// Verify audit chain
GET /api/admin/audit/verify-chain
Response: {
  isValid: boolean,
  brokenAt: number | null,
  totalEvents: number,
  firstEvent: ImmutableEvent,
  lastEvent: ImmutableEvent
}
```

---

## Database Schema

### Core Tables (7)

| Table | Description |
|-------|-------------|
| `users` | User accounts and roles |
| `judgments` | Court judgment records |
| `recovery_scores` | AI-predicted recovery scores |
| `price_estimates` | Pricing scenarios |
| `bundles` | Judgment bundles |
| `bundle_judgments` | Bundle-judgment relationships |
| `chat_messages` | AI chat history |

### Bond Tables (5)

| Table | Description |
|-------|-------------|
| `bonds` | Bond instruments |
| `bond_documents` | Bond document storage |
| `auctions` | Exchange auctions |
| `auction_bids` | Bid records |
| `bond_process_documents` | Lifecycle documents |

### Exchange Tables (7)

| Table | Description |
|-------|-------------|
| `exchange_trades` | Trade records |
| `exchange_settlements` | Settlement tracking |
| `bond_assignments` | Ownership records |
| `assignment_transfers` | Transfer requests |
| `distributions` | Dividend distributions |

### Underwriting Tables (2)

| Table | Description |
|-------|-------------|
| `underwriting_cases` | Underwriting analyses |
| `underwriting_parties` | Party data |

### Surety Tables (5)

| Table | Description |
|-------|-------------|
| `surety_trusts` | Surety trust accounts |
| `surety_cases` | Surety cases |
| `surety_indemnitors` | Indemnitor records |
| `surety_collateral` | Collateral tracking |
| `surety_documents` | Surety documents |

### Ledger Tables (4)

| Table | Description |
|-------|-------------|
| `ledger_accounts` | Chart of accounts |
| `ledger_journal_entries` | Journal entries |
| `ledger_postings` | Debits/credits |
| `immutable_events` | Audit events |

### System Tables (2)

| Table | Description |
|-------|-------------|
| `trending_topics` | Market intelligence |
| `trending_summaries` | AI summaries |

---

## Security & Compliance

### Authentication & Authorization

- JWT-based authentication with role claims
- Role-based access control (RBAC)
- Admin PIN protection for surety operations
- Session management with secure tokens

### API Security

- Rate limiting:
  - General API: 100 requests/15 minutes
  - Auth routes: 10 requests/15 minutes
  - Payment routes: 50 requests/hour

- Security headers (Helmet):
  - Content Security Policy (CSP)
  - HSTS
  - X-Frame-Options
  - X-Content-Type-Options

- CORS configuration with allowed origins

### Data Protection

- Input sanitization (null byte removal)
- SQL injection prevention via Drizzle ORM
- XSS prevention via React escaping
- PII redaction in logs

### Audit Compliance

- Hash-chained immutable events (SHA-256)
- Complete audit trail of all actions
- Chain verification API
- Regulatory compliance ready

---

## Installation & Deployment

### Prerequisites

- Node.js 20+
- PostgreSQL database (Neon recommended)
- OpenAI API key
- Stripe account (for payments)

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@host/database

# Authentication
JWT_SECRET=your-jwt-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-admin-password

# AI
OPENAI_API_KEY=sk-...

# Payments
STRIPE_SECRET_KEY=sk_...
STRIPE_PUBLISHABLE_KEY=pk_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Surety (PIN for admin surety operations)
SURETY_ADMIN_PIN=1234

# App
PORT=5000
NODE_ENV=development
REPLIT_DOMAINS=your-app.replit.dev
```

### Installation Steps

```bash
# 1. Clone repository
git clone https://github.com/ocean824/BONDAI-UPDATE.git
cd BONDAI-UPDATE

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your values

# 4. Run database migrations
npm run db:push

# 5. Start development server
npm run dev

# 6. Open in browser
# http://localhost:5173
```

### Production Deployment

```bash
# Build for production
npm run build

# Start production server
npm start
```

### Replit Deployment

1. Import repository to Replit
2. Set secrets in Replit Secrets:
   - `DATABASE_URL`
   - `OPENAI_API_KEY`
   - `STRIPE_SECRET_KEY`
   - `STRIPE_PUBLISHABLE_KEY`
   - `JWT_SECRET`
   - `SURETY_ADMIN_PIN`
3. Run "Start" button

---

## Testing

### Run All Tests

```bash
npm run test
```

### Run with Coverage

```bash
npm run test:coverage
```

### Test Structure

```
tests/
├── ledger.test.ts           # Ledger service tests
├── underwriting.test.ts     # Underwriting tests
└── exchange.test.ts         # Exchange/trade tests
```

### Key Test Cases

1. **Ledger Tests:**
   - Journal entry creation
   - Posting balance updates
   - Trial balance verification

2. **Underwriting Tests:**
   - Risk score calculation
   - Monte Carlo simulation
   - Report generation

3. **Exchange Tests:**
   - Trade creation
   - Bid placement
   - Settlement processing

---

## Troubleshooting

### Common Issues

#### Database Connection Failed

```
Error: connect ECONNREFUSED
Solution: Check DATABASE_URL environment variable
```

#### JWT Token Expired

```
401 Unauthorized
Solution: Re-login to get new token
```

#### Surety Operations Return 403

```
Error: Invalid surety PIN
Solution: Set X-Surety-PIN header with correct PIN
```

#### Stripe Checkout Fails

```
Error: Checkout session creation failed
Solution: Check Stripe API keys and webhook configuration
```

#### AI Extraction Fails

```
Error: AI extraction service unavailable
Solution: Verify OPENAI_API_KEY is set correctly
```

### Debug Mode

```bash
# Enable verbose logging
DEBUG=* npm run dev
```

### Check Logs

```bash
# View server logs
tail -f logs/server.log
```

---

## Support

### Documentation

- [README.md](./README.md) - Quick start guide
- [DATABASE.md](./DATABASE.md) - Database documentation
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment guide

### API Documentation

Access interactive API docs at `/api/docs` when running the server.

---

## License

Proprietary - All Rights Reserved

---

**BondAI Platform - Judgment Debt Underwriting & Trading**
