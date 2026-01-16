import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { authMiddleware, generateToken, verifyToken, type AuthRequest } from "./middleware/auth";
import { extractJudgmentData, generateChatResponse } from "./services/aiExtractionService";
import { buildMultiScenarioPricing } from "./services/pricingService";
import { generateInvestorTeaserPDF } from "./services/pdfGenerationService";
import { generateBondDraft } from "./services/bondAiService";
import { summarizeBondDocumentFromFile } from "./services/bondDocumentAiService";
import { getTrendingTopics, refreshTrendingTopics } from "./services/trendingService";
import { extractBondDataFromDocument } from "./services/bondExtractionService";
import { computeUnderwritingMetrics, generateUnderwritingNarrative } from "./services/underwritingService";
import { getInvestorOverview, handleBondPerfected, closeExpiredAuctions } from "./services/bondPerfectionService";
import {
  computeSuretyUnderwriting,
  createSuretyCase,
  approveSuretyCase,
  declineSuretyCase,
  recordCollateralPosted,
  activateSuretyCase,
  releaseSuretyCase,
  getAllSuretyCases,
  getSuretyCaseById,
  getAllSuretyTrusts,
  getSuretyTrustById,
  createSuretyTrust,
  updateSuretyTrust
} from "./services/suretyUnderwritingService";
import {
  generateDocsForBondStep,
  getAvailableSteps,
  ALLOWED_STEPS,
  type BondProcessStep
} from "./services/documentEngineService";
import { createTradeFromAuction } from "./services/tradeService";
import { sendEmail, getEmailQueue, processEmailQueue } from "./services/documentEmailService";
import { auctions, auctionBids, suretyTrusts, suretyCases, suretyCollateral, bondProcessDocuments, bonds } from "@shared/schema";
import { eq, desc, and, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { judgments, bundleJudgments, pricingReadyJudgmentSchema, pricingInputSchema, insertBondSchema, users } from "@shared/schema";
import multer from "multer";
import * as mammoth from "mammoth";
import path from "path";
import fs from "fs/promises";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";

export async function registerRoutes(app: Express): Promise<Server> {
  // ===== AUTH ROUTES =====
  const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().min(1),
    role: z.enum(["analyst", "investor"]).default("analyst"),
  });

  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const validation = registerSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid input", details: validation.error });
      }

      const { email, password, name, role } = validation.data;

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ error: "Email already registered" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        name,
        role,
      });

      const token = generateToken(user);
      res.json({ user: { ...user, password: undefined }, token });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const validation = loginSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid input", details: validation.error });
      }

      const { email, password } = validation.data;

      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = generateToken(user);
      res.json({ user: { ...user, password: undefined }, token });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.get("/api/auth/me", authMiddleware, async (req: AuthRequest, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const user = await storage.getUser(req.user.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ user: { ...user, password: undefined } });
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  // ===== GLOBAL INVESTOR GATE =====
  // Investors can ONLY access /api/investor/* and /api/auth/* routes
  // This is a hard wall that blocks investors from all other routes
  app.use("/api", (req, res, next) => {
    const path = req.path;
    
    // Allow all auth routes
    if (path.startsWith("/auth")) {
      return next();
    }
    
    // Allow all investor routes
    if (path.startsWith("/investor")) {
      return next();
    }
    
    // Check if user is authenticated and is an investor
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const token = authHeader.substring(7);
        const decoded = verifyToken(token);
        
        if (decoded && decoded.role === "investor") {
          // Investor trying to access non-investor route - block them
          return res.status(403).json({ 
            error: "Access denied",
            message: "Investor accounts can only access Bond Exchange features"
          });
        }
      } catch (e) {
        // Token verification failed, let next middleware handle auth
      }
    }
    
    // Allow all other requests to proceed (admin, analyst, or unauthenticated)
    next();
  });

  // ===== JUDGMENT ROUTES =====
  app.get("/api/judgments", authMiddleware, async (req: AuthRequest, res) => {
    try {
      // Admin sees all judgments, regular users see only their own
      const ownerId = req.user!.role === "admin" ? undefined : req.user!.id;
      const judgmentsList = await storage.getJudgments(ownerId);
      res.json(judgmentsList);
    } catch (error) {
      console.error("Get judgments error:", error);
      res.status(500).json({ error: "Failed to get judgments" });
    }
  });

  app.post("/api/judgments", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { debtorName, caseNumber, judgmentAmount, notes } = req.body;

      // ===== REAL DATA ONLY - NO FABRICATED DEFAULTS =====
      // If judgmentAmount provided, validate it's a real number (not zero placeholder)
      let validatedAmount: string | null = null;
      if (judgmentAmount !== undefined && judgmentAmount !== null && judgmentAmount !== "") {
        const parsedAmount = parseFloat(String(judgmentAmount));
        if (isNaN(parsedAmount)) {
          return res.status(400).json({ 
            error: "Invalid judgment amount",
            message: "Judgment amount must be a valid number"
          });
        }
        if (parsedAmount <= 0) {
          return res.status(400).json({ 
            error: "Invalid judgment amount",
            message: "Judgment amount must be greater than zero. Use null if amount is unknown."
          });
        }
        validatedAmount = String(parsedAmount);
      }

      const judgment = await storage.createJudgment({
        ownerId: req.user!.id,
        debtorName,
        caseNumber,
        judgmentAmount: validatedAmount, // null if not provided, real value if provided (never "0")
        status: "uploaded",
        notes,
      });

      res.json(judgment);
    } catch (error) {
      console.error("Create judgment error:", error);
      res.status(500).json({ error: "Failed to create judgment" });
    }
  });

  app.post("/api/judgments/:id/extract", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const judgmentId = parseInt(req.params.id);
      const { rawText } = req.body;

      if (!rawText) {
        return res.status(400).json({ error: "Raw text is required" });
      }

      // ===== REAL DATA EXTRACTION - NO FALLBACK PLACEHOLDERS =====
      // This will throw if extraction fails or service unavailable
      const extracted = await extractJudgmentData(rawText);
      
      await storage.updateJudgment(judgmentId, {
        debtorName: extracted.debtorName,
        caseNumber: extracted.caseNumber,
        court: extracted.court,
        jurisdiction: extracted.jurisdiction,
        judgmentAmount: String(extracted.judgmentAmount),
        judgmentDate: extracted.judgmentDate ? new Date(extracted.judgmentDate) : null,
        rawFields: extracted.rawFields,
        status: "extracted",
      });

      res.json(extracted);
    } catch (error) {
      console.error("Extract judgment error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Return appropriate status codes based on error type
      if (errorMessage.includes("not configured")) {
        return res.status(503).json({ 
          error: "AI extraction service unavailable",
          message: "The AI extraction service is not currently configured. Please contact support."
        });
      }
      
      if (errorMessage.includes("missing required fields") || errorMessage.includes("incomplete")) {
        return res.status(422).json({ 
          error: "Extraction incomplete",
          message: "Could not extract sufficient judgment data from the document. The document may be missing critical information or may not be a valid judgment document."
        });
      }
      
      res.status(500).json({ 
        error: "Extraction failed",
        message: "An unexpected error occurred during AI extraction. Please try again."
      });
    }
  });

  app.post("/api/judgments/:id/price", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const judgmentId = parseInt(req.params.id);

      // ===== REAL DATA VALIDATION =====
      // Validate pricing input parameters (no defaults allowed)
      const inputValidation = pricingInputSchema.safeParse(req.body);
      if (!inputValidation.success) {
        return res.status(400).json({
          error: "Invalid pricing parameters",
          details: inputValidation.error.flatten().fieldErrors,
        });
      }

      const { targetIRR, discountRate, expectedRecoveryPct } = inputValidation.data;

      const judgment = await storage.getJudgment(judgmentId);
      if (!judgment) {
        return res.status(404).json({ error: "Judgment not found" });
      }

      // Validate judgment has required fields for pricing (no fallbacks to "0" or defaults)
      const judgmentValidation = pricingReadyJudgmentSchema.safeParse(judgment);
      if (!judgmentValidation.success) {
        return res.status(400).json({
          error: "Insufficient judgment data for pricing analysis",
          message: "This judgment is missing required fields needed for pricing calculations. Please ensure the judgment has been properly extracted with all required data.",
          details: judgmentValidation.error.flatten().fieldErrors,
        });
      }

      // All validations passed - use real judgment amount (no fallback)
      const scenarios = buildMultiScenarioPricing({
        judgmentAmount: parseFloat(judgment.judgmentAmount!),
        targetIRR,
        discountRate,
        expectedRecoveryPct,
      });

      // Delete existing price estimates for this judgment
      await storage.deletePriceEstimates(judgmentId, ["base", "optimistic", "stressed"]);

      // Create new price estimates
      for (const scenario of scenarios) {
        await storage.createPriceEstimate({
          judgmentId,
          scenarioName: scenario.scenario,
          targetIRR: String(scenario.targetIRR),
          discountRate: String(scenario.discountRate),
          expectedRecoveryPct: String(scenario.expectedRecoveryPct),
          recommendedPurchasePrice: String(scenario.recommendedPurchasePrice),
          scenarioJson: {
            model: "multi-scenario",
            scenario: scenario.scenario,
            expectedRecoveryAmount: scenario.expectedRecoveryAmount,
            note: scenario.note,
          },
        });
      }

      res.json({ scenarios });
    } catch (error) {
      console.error("Price judgment error:", error);
      res.status(500).json({ error: "Failed to calculate pricing" });
    }
  });

  app.get("/api/judgments/:id/price-estimates", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const judgmentId = parseInt(req.params.id);
      const estimates = await storage.getPriceEstimates(judgmentId);
      
      const scenarios = estimates.map((est) => ({
        scenario: est.scenarioName as "base" | "optimistic" | "stressed",
        targetIRR: parseFloat(est.targetIRR || "0"),
        discountRate: parseFloat(est.discountRate || "0"),
        expectedRecoveryPct: parseFloat(est.expectedRecoveryPct || "0"),
        judgmentAmount: (est.scenarioJson as any)?.judgmentAmount || 0,
        expectedRecoveryAmount: (est.scenarioJson as any)?.expectedRecoveryAmount || 0,
        recommendedPurchasePrice: parseFloat(est.recommendedPurchasePrice || "0"),
        note: (est.scenarioJson as any)?.note,
      }));

      res.json({ scenarios });
    } catch (error) {
      console.error("Get price estimates error:", error);
      res.status(500).json({ error: "Failed to get price estimates" });
    }
  });

  // Judgment document upload configuration
  const judgmentUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 25 * 1024 * 1024, // 25 MB max
    },
  });

  // Extract judgment data from uploaded document (PDF or Word)
  app.post(
    "/api/judgments/extract-from-doc",
    authMiddleware,
    judgmentUpload.single("file"),
    async (req: AuthRequest, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "File is required" });
        }

        const mime = req.file.mimetype;
        const originalName = req.file.originalname.toLowerCase();
        const buffer = req.file.buffer;

        let text = "";

        // PDF → text
        if (mime === "application/pdf" || originalName.endsWith(".pdf")) {
          // Dynamic import for pdf-parse (CommonJS module)
          const pdfParseModule = await import("pdf-parse") as any;
          const pdfParse = pdfParseModule.default || pdfParseModule;
          const parsed = await pdfParse(buffer);
          text = parsed.text || "";
        }
        // DOCX / DOC → text (Word)
        else if (
          mime ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          mime === "application/msword" ||
          originalName.endsWith(".docx")
        ) {
          const result = await mammoth.extractRawText({ buffer });
          text = result.value || "";
        } else {
          return res.status(400).json({
            error: "Unsupported file type. Please upload a PDF or Word (.docx) judgment.",
          });
        }

        if (!text.trim()) {
          return res.status(422).json({
            error: "Unable to read text from the document.",
          });
        }

        // Use the existing AI extractor – REAL DATA ONLY
        const extraction = await extractJudgmentData(text);

        const notesParts: string[] = [];
        if ((extraction as any).court) notesParts.push(`Court: ${(extraction as any).court}`);
        if ((extraction as any).jurisdiction)
          notesParts.push(`Jurisdiction: ${(extraction as any).jurisdiction}`);
        if ((extraction as any).judgmentDate)
          notesParts.push(`Judgment date: ${(extraction as any).judgmentDate}`);

        const notes = notesParts.length ? notesParts.join(" | ") : undefined;

        return res.json({
          debtorName: extraction.debtorName,
          caseNumber: extraction.caseNumber ?? null,
          judgmentAmount: extraction.judgmentAmount,
          notes,
        });
      } catch (error: any) {
        console.error("Judgment doc extraction error:", error);
        return res.status(500).json({
          error: "Failed to extract judgment data from document",
          message: error?.message ?? "Unexpected error",
        });
      }
    },
  );

  // ===== BUNDLE ROUTES =====
  app.get("/api/bundles", authMiddleware, async (req: AuthRequest, res) => {
    try {
      // Admin sees all bundles, regular users see only their own
      const ownerId = req.user!.role === "admin" ? undefined : req.user!.id;
      const bundlesList = await storage.getBundles(ownerId);
      res.json(bundlesList);
    } catch (error) {
      console.error("Get bundles error:", error);
      res.status(500).json({ error: "Failed to get bundles" });
    }
  });

  app.get("/api/bundles/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const bundleId = parseInt(req.params.id);
      const bundle = await storage.getBundle(bundleId);
      
      if (!bundle) {
        return res.status(404).json({ error: "Bundle not found" });
      }

      // Verify ownership (admin bypass)
      if (bundle.ownerId !== req.user!.id && req.user!.role !== "admin") {
        return res.status(403).json({ error: "Forbidden - You do not have access to this bundle" });
      }

      const bundleJudgmentsList = await storage.getBundleJudgments(bundleId);
      const judgmentsWithDetails = await Promise.all(
        bundleJudgmentsList.map(async (bj) => {
          const judgment = await storage.getJudgment(bj.judgmentId);
          return {
            ...bj,
            judgment: judgment!,
          };
        })
      );

      res.json({
        ...bundle,
        judgments: judgmentsWithDetails,
      });
    } catch (error) {
      console.error("Get bundle error:", error);
      res.status(500).json({ error: "Failed to get bundle" });
    }
  });

  app.post("/api/bundles", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { name, description } = req.body;

      const bundle = await storage.createBundle({
        ownerId: req.user!.id,
        name,
        description,
        status: "draft",
      });

      res.json(bundle);
    } catch (error) {
      console.error("Create bundle error:", error);
      res.status(500).json({ error: "Failed to create bundle" });
    }
  });

  app.post("/api/bundles/:id/judgments", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const bundleId = parseInt(req.params.id);
      const { judgmentId, tranche } = req.body;

      // Verify bundle ownership before allowing modifications
      const bundle = await storage.getBundle(bundleId);
      if (!bundle) {
        return res.status(404).json({ error: "Bundle not found" });
      }
      if (bundle.ownerId !== req.user!.id && req.user!.role !== "admin") {
        return res.status(403).json({ error: "Forbidden - You do not have access to this bundle" });
      }

      const bundleJudgment = await storage.addJudgmentToBundle({
        bundleId,
        judgmentId,
        tranche,
      });

      res.json(bundleJudgment);
    } catch (error) {
      console.error("Add judgment to bundle error:", error);
      res.status(500).json({ error: "Failed to add judgment to bundle" });
    }
  });

  app.delete("/api/bundles/:id/judgments/:judgmentId", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const bundleId = parseInt(req.params.id);
      const judgmentId = parseInt(req.params.judgmentId);

      // Verify bundle ownership before allowing modifications
      const bundle = await storage.getBundle(bundleId);
      if (!bundle) {
        return res.status(404).json({ error: "Bundle not found" });
      }
      if (bundle.ownerId !== req.user!.id && req.user!.role !== "admin") {
        return res.status(403).json({ error: "Forbidden - You do not have access to this bundle" });
      }

      await storage.removeJudgmentFromBundle(bundleId, judgmentId);
      res.json({ success: true });
    } catch (error) {
      console.error("Remove judgment from bundle error:", error);
      res.status(500).json({ error: "Failed to remove judgment from bundle" });
    }
  });

  // ===== METRICS ROUTES =====
  app.get("/api/metrics", authMiddleware, async (req: AuthRequest, res) => {
    try {
      // ===== REAL DATA ONLY - NO FABRICATED METRICS =====
      // Query actual pricing data without defaults/fallbacks
      const result = await db.execute(sql`
        SELECT 
          COUNT(DISTINCT j.id) as "totalJudgments",
          COALESCE(SUM(CAST(j.judgment_amount AS NUMERIC)), 0) as "totalFaceValue",
          AVG(CAST(pe.expected_recovery_pct AS NUMERIC)) as "averageRecovery",
          SUM(CAST(pe.recommended_purchase_price AS NUMERIC)) as "totalRecommendedPurchase"
        FROM judgments j
        LEFT JOIN price_estimates pe ON pe.judgment_id = j.id AND pe.scenario_name = 'base'
        WHERE j.owner_id = ${req.user!.id}
      `);

      const row = result.rows[0] as any;
      const totalFaceValue = parseFloat(row.totalFaceValue || "0");
      
      // Use real data only - show null when pricing data doesn't exist
      // Do NOT fabricate averages or use default multipliers
      const averageRecovery = row.averageRecovery !== null 
        ? parseFloat(row.averageRecovery) 
        : null;
      const totalRecommendedPurchase = row.totalRecommendedPurchase !== null
        ? parseFloat(row.totalRecommendedPurchase)
        : null;

      // Tranche breakdown - use real price estimates, not fabricated multipliers
      const trancheResult = await db.execute(sql`
        SELECT 
          bj.tranche,
          COUNT(DISTINCT j.id) as count,
          COALESCE(SUM(CAST(j.judgment_amount AS NUMERIC)), 0) as "faceValue",
          SUM(CAST(pe.recommended_purchase_price AS NUMERIC)) as "recommendedPurchase"
        FROM bundle_judgments bj
        JOIN judgments j ON j.id = bj.judgment_id
        LEFT JOIN price_estimates pe ON pe.judgment_id = j.id AND pe.scenario_name = 'base'
        WHERE j.owner_id = ${req.user!.id}
        GROUP BY bj.tranche
      `);

      const trancheBreakdown = {
        senior: { count: 0, faceValue: 0, recommendedPurchase: null as number | null },
        mezz: { count: 0, faceValue: 0, recommendedPurchase: null as number | null },
        equity: { count: 0, faceValue: 0, recommendedPurchase: null as number | null },
      };

      for (const row of trancheResult.rows as any[]) {
        const tranche = row.tranche as "senior" | "mezz" | "equity";
        const faceValue = parseFloat(row.faceValue || "0");
        const recommendedPurchase = row.recommendedPurchase !== null
          ? parseFloat(row.recommendedPurchase)
          : null;
        
        trancheBreakdown[tranche] = {
          count: parseInt(row.count || "0"),
          faceValue,
          recommendedPurchase, // Real data or null, never fabricated
        };
      }

      res.json({
        totalJudgments: parseInt(row.totalJudgments || "0"),
        totalFaceValue,
        totalRecommendedPurchase, // null if no pricing data exists
        averageRecovery, // null if no pricing data exists
        trancheBreakdown,
        _note: averageRecovery === null 
          ? "Some metrics unavailable - judgments need pricing analysis"
          : undefined,
      });
    } catch (error) {
      console.error("Get metrics error:", error);
      res.status(500).json({ error: "Failed to get metrics" });
    }
  });

  // ===== CHAT ROUTES =====
  app.post("/api/chat/sessions", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { title } = req.body;

      const session = await storage.createChatSession({
        userId: req.user!.id,
        title: title || "New Chat",
      });

      res.json(session);
    } catch (error) {
      console.error("Create chat session error:", error);
      res.status(500).json({ error: "Failed to create chat session" });
    }
  });

  app.get("/api/chat/sessions/:id/messages", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const messages = await storage.getChatMessages(sessionId);
      res.json(messages);
    } catch (error) {
      console.error("Get chat messages error:", error);
      res.status(500).json({ error: "Failed to get messages" });
    }
  });

  app.post("/api/chat/sessions/:id/messages", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const { content } = req.body;

      // Create user message
      await storage.createChatMessage({
        sessionId,
        role: "user",
        content,
      });

      // Generate AI response
      const aiResponse = await generateChatResponse(content);

      // Create assistant message
      const assistantMessage = await storage.createChatMessage({
        sessionId,
        role: "assistant",
        content: aiResponse,
      });

      res.json(assistantMessage);
    } catch (error) {
      console.error("Send chat message error:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  // ===== PDF GENERATION ROUTES =====
  app.get("/api/teaser/:bundleId", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const bundleId = parseInt(req.params.bundleId);

      // Fetch bundle
      const bundle = await storage.getBundle(bundleId);
      if (!bundle) {
        return res.status(404).json({ error: "Bundle not found" });
      }

      // Verify ownership - prevent unauthorized access to other users' bundles (admin bypass)
      if (bundle.ownerId !== req.user!.id && req.user!.role !== "admin") {
        return res.status(403).json({ error: "Forbidden - You do not have access to this bundle" });
      }

      // Fetch bundle judgments with details
      const bundleJudgmentsList = await storage.getBundleJudgments(bundleId);
      
      // Fetch judgment details and price estimates
      const judgmentDetails = await Promise.all(
        bundleJudgmentsList.map(async (bj) => {
          const judgment = await storage.getJudgment(bj.judgmentId);
          const priceEstimates = await storage.getPriceEstimates(bj.judgmentId);
          const basePrice = priceEstimates.find(pe => pe.scenarioName === "base");
          
          return {
            judgment,
            tranche: bj.tranche,
            recommendedPrice: basePrice ? parseFloat(basePrice.recommendedPurchasePrice) : 0,
          };
        })
      );

      // Calculate tranche summaries (using actual stored keys: senior, mezz, equity)
      const trancheMapping = [
        { key: "senior", label: "Senior" },
        { key: "mezz", label: "Mezzanine" },
        { key: "equity", label: "Equity" },
      ];
      
      const trancheSummaries = trancheMapping.map(({ key, label }) => {
        const trancheJudgments = judgmentDetails.filter(jd => jd.tranche === key);
        return {
          tranche: label,
          count: trancheJudgments.length,
          totalFaceValue: trancheJudgments.reduce((sum, jd) => 
            sum + parseFloat(jd.judgment?.judgmentAmount || "0"), 0),
          totalRecommendedPrice: trancheJudgments.reduce((sum, jd) => 
            sum + jd.recommendedPrice, 0),
        };
      });

      // Calculate totals
      const totalFaceValue = trancheSummaries.reduce((sum, t) => sum + t.totalFaceValue, 0);
      const totalRecommendedPrice = trancheSummaries.reduce((sum, t) => sum + t.totalRecommendedPrice, 0);
      const avgRecoveryRate = totalFaceValue > 0 ? (totalRecommendedPrice / totalFaceValue) * 100 : 0;

      // Format judgment list with proper tranche labels
      const trancheLabels: Record<string, string> = {
        senior: "Senior",
        mezz: "Mezzanine",
        equity: "Equity",
      };
      
      const judgments = judgmentDetails.map(jd => ({
        debtorName: jd.judgment?.debtorName || "Unknown",
        caseNumber: jd.judgment?.caseNumber || "N/A",
        court: jd.judgment?.court || "N/A",
        jurisdiction: jd.judgment?.jurisdiction || "N/A",
        judgmentAmount: jd.judgment?.judgmentAmount || "0",
        tranche: trancheLabels[jd.tranche] || jd.tranche,
      }));

      // Generate PDF
      const pdfData = {
        bundleName: bundle.name,
        bundleDescription: bundle.description || "",
        createdAt: bundle.createdAt?.toISOString() || new Date().toISOString(),
        totalFaceValue,
        totalRecommendedPrice,
        judgmentCount: bundleJudgmentsList.length,
        avgRecoveryRate,
        tranches: trancheSummaries.filter(t => t.count > 0),
        judgments,
      };

      const pdfDoc = generateInvestorTeaserPDF(pdfData);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="bundle-${bundleId}-teaser.pdf"`
      );

      // Pipe the PDF stream to response before ending the document
      pdfDoc.pipe(res);
      pdfDoc.end();
    } catch (error) {
      console.error("Generate teaser PDF error:", error);
      res.status(500).json({ error: "Failed to generate teaser PDF" });
    }
  });

  // ===== TRENDING TOPICS ROUTES =====
  app.get("/api/trending", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
      const category = (req.query.category as string) || undefined;

      const topics = await getTrendingTopics({ limit, category });
      res.json(topics);
    } catch (error) {
      console.error("Get trending topics error:", error);
      res.status(500).json({ error: "Failed to load trending topics" });
    }
  });

  const refreshTrendingSchema = z.object({
    category: z.string().max(100).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  });

  app.post("/api/admin/trending/refresh", authMiddleware, async (req: AuthRequest, res) => {
    try {
      if (req.user?.role !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
      }

      const validation = refreshTrendingSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          error: "Invalid request", 
          details: validation.error.errors 
        });
      }

      const { category, limit } = validation.data;
      const topics = await refreshTrendingTopics({
        category: category || "bonds",
        limit: limit || 20,
      });

      res.json({ success: true, topics });
    } catch (error: any) {
      console.error("Refresh trending topics error:", error);
      res.status(500).json({
        error: error?.message || "Failed to refresh trending topics",
      });
    }
  });

  // ===== BOND ROUTES =====
  // Set up multer for file uploads
  const uploadsDir = path.join(process.cwd(), "uploads", "bond-documents");
  
  // Ensure uploads directory exists
  await fs.mkdir(uploadsDir, { recursive: true });

  const multerStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + "-" + file.originalname);
    },
  });

  const upload = multer({
    storage: multerStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
      const allowedMimes = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Only PDF and DOCX files are allowed"));
      }
    },
  });

  // Get all bonds for current user
  app.get("/api/bonds", authMiddleware, async (req: AuthRequest, res) => {
    try {
      // Admin sees all bonds, regular users see only their own
      const ownerId = req.user!.role === "admin" ? undefined : req.user!.id;
      const bondsList = await storage.getBonds(ownerId);
      res.json(bondsList);
    } catch (error) {
      console.error("Get bonds error:", error);
      res.status(500).json({ error: "Failed to get bonds" });
    }
  });

  // Get single bond
  app.get("/api/bonds/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const bondId = parseInt(req.params.id);
      const bond = await storage.getBond(bondId);

      if (!bond) {
        return res.status(404).json({ error: "Bond not found" });
      }

      // Verify ownership (admin bypass)
      if (bond.ownerId !== req.user!.id && req.user!.role !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
      }

      res.json(bond);
    } catch (error) {
      console.error("Get bond error:", error);
      res.status(500).json({ error: "Failed to get bond" });
    }
  });

  // Create new bond
  app.post("/api/bonds", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const validation = insertBondSchema.safeParse({
        ...req.body,
        ownerId: req.user!.id,
      });

      if (!validation.success) {
        return res.status(400).json({ 
          error: "Invalid input", 
          details: validation.error 
        });
      }

      const bond = await storage.createBond(validation.data);
      res.json(bond);
    } catch (error) {
      console.error("Create bond error:", error);
      res.status(500).json({ error: "Failed to create bond" });
    }
  });

  // Update bond
  app.patch("/api/bonds/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const bondId = parseInt(req.params.id);
      const bond = await storage.getBond(bondId);

      if (!bond) {
        return res.status(404).json({ error: "Bond not found" });
      }

      // Verify ownership (admin bypass)
      if (bond.ownerId !== req.user!.id && req.user!.role !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
      }

      const updated = await storage.updateBond(bondId, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Update bond error:", error);
      res.status(500).json({ error: "Failed to update bond" });
    }
  });

  // Update only the AI-derived bond score + risk tier
  app.patch("/api/bonds/:id/score", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const bondId = Number(req.params.id);
      if (!Number.isFinite(bondId)) {
        return res.status(400).json({ error: "Invalid bond id" });
      }

      const bond = await storage.getBond(bondId);
      if (!bond) {
        return res.status(404).json({ error: "Bond not found" });
      }

      // Verify ownership (admin bypass)
      if (bond.ownerId !== req.user!.id && req.user!.role !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
      }

      const ScoreSchema = z.object({
        bondScore: z.number().int().min(0).max(100),
        riskTier: z.enum(["low", "moderate", "high"]).optional(),
      });

      const parsed = ScoreSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid score payload",
          details: parsed.error.flatten(),
        });
      }

      const { bondScore, riskTier } = parsed.data;

      // Derive risk tier from score if not provided
      const derivedTier: "low" | "moderate" | "high" =
        riskTier ??
        (bondScore >= 70
          ? "low"
          : bondScore < 40
          ? "high"
          : "moderate");

      const updated = await storage.updateBond(bondId, {
        bondScore,
        riskTier: derivedTier,
      });

      return res.json(updated);
    } catch (error) {
      console.error("Update bond score error:", error);
      return res.status(500).json({ error: "Failed to update bond score" });
    }
  });

  // Draft bond document using AI
  app.post("/api/bonds/:id/draft", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const bondId = parseInt(req.params.id);
      const bond = await storage.getBond(bondId);

      if (!bond) {
        return res.status(404).json({ error: "Bond not found" });
      }

      // Verify ownership (admin bypass)
      if (bond.ownerId !== req.user!.id && req.user!.role !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
      }

      const { purpose, style } = req.body;

      const draftedDocument = await generateBondDraft(bond, { purpose, style });
      res.json({ content: draftedDocument });
    } catch (error) {
      console.error("Draft bond document error:", error);
      res.status(500).json({ error: "Failed to draft bond document" });
    }
  });

  // Upload and process bond document
  app.post(
    "/api/bonds/:id/documents",
    authMiddleware,
    upload.single("file"),
    async (req: AuthRequest, res) => {
      try {
        const bondId = parseInt(req.params.id);
        const bond = await storage.getBond(bondId);

        if (!bond) {
          return res.status(404).json({ error: "Bond not found" });
        }

        // Verify ownership (admin bypass)
        if (bond.ownerId !== req.user!.id && req.user!.role !== "admin") {
          return res.status(403).json({ error: "Forbidden" });
        }

        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const { kind = "supporting", description = "" } = req.body;

        // Use AI to summarize and tag the document
        let aiSummary = null;
        let aiTags: string[] = [];
        
        try {
          const result = await summarizeBondDocumentFromFile(req.file.path, req.file.mimetype);
          if (result) {
            aiSummary = result.summary;
            aiTags = result.tags;
          }
        } catch (aiError) {
          console.error("AI processing error:", aiError);
          // Continue without AI features if they fail
        }

        // Create document record
        const document = await storage.createBondDocument({
          bondId,
          ownerId: req.user!.id,
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          storagePath: req.file.path,
          kind,
          description,
          aiSummary,
          tags: aiTags,
        });

        res.json(document);
      } catch (error) {
        console.error("Upload bond document error:", error);
        res.status(500).json({ error: "Failed to upload bond document" });
      }
    }
  );

  // Get bond documents
  app.get("/api/bonds/:id/documents", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const bondId = parseInt(req.params.id);
      const bond = await storage.getBond(bondId);

      if (!bond) {
        return res.status(404).json({ error: "Bond not found" });
      }

      // Verify ownership (admin bypass)
      if (bond.ownerId !== req.user!.id && req.user!.role !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
      }

      const documents = await storage.getBondDocuments(bondId, req.user!.id);
      res.json(documents);
    } catch (error) {
      console.error("Get bond documents error:", error);
      res.status(500).json({ error: "Failed to get bond documents" });
    }
  });

  // Search bond documents
  app.get("/api/bonds/documents/search", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const query = req.query.q as string || "";
      const documents = await storage.searchBondDocuments(req.user!.id, query);
      res.json(documents);
    } catch (error) {
      console.error("Search bond documents error:", error);
      res.status(500).json({ error: "Failed to search bond documents" });
    }
  });

  // Extract bond fields & AI bond score from a PDF/DOCX without creating the bond yet
  app.post(
    "/api/bonds/extract-from-document",
    authMiddleware,
    upload.single("file"),
    async (req: AuthRequest, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const { path: filePath, mimetype } = req.file;

        const extraction = await extractBondDataFromDocument(filePath, mimetype);

        // Optional: delete the temporary upload if you don't want to keep it
        await fs.unlink(filePath).catch(() => {});

        return res.json(extraction);
      } catch (error: any) {
        console.error("Bond extraction error:", error);
        
        // Clean up temporary file on error
        if (req.file?.path) {
          await fs.unlink(req.file.path).catch(() => {});
        }
        
        // Check if this is a validation error
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("validation failed") || errorMessage.includes("unreadable") || errorMessage.includes("empty")) {
          return res.status(422).json({
            error: "Unable to extract valid bond data from document",
            details: errorMessage,
          });
        }
        
        // Check if this is a configuration error
        if (errorMessage.includes("not configured")) {
          return res.status(503).json({
            error: "Bond extraction service not available",
            details: errorMessage,
          });
        }
        
        // Generic server error
        return res.status(500).json({
          error: "Failed to extract bond data from document",
          details: errorMessage,
        });
      }
    }
  );

  // ===== ADMIN ROUTES =====
  const adminLoginSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  });

  app.post("/api/admin/login", async (req, res) => {
    try {
      const validation = adminLoginSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid input" });
      }

      const { username, password } = validation.data;
      
      const adminUsername = process.env.ADMIN_USERNAME;
      const adminPassword = process.env.ADMIN_PASSWORD;

      if (!adminUsername || !adminPassword) {
        console.error("Admin credentials not configured");
        return res.status(503).json({ message: "Admin access not configured" });
      }

      if (username !== adminUsername || password !== adminPassword) {
        return res.status(401).json({ message: "Invalid admin credentials" });
      }

      // Find the actual admin user in the database
      const adminUser = await storage.getUserByEmail("admin@bondai.app");
      
      if (!adminUser) {
        console.error("Admin user not found in database - run seed script");
        return res.status(503).json({ message: "Admin user not configured" });
      }

      const token = generateToken(adminUser);
      
      // Return user data (without password) along with token, same as regular login
      const { password: _, ...userWithoutPassword } = adminUser;
      res.json({ 
        user: userWithoutPassword,
        token 
      });
    } catch (error) {
      console.error("Admin login error:", error);
      res.status(500).json({ message: "Authentication failed" });
    }
  });

  const adminAuthMiddleware = (req: AuthRequest, res: any, next: any) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const token = authHeader.substring(7);
      const decoded = verifyToken(token);
      
      if (!decoded) {
        return res.status(401).json({ error: "Invalid token" });
      }
      
      if (decoded.role !== "admin") {
        return res.status(403).json({ error: "Forbidden - Admin access required" });
      }

      req.user = decoded;
      next();
    } catch (error: any) {
      console.error("Admin auth error:", error.message);
      res.status(401).json({ error: "Invalid token" });
    }
  };

  app.get("/api/admin/verify", adminAuthMiddleware, async (req: AuthRequest, res) => {
    res.json({ valid: true });
  });

  app.get("/api/admin/stats", adminAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const [usersResult, judgmentsResult, bundlesResult, bondsResult, bondDocumentsResult] = await Promise.all([
        db.execute(sql`SELECT COUNT(*) as count FROM users`),
        db.execute(sql`SELECT COUNT(*) as count FROM judgments`),
        db.execute(sql`SELECT COUNT(*) as count FROM bundles`),
        db.execute(sql`SELECT COUNT(*) as count FROM bonds`),
        db.execute(sql`SELECT COUNT(*) as count FROM bond_documents`),
      ]);

      res.json({
        totalUsers: parseInt(usersResult.rows[0]?.count as string || "0"),
        totalJudgments: parseInt(judgmentsResult.rows[0]?.count as string || "0"),
        totalBundles: parseInt(bundlesResult.rows[0]?.count as string || "0"),
        totalBonds: parseInt(bondsResult.rows[0]?.count as string || "0"),
        totalBondDocuments: parseInt(bondDocumentsResult.rows[0]?.count as string || "0"),
      });
    } catch (error) {
      console.error("Get admin stats error:", error);
      res.status(500).json({ error: "Failed to get statistics" });
    }
  });

  // ===== UNDERWRITING ROUTES =====
  app.get("/api/underwriting/cases", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const isAdmin = req.user?.role === "admin";
      
      const cases = await storage.getUnderwritingCases(isAdmin ? undefined : userId);
      res.json(cases);
    } catch (error) {
      console.error("Get underwriting cases error:", error);
      res.status(500).json({ error: "Failed to fetch underwriting cases" });
    }
  });

  app.post("/api/underwriting/cases", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { caseInput, parties } = req.body;
      
      if (!caseInput || !parties || !Array.isArray(parties)) {
        return res.status(400).json({ error: "Invalid input: caseInput and parties required" });
      }

      const metrics = computeUnderwritingMetrics(caseInput, parties);
      const narrative = await generateUnderwritingNarrative(caseInput, parties, metrics);

      const savedCase = await storage.createUnderwritingCaseWithPartiesAndMetrics(
        userId,
        caseInput,
        parties,
        metrics,
        narrative || undefined
      );

      res.status(201).json(savedCase);
    } catch (error) {
      console.error("Create underwriting case error:", error);
      res.status(500).json({ error: "Failed to create underwriting case" });
    }
  });

  // Enhanced underwriting routes with risk scoring and probability modeling
  const riskFactorsSchema = z.object({
    claimToAssetRatio: z.number().min(0).max(200),
    collectionProbability: z.number().min(0).max(100),
    debtorFinancialHealth: z.number().min(0).max(100),
    assetLiquidity: z.number().min(0).max(100),
    lienPositionStrength: z.number().min(0).max(100),
    jurisdictionFavorability: z.number().min(0).max(100),
    documentationQuality: z.number().min(0).max(100),
    marketConditions: z.number().min(0).max(100),
    industryRisk: z.number().min(0).max(100),
    economicConditions: z.number().min(0).max(100),
  });

  // POST /api/underwriting/cases/:id/risk-score - Calculate risk score
  app.post("/api/underwriting/cases/:id/risk-score", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const caseId = parseInt(req.params.id);
      if (isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case ID" });
      }

      const validation = riskFactorsSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid risk factors", details: validation.error });
      }

      const { calculateRiskScore, runMonteCarloSimulation } = await import("./services/underwritingEnhancedService");
      
      const result = calculateRiskScore(validation.data);
      result.monteCarloResults = runMonteCarloSimulation(result.recoveryProbability, 0.25 - (result.confidence * 0.1));

      res.json({
        riskScore: result,
        monteCarlo: result.monteCarloResults,
      });
    } catch (error) {
      console.error("Calculate risk score error:", error);
      res.status(500).json({ error: "Failed to calculate risk score" });
    }
  });

  // POST /api/underwriting/cases/:id/report - Generate comprehensive report
  app.get("/api/underwriting/cases/:id/report", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const caseId = parseInt(req.params.id);
      if (isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case ID" });
      }

      const { generateUnderwritingReport } = await import("./services/underwritingEnhancedService");
      const report = await generateUnderwritingReport(caseId);

      if (!report) {
        return res.status(404).json({ error: "Case not found" });
      }

      res.json({ report });
    } catch (error) {
      console.error("Generate underwriting report error:", error);
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

  // GET /api/underwriting/portfolio/summary - Portfolio-level view
  app.get("/api/underwriting/portfolio/summary", authMiddleware, async (_req: AuthRequest, res) => {
    try {
      const { getPortfolioUnderwritingSummary } = await import("./services/underwritingEnhancedService");
      const summary = await getPortfolioUnderwritingSummary();
      res.json({ summary });
    } catch (error) {
      console.error("Get portfolio summary error:", error);
      res.status(500).json({ error: "Failed to get portfolio summary" });
    }
  });

  // POST /api/underwriting/analyze - Quick analysis endpoint
  const quickAnalysisSchema = z.object({
    claimAmount: z.number().positive(),
    attachedAssetsValue: z.number().min(0),
    vassaleesAnnualRevenue: z.number().min(0),
    riskManagementCoverage: z.number().min(0),
    parties: z.array(z.object({
      expectedCollectionPct: z.number().min(0).max(100).optional(),
    })).optional(),
  });

  app.post("/api/underwriting/analyze", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const validation = quickAnalysisSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid input", details: validation.error });
      }

      const { computeUnderwritingMetrics } = await import("./services/underwritingService");
      const { calculateRiskScore, runMonteCarloSimulation } = await import("./services/underwritingEnhancedService");

      const caseInput = {
        title: "Quick Analysis",
        primaryDebtorName: "",
        claimAmount: validation.data.claimAmount,
        attachedAssetsValue: validation.data.attachedAssetsValue,
        vassaleesAnnualRevenue: validation.data.vassaleesAnnualRevenue,
        riskManagementCoverage: validation.data.riskManagementCoverage,
      };

      const parties = validation.data.parties?.map(p => ({
        name: "",
        role: "other" as const,
        expectedCollectionPct: p.expectedCollectionPct ?? 50,
      })) || [];

      const metrics = computeUnderwritingMetrics(caseInput, parties);

      // Quick risk factors based on input
      const factors = {
        claimToAssetRatio: validation.data.claimAmount / Math.max(1, validation.data.attachedAssetsValue) * 100,
        collectionProbability: parties.length > 0 
          ? parties.reduce((sum, p) => sum + (p.expectedCollectionPct || 50), 0) / parties.length
          : 50,
        debtorFinancialHealth: 50,
        assetLiquidity: 50,
        lienPositionStrength: 50,
        jurisdictionFavorability: 50,
        documentationQuality: 50,
        marketConditions: 50,
        industryRisk: 50,
        economicConditions: 50,
      };

      const riskScore = calculateRiskScore(factors);
      riskScore.monteCarloResults = runMonteCarloSimulation(riskScore.recoveryProbability);

      res.json({
        metrics,
        riskScore,
        monteCarlo: riskScore.monteCarloResults,
      });
    } catch (error) {
      console.error("Quick analysis error:", error);
      res.status(500).json({ error: "Failed to analyze" });
    }
  });

  // ===== INVESTOR MEMBERSHIP ROUTES =====
  
  // GET /api/investor/membership/prices - Get membership prices
  app.get("/api/investor/membership/prices", authMiddleware, async (_req: AuthRequest, res) => {
    try {
      const stripe = await getUncachableStripeClient();
      
      // Find products with investor_membership metadata
      const products = await stripe.products.search({
        query: "metadata['type']:'investor_membership' AND active:'true'"
      });

      const pricesWithProducts = await Promise.all(
        products.data.map(async (product) => {
          const prices = await stripe.prices.list({ 
            product: product.id, 
            active: true,
            limit: 1
          });
          
          const price = prices.data[0];
          const tier = product.metadata.tier || 'standard';
          
          return {
            productId: product.id,
            priceId: price?.id,
            name: product.name,
            description: product.description,
            tier,
            amount: price?.unit_amount || 0,
            currency: price?.currency || 'usd',
            interval: price?.recurring?.interval || 'month'
          };
        })
      );

      res.json({ prices: pricesWithProducts });
    } catch (error) {
      console.error("Get membership prices error:", error);
      res.status(500).json({ error: "Failed to get membership prices" });
    }
  });

  // POST /api/investor/membership/checkout - Create checkout session
  app.post("/api/investor/membership/checkout", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { tier } = req.body;
      if (!tier || !['standard', 'premium'].includes(tier)) {
        return res.status(400).json({ error: "Invalid tier. Must be 'standard' or 'premium'" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.role !== 'investor') {
        return res.status(403).json({ error: "Only investors can purchase memberships" });
      }

      const stripe = await getUncachableStripeClient();

      // Find the product for this tier
      const products = await stripe.products.search({
        query: `metadata['type']:'investor_membership' AND metadata['tier']:'${tier}' AND active:'true'`
      });

      if (products.data.length === 0) {
        return res.status(404).json({ error: `No ${tier} membership product found` });
      }

      const product = products.data[0];
      const prices = await stripe.prices.list({ 
        product: product.id, 
        active: true,
        limit: 1
      });

      if (prices.data.length === 0) {
        return res.status(404).json({ error: `No price found for ${tier} membership` });
      }

      const priceId = prices.data[0].id;

      // Create or get Stripe customer
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.name,
          metadata: {
            userId: userId.toString(),
            role: 'investor'
          }
        });
        customerId = customer.id;
        
        // Update user with customer ID
        await db.update(users)
          .set({ stripeCustomerId: customerId })
          .where(eq(users.id, userId));
      }

      // Create checkout session
      const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{
          price: priceId,
          quantity: 1
        }],
        success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/membership`,
        metadata: {
          userId: userId.toString(),
          tier
        },
        subscription_data: {
          metadata: {
            userId: userId.toString(),
            tier
          }
        }
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (error) {
      console.error("Checkout error:", error);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  // GET /api/stripe/publishable-key - Get Stripe publishable key
  app.get("/api/stripe/publishable-key", async (_req, res) => {
    try {
      const key = await getStripePublishableKey();
      res.json({ publishableKey: key });
    } catch (error) {
      console.error("Get publishable key error:", error);
      res.status(500).json({ error: "Failed to get Stripe configuration" });
    }
  });

  // ===== INVESTOR EXCHANGE ROUTES =====
  // Middleware to require investor role
  const investorAuthMiddleware = (req: AuthRequest, res: any, next: any) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const token = authHeader.substring(7);
      const decoded = verifyToken(token);
      
      if (!decoded) {
        return res.status(401).json({ error: "Invalid token" });
      }
      
      if (decoded.role !== "investor" && decoded.role !== "admin") {
        return res.status(403).json({ error: "Forbidden - Investor access required" });
      }

      req.user = decoded;
      next();
    } catch (error: any) {
      console.error("Investor auth error:", error.message);
      res.status(401).json({ error: "Invalid token" });
    }
  };

  // GET /api/investor/overview - Aggregated bond totals for investors
  app.get("/api/investor/overview", investorAuthMiddleware, async (_req: AuthRequest, res) => {
    try {
      const totals = await getInvestorOverview();
      res.json({ totals });
    } catch (error) {
      console.error("Get investor overview error:", error);
      res.status(500).json({ error: "Failed to get investor overview" });
    }
  });

  // GET /api/investor/auctions - List active auctions
  app.get("/api/investor/auctions", investorAuthMiddleware, async (_req: AuthRequest, res) => {
    try {
      const now = new Date();

      const rows = await db
        .select({
          id: auctions.id,
          status: auctions.status,
          startsAt: auctions.startsAt,
          endsAt: auctions.endsAt,
          reservePrice: auctions.reservePrice,
        })
        .from(auctions)
        .where(
          and(
            eq(auctions.status, "ACTIVE"),
            lt(auctions.startsAt, now),
            gt(auctions.endsAt, now)
          )
        );

      res.json({ auctions: rows });
    } catch (error) {
      console.error("Get investor auctions error:", error);
      res.status(500).json({ error: "Failed to get auctions" });
    }
  });

  // GET /api/investor/auctions/:id - Get auction details with highest bid
  app.get("/api/investor/auctions/:id", investorAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const auctionId = parseInt(req.params.id);
      if (isNaN(auctionId)) {
        return res.status(400).json({ error: "Invalid auction ID" });
      }

      const [auction] = await db
        .select()
        .from(auctions)
        .where(eq(auctions.id, auctionId));

      if (!auction) {
        return res.status(404).json({ error: "Auction not found" });
      }

      const [highestBid] = await db
        .select()
        .from(auctionBids)
        .where(eq(auctionBids.auctionId, auction.id))
        .orderBy(desc(auctionBids.amount))
        .limit(1);

      res.json({
        auction: {
          id: auction.id,
          status: auction.status,
          startsAt: auction.startsAt,
          endsAt: auction.endsAt,
          reservePrice: auction.reservePrice,
          highestBid: highestBid ? highestBid.amount : null,
        },
      });
    } catch (error) {
      console.error("Get auction details error:", error);
      res.status(500).json({ error: "Failed to get auction details" });
    }
  });

  // POST /api/investor/auctions/:id/bids - Place a bid on an auction
  const placeBidSchema = z.object({
    amount: z.number().positive("Bid amount must be positive"),
  });

  app.post("/api/investor/auctions/:id/bids", investorAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const investorId = req.user!.id;
      const auctionId = parseInt(req.params.id);
      
      if (isNaN(auctionId)) {
        return res.status(400).json({ error: "Invalid auction ID" });
      }

      const validation = placeBidSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Bid amount must be a positive number" });
      }

      const { amount } = validation.data;

      const [auction] = await db
        .select()
        .from(auctions)
        .where(eq(auctions.id, auctionId));

      if (!auction) {
        return res.status(404).json({ error: "Auction not found" });
      }

      const now = new Date();
      if (
        auction.status !== "ACTIVE" ||
        now < auction.startsAt ||
        now > auction.endsAt
      ) {
        return res.status(400).json({ error: "Auction is not open for bidding" });
      }

      const [highestBid] = await db
        .select()
        .from(auctionBids)
        .where(eq(auctionBids.auctionId, auction.id))
        .orderBy(desc(auctionBids.amount))
        .limit(1);

      const currentHighest = highestBid ? Number(highestBid.amount) : 0;
      const minBid = currentHighest + 1;

      if (amount < minBid) {
        return res.status(400).json({
          error: `Bid must be at least ${minBid}`,
          currentHighest,
        });
      }

      const [bid] = await db
        .insert(auctionBids)
        .values({
          auctionId: auction.id,
          investorId,
          amount: amount.toString(),
        })
        .returning();

      const reservePrice = Number(auction.reservePrice);
      const reserveMet = amount >= reservePrice;

      if (reserveMet) {
        await db
          .update(auctions)
          .set({
            status: "COMPLETED",
            winningBidId: bid.id,
            updatedAt: new Date(),
          })
          .where(eq(auctions.id, auction.id));

        // Create trade record for settlement flow
        const trade = await createTradeFromAuction(auction.id);

        return res.json({
          bid,
          message: "Reserve met. Auction completed. Trade created for settlement.",
          trade: trade ? {
            id: trade.id,
            status: trade.status,
            amount: trade.amount,
          } : null,
        });
      }

      res.json({
        bid,
        message: "Bid placed successfully.",
      });
    } catch (error) {
      console.error("Place bid error:", error);
      res.status(500).json({ error: "Failed to place bid" });
    }
  });

  // GET /api/investor/my-bids - List bids for the logged-in investor
  app.get("/api/investor/my-bids", investorAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const investorId = req.user!.id;

      const rows = await db
        .select({
          id: auctionBids.id,
          auctionId: auctionBids.auctionId,
          amount: auctionBids.amount,
          placedAt: auctionBids.placedAt,
        })
        .from(auctionBids)
        .where(eq(auctionBids.investorId, investorId));

      res.json({ bids: rows });
    } catch (error) {
      console.error("Get my bids error:", error);
      res.status(500).json({ error: "Failed to get bids" });
    }
  });

  // POST /api/admin/bonds/:id/perfect - Admin endpoint to perfect a bond and create auction
  app.post("/api/admin/bonds/:id/perfect", adminAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const bondId = parseInt(req.params.id);
      if (isNaN(bondId)) {
        return res.status(400).json({ error: "Invalid bond ID" });
      }

      const { reservePrice, auctionDurationDays } = req.body;
      
      if (!reservePrice || typeof reservePrice !== "number" || reservePrice <= 0) {
        return res.status(400).json({ error: "Reserve price must be a positive number" });
      }

      const auction = await handleBondPerfected(bondId, reservePrice, auctionDurationDays);
      res.json({ auction, message: "Bond perfected and auction created" });
    } catch (error: any) {
      console.error("Perfect bond error:", error);
      res.status(500).json({ error: error.message || "Failed to perfect bond" });
    }
  });

  // ===== DOCUMENT ENGINE - ADMIN ONLY =====
  // These routes generate legal documents for every step of the bond process
  // Only ADMIN users can generate documents

  // GET /api/admin/docs/steps - Get available bond process steps and their document types
  app.get("/api/admin/docs/steps", adminAuthMiddleware, async (_req: AuthRequest, res) => {
    try {
      const steps = getAvailableSteps();
      res.json({ steps });
    } catch (error) {
      console.error("Get document steps error:", error);
      res.status(500).json({ error: "Failed to get document steps" });
    }
  });

  // POST /api/admin/bonds/:bondId/generate-docs - Generate documents for a bond at a specific process step
  const generateDocsSchema = z.object({
    step: z.enum(ALLOWED_STEPS as [string, ...string[]]),
    suretyCaseId: z.number().optional(),
    trustId: z.number().optional(),
    auctionId: z.number().optional(),
    investorId: z.number().optional(),
  });

  app.post("/api/admin/bonds/:bondId/generate-docs", adminAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const bondId = parseInt(req.params.bondId);
      if (isNaN(bondId)) {
        return res.status(400).json({ error: "Invalid bond ID" });
      }

      const validation = generateDocsSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          error: "Invalid request",
          details: validation.error.errors,
          allowedSteps: ALLOWED_STEPS
        });
      }

      const { step, suretyCaseId, trustId, auctionId, investorId } = validation.data;

      const docs = await generateDocsForBondStep({
        bondId,
        step: step as BondProcessStep,
        suretyCaseId,
        trustId,
        auctionId,
        investorId,
      });

      // Save document records to database
      for (const doc of docs) {
        await db.insert(bondProcessDocuments).values({
          bondId,
          generatedBy: req.user!.id,
          processStep: step,
          docType: doc.docType,
          storagePath: doc.storagePath,
          filename: doc.storagePath.split("/").pop() || doc.docType,
          status: "DRAFT",
          suretyCaseId,
          suretyTrustId: trustId,
          auctionId,
          metadata: {},
        });
      }

      res.json({ 
        docs,
        message: `Generated ${docs.length} document(s) for step: ${step}`
      });
    } catch (error: any) {
      console.error("Generate documents error:", error);
      res.status(500).json({ error: error.message || "Failed to generate documents" });
    }
  });

  // GET /api/admin/bonds/:bondId/documents - Get all generated documents for a bond
  app.get("/api/admin/bonds/:bondId/documents", adminAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const bondId = parseInt(req.params.bondId);
      if (isNaN(bondId)) {
        return res.status(400).json({ error: "Invalid bond ID" });
      }

      const docs = await db
        .select()
        .from(bondProcessDocuments)
        .where(eq(bondProcessDocuments.bondId, bondId))
        .orderBy(desc(bondProcessDocuments.createdAt));

      res.json({ documents: docs });
    } catch (error) {
      console.error("Get bond documents error:", error);
      res.status(500).json({ error: "Failed to get bond documents" });
    }
  });

  // GET /api/admin/bonds/:bondId/documents/:docId - Download a specific document
  app.get("/api/admin/bonds/:bondId/documents/:docId", adminAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const bondId = parseInt(req.params.bondId);
      const docId = parseInt(req.params.docId);
      
      if (isNaN(bondId) || isNaN(docId)) {
        return res.status(400).json({ error: "Invalid ID" });
      }

      const [doc] = await db
        .select()
        .from(bondProcessDocuments)
        .where(
          and(
            eq(bondProcessDocuments.bondId, bondId),
            eq(bondProcessDocuments.id, docId)
          )
        );

      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Construct full file path
      const filePath = path.join(process.cwd(), doc.storagePath.replace(/^\//, ""));
      
      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        return res.status(404).json({ error: "Document file not found on disk" });
      }

      // Send the file
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${doc.filename}"`);
      const fileStream = require("fs").createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error) {
      console.error("Download document error:", error);
      res.status(500).json({ error: "Failed to download document" });
    }
  });

  // PATCH /api/admin/bonds/:bondId/documents/:docId - Update document status
  app.patch("/api/admin/bonds/:bondId/documents/:docId", adminAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const bondId = parseInt(req.params.bondId);
      const docId = parseInt(req.params.docId);
      
      if (isNaN(bondId) || isNaN(docId)) {
        return res.status(400).json({ error: "Invalid ID" });
      }

      const { status } = req.body;
      if (!["DRAFT", "FINAL", "SIGNED", "ARCHIVED"].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be DRAFT, FINAL, SIGNED, or ARCHIVED" });
      }

      const [updated] = await db
        .update(bondProcessDocuments)
        .set({ status })
        .where(
          and(
            eq(bondProcessDocuments.bondId, bondId),
            eq(bondProcessDocuments.id, docId)
          )
        )
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Document not found" });
      }

      res.json({ document: updated });
    } catch (error) {
      console.error("Update document error:", error);
      res.status(500).json({ error: "Failed to update document" });
    }
  });

  // ===== DOCUMENT ENGINE ENHANCEMENTS - DUE DILIGENCE & EMAIL =====

  // GET /api/bonds/:id/due-diligence - Generate due diligence pack metadata
  app.get("/api/bonds/:id/due-diligence", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const bondId = parseInt(req.params.id);
      if (isNaN(bondId)) {
        return res.status(400).json({ error: "Invalid bond ID" });
      }

      const { generateDueDiligencePack } = await import("./services/documentEmailService");
      const pack = await generateDueDiligencePack(bondId);

      if (!pack) {
        return res.status(404).json({ error: "Bond not found" });
      }

      res.json({ 
        metadata: pack.metadata,
        documents: pack.documents.map(d => ({
          name: d.name,
          type: d.type,
          size: d.size,
          summary: d.summary,
        })),
        generatedAt: pack.generatedAt,
      });
    } catch (error) {
      console.error("Get due diligence error:", error);
      res.status(500).json({ error: "Failed to generate due diligence pack" });
    }
  });

  // POST /api/bonds/:id/due-diligence/zip - Generate ZIP file of due diligence pack
  app.post("/api/bonds/:id/due-diligence/zip", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const bondId = parseInt(req.params.id);
      if (isNaN(bondId)) {
        return res.status(400).json({ error: "Invalid bond ID" });
      }

      const { createDueDiligenceZip } = await import("./services/documentEmailService");
      const zipPath = await createDueDiligenceZip(bondId);

      if (!zipPath) {
        return res.status(404).json({ error: "Bond not found" });
      }

      res.json({ 
        message: "Due diligence ZIP created",
        zipPath,
        downloadUrl: `/api/admin/bonds/${bondId}/due-diligence/download`,
      });
    } catch (error) {
      console.error("Create due diligence ZIP error:", error);
      res.status(500).json({ error: "Failed to create ZIP" });
    }
  });

  // POST /api/bonds/:id/due-diligence/send - Email due diligence pack to investor
  app.post("/api/bonds/:id/due-diligence/send", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const bondId = parseInt(req.params.id);
      if (isNaN(bondId)) {
        return res.status(400).json({ error: "Invalid bond ID" });
      }

      const { investorEmail, investorName } = req.body;
      if (!investorEmail || !investorName) {
        return res.status(400).json({ error: "investorEmail and investorName required" });
      }

      const { generateDueDiligencePack, createDueDiligenceZip, sendDueDiligencePack } = 
        await import("./services/documentEmailService");

      const pack = await generateDueDiligencePack(bondId);
      if (!pack) {
        return res.status(404).json({ error: "Bond not found" });
      }

      const zipPath = await createDueDiligenceZip(bondId);
      if (!zipPath) {
        return res.status(500).json({ error: "Failed to create ZIP" });
      }

      const emailMessage = sendDueDiligencePack(
        investorEmail,
        investorName,
        pack.bondName,
        zipPath
      );

      const result = await sendEmail(emailMessage);

      res.json({ 
        message: "Due diligence package sent",
        messageId: result.messageId,
      });
    } catch (error: any) {
      console.error("Send due diligence error:", error);
      res.status(500).json({ error: error.message || "Failed to send due diligence" });
    }
  });

  // POST /api/admin/email/send - Send ad-hoc email
  const adHocEmailSchema = z.object({
    to: z.string().email(),
    subject: z.string().min(1),
    html: z.string().min(1),
  });

  app.post("/api/admin/email/send", adminAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const validation = adHocEmailSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid email data", details: validation.error });
      }

      const result = await sendEmail(validation.data);
      res.json({ 
        success: true,
        messageId: result.messageId,
      });
    } catch (error: any) {
      console.error("Send email error:", error);
      res.status(500).json({ error: error.message || "Failed to send email" });
    }
  });

  // GET /api/admin/email/queue - Get email queue status
  app.get("/api/admin/email/queue", adminAuthMiddleware, async (_req: AuthRequest, res) => {
    try {
      const queue = getEmailQueue();
      res.json({
        total: queue.length,
        pending: queue.filter(e => e.status === "PENDING").length,
        sent: queue.filter(e => e.status === "SENT").length,
        failed: queue.filter(e => e.status === "FAILED").length,
        queue: queue.slice(-20), // Last 20 items
      });
    } catch (error) {
      console.error("Get email queue error:", error);
      res.status(500).json({ error: "Failed to get email queue" });
    }
  });

  // POST /api/admin/email/process-queue - Process pending emails
  app.post("/api/admin/email/process-queue", adminAuthMiddleware, async (_req: AuthRequest, res) => {
    try {
      const result = await processEmailQueue();
      res.json({ 
        processed: result.processed,
        failed: result.failed,
      });
    } catch (error: any) {
      console.error("Process email queue error:", error);
      res.status(500).json({ error: error.message || "Failed to process queue" });
    }
  });

  // POST /api/admin/auctions/close-expired - Admin endpoint to close expired auctions
  app.post("/api/admin/auctions/close-expired", adminAuthMiddleware, async (_req: AuthRequest, res) => {
    try {
      const closedCount = await closeExpiredAuctions();
      res.json({ closedCount, message: `Closed ${closedCount} expired auctions` });
    } catch (error) {
      console.error("Close expired auctions error:", error);
      res.status(500).json({ error: "Failed to close expired auctions" });
    }
  });

  // ===== SURETY SYSTEM ROUTES =====
  // PIN-protected admin middleware for surety operations
  const suretyPinMiddleware = (req: AuthRequest, res: any, next: any) => {
    const pin = req.headers["x-surety-pin"] as string;
    const configuredPin = process.env.SURETY_ADMIN_PIN;
    
    if (!configuredPin) {
      console.warn("SURETY_ADMIN_PIN not configured - surety routes disabled");
      return res.status(503).json({ error: "Surety system not configured" });
    }
    
    if (!pin || pin !== configuredPin) {
      return res.status(403).json({ error: "Invalid surety PIN" });
    }
    
    next();
  };

  // GET /api/admin/surety/trusts - List all surety trusts
  app.get("/api/admin/surety/trusts", adminAuthMiddleware, suretyPinMiddleware, async (_req: AuthRequest, res) => {
    try {
      const trusts = await getAllSuretyTrusts();
      res.json({ trusts });
    } catch (error) {
      console.error("Get surety trusts error:", error);
      res.status(500).json({ error: "Failed to get surety trusts" });
    }
  });

  // POST /api/admin/surety/trusts - Create a new surety trust
  app.post("/api/admin/surety/trusts", adminAuthMiddleware, suretyPinMiddleware, async (req: AuthRequest, res) => {
    try {
      const { name, trustType, maxSingleBondLimit, aggregateBondLimit, requiresInsuranceAbove, notes } = req.body;
      
      if (!name || !maxSingleBondLimit || !aggregateBondLimit) {
        return res.status(400).json({ 
          error: "Name, maxSingleBondLimit, and aggregateBondLimit are required" 
        });
      }

      const trust = await createSuretyTrust({
        name,
        trustType,
        maxSingleBondLimit: parseFloat(maxSingleBondLimit),
        aggregateBondLimit: parseFloat(aggregateBondLimit),
        requiresInsuranceAbove: requiresInsuranceAbove ? parseFloat(requiresInsuranceAbove) : undefined,
        notes
      });

      res.status(201).json({ trust });
    } catch (error) {
      console.error("Create surety trust error:", error);
      res.status(500).json({ error: "Failed to create surety trust" });
    }
  });

  // GET /api/admin/surety/trusts/:id - Get surety trust by ID
  app.get("/api/admin/surety/trusts/:id", adminAuthMiddleware, suretyPinMiddleware, async (req: AuthRequest, res) => {
    try {
      const trustId = parseInt(req.params.id);
      if (isNaN(trustId)) {
        return res.status(400).json({ error: "Invalid trust ID" });
      }

      const trust = await getSuretyTrustById(trustId);
      if (!trust) {
        return res.status(404).json({ error: "Trust not found" });
      }

      res.json({ trust });
    } catch (error) {
      console.error("Get surety trust error:", error);
      res.status(500).json({ error: "Failed to get surety trust" });
    }
  });

  // PATCH /api/admin/surety/trusts/:id - Update a surety trust
  app.patch("/api/admin/surety/trusts/:id", adminAuthMiddleware, suretyPinMiddleware, async (req: AuthRequest, res) => {
    try {
      const trustId = parseInt(req.params.id);
      if (isNaN(trustId)) {
        return res.status(400).json({ error: "Invalid trust ID" });
      }

      const trust = await updateSuretyTrust(trustId, req.body);
      if (!trust) {
        return res.status(404).json({ error: "Trust not found" });
      }

      res.json({ trust });
    } catch (error) {
      console.error("Update surety trust error:", error);
      res.status(500).json({ error: "Failed to update surety trust" });
    }
  });

  // GET /api/admin/surety/cases - List all surety cases
  app.get("/api/admin/surety/cases", adminAuthMiddleware, suretyPinMiddleware, async (_req: AuthRequest, res) => {
    try {
      const cases = await getAllSuretyCases();
      res.json({ cases });
    } catch (error) {
      console.error("Get surety cases error:", error);
      res.status(500).json({ error: "Failed to get surety cases" });
    }
  });

  // GET /api/admin/surety/cases/:id - Get surety case by ID
  app.get("/api/admin/surety/cases/:id", adminAuthMiddleware, suretyPinMiddleware, async (req: AuthRequest, res) => {
    try {
      const caseId = parseInt(req.params.id);
      if (isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case ID" });
      }

      const suretyCase = await getSuretyCaseById(caseId);
      if (!suretyCase) {
        return res.status(404).json({ error: "Case not found" });
      }

      res.json({ case: suretyCase });
    } catch (error) {
      console.error("Get surety case error:", error);
      res.status(500).json({ error: "Failed to get surety case" });
    }
  });

  // POST /api/admin/surety/underwrite - Run surety underwriting on a bond
  app.post("/api/admin/surety/underwrite", adminAuthMiddleware, suretyPinMiddleware, async (req: AuthRequest, res) => {
    try {
      const { bondId, suretyTrustId, bondPenalSum, principalRiskScore, principalId } = req.body;
      
      if (!bondId || !suretyTrustId || !bondPenalSum || principalRiskScore === undefined) {
        return res.status(400).json({ 
          error: "bondId, suretyTrustId, bondPenalSum, and principalRiskScore are required" 
        });
      }

      const underwritingResult = await computeSuretyUnderwriting({
        bondId: parseInt(bondId),
        suretyTrustId: parseInt(suretyTrustId),
        bondPenalSum: parseFloat(bondPenalSum),
        principalRiskScore: parseFloat(principalRiskScore),
        principalId: principalId ? parseInt(principalId) : undefined
      });

      // Create the surety case with underwriting result
      const suretyCase = await createSuretyCase(
        {
          bondId: parseInt(bondId),
          suretyTrustId: parseInt(suretyTrustId),
          bondPenalSum: parseFloat(bondPenalSum),
          principalRiskScore: parseFloat(principalRiskScore),
          principalId: principalId ? parseInt(principalId) : undefined
        },
        req.user!.id,
        underwritingResult
      );

      res.status(201).json({ 
        underwritingResult, 
        case: suretyCase 
      });
    } catch (error: any) {
      console.error("Surety underwriting error:", error);
      res.status(500).json({ error: error.message || "Failed to run surety underwriting" });
    }
  });

  // POST /api/admin/surety/cases/:id/approve - Approve a surety case
  app.post("/api/admin/surety/cases/:id/approve", adminAuthMiddleware, suretyPinMiddleware, async (req: AuthRequest, res) => {
    try {
      const caseId = parseInt(req.params.id);
      if (isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case ID" });
      }

      const approved = await approveSuretyCase(caseId);
      if (!approved) {
        return res.status(404).json({ error: "Case not found" });
      }

      res.json({ case: approved, message: "Surety case approved" });
    } catch (error) {
      console.error("Approve surety case error:", error);
      res.status(500).json({ error: "Failed to approve surety case" });
    }
  });

  // POST /api/admin/surety/cases/:id/decline - Decline a surety case
  app.post("/api/admin/surety/cases/:id/decline", adminAuthMiddleware, suretyPinMiddleware, async (req: AuthRequest, res) => {
    try {
      const caseId = parseInt(req.params.id);
      if (isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case ID" });
      }

      const { reason } = req.body;
      const declined = await declineSuretyCase(caseId, reason);
      if (!declined) {
        return res.status(404).json({ error: "Case not found" });
      }

      res.json({ case: declined, message: "Surety case declined" });
    } catch (error) {
      console.error("Decline surety case error:", error);
      res.status(500).json({ error: "Failed to decline surety case" });
    }
  });

  // POST /api/admin/surety/cases/:id/collateral - Record collateral posted
  app.post("/api/admin/surety/cases/:id/collateral", adminAuthMiddleware, suretyPinMiddleware, async (req: AuthRequest, res) => {
    try {
      const caseId = parseInt(req.params.id);
      if (isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case ID" });
      }

      const { collateralType, amount, ilocBankName, ilocReference } = req.body;
      
      if (!collateralType || !amount) {
        return res.status(400).json({ error: "collateralType and amount are required" });
      }

      if (!["CASH", "ILOC"].includes(collateralType)) {
        return res.status(400).json({ error: "collateralType must be CASH or ILOC" });
      }

      await recordCollateralPosted(
        caseId,
        collateralType,
        parseFloat(amount),
        { bankName: ilocBankName, reference: ilocReference }
      );

      const updatedCase = await getSuretyCaseById(caseId);
      res.json({ case: updatedCase, message: "Collateral recorded" });
    } catch (error: any) {
      console.error("Record collateral error:", error);
      res.status(500).json({ error: error.message || "Failed to record collateral" });
    }
  });

  // POST /api/admin/surety/cases/:id/activate - Activate a surety case
  app.post("/api/admin/surety/cases/:id/activate", adminAuthMiddleware, suretyPinMiddleware, async (req: AuthRequest, res) => {
    try {
      const caseId = parseInt(req.params.id);
      if (isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case ID" });
      }

      const activated = await activateSuretyCase(caseId);
      if (!activated) {
        return res.status(404).json({ error: "Case not found" });
      }

      res.json({ case: activated, message: "Surety case activated" });
    } catch (error) {
      console.error("Activate surety case error:", error);
      res.status(500).json({ error: "Failed to activate surety case" });
    }
  });

  // POST /api/admin/surety/cases/:id/release - Release a surety case
  app.post("/api/admin/surety/cases/:id/release", adminAuthMiddleware, suretyPinMiddleware, async (req: AuthRequest, res) => {
    try {
      const caseId = parseInt(req.params.id);
      if (isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case ID" });
      }

      const released = await releaseSuretyCase(caseId);
      if (!released) {
        return res.status(404).json({ error: "Case not found" });
      }

      res.json({ case: released, message: "Surety case released" });
    } catch (error) {
      console.error("Release surety case error:", error);
      res.status(500).json({ error: "Failed to release surety case" });
    }
  });

  // Enhanced surety routes - Claims, Reconciliations, and Reporting
  const claimSchema = z.object({
    claimType: z.enum(["PRINCIPAL_DEFAULT", "INTEREST_DEFAULT", "CUSTOMER_CLAIM", "REGULATORY_FINE", "OTHER"]),
    claimAmount: z.number().positive(),
    claimDescription: z.string().min(1),
    claimantName: z.string().min(1),
    incidentDate: z.string().optional(),
    filedDate: z.string().optional(),
  });

  // POST /api/admin/surety/claims - File a surety claim
  app.post("/api/admin/surety/cases/:id/claims", adminAuthMiddleware, suretyPinMiddleware, async (req: AuthRequest, res) => {
    try {
      const caseId = parseInt(req.params.id);
      if (isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case ID" });
      }

      const validation = claimSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid claim data", details: validation.error });
      }

      const { fileSuretyClaim } = await import("./services/suretyEnhancedService");
      const claim = await fileSuretyClaim({
        caseId,
        claimType: validation.data.claimType,
        claimAmount: validation.data.claimAmount,
        claimDescription: validation.data.claimDescription,
        claimantName: validation.data.claimantName,
        incidentDate: validation.data.incidentDate ? new Date(validation.data.incidentDate) : undefined,
        filedDate: validation.data.filedDate ? new Date(validation.data.filedDate) : undefined,
      });

      res.status(201).json({ claim, message: "Claim filed successfully" });
    } catch (error: any) {
      console.error("File claim error:", error);
      res.status(400).json({ error: error.message || "Failed to file claim" });
    }
  });

  // GET /api/admin/surety/cases/:id/claims - Get claims for a case
  app.get("/api/admin/surety/cases/:id/claims", adminAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const caseId = parseInt(req.params.id);
      if (isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case ID" });
      }

      const { getSuretyClaims } = await import("./services/suretyEnhancedService");
      const claims = await getSuretyClaims(caseId);
      res.json({ claims });
    } catch (error) {
      console.error("Get claims error:", error);
      res.status(500).json({ error: "Failed to get claims" });
    }
  });

  // POST /api/admin/surety/claims/:id/approve - Approve and pay a claim
  app.post("/api/admin/surety/claims/:id/approve", adminAuthMiddleware, suretyPinMiddleware, async (req: AuthRequest, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const { paidAmount } = req.body;

      if (!paidAmount || paidAmount <= 0) {
        return res.status(400).json({ error: "Valid paidAmount required" });
      }

      const { approveSuretyClaim } = await import("./services/suretyEnhancedService");
      const claim = await approveSuretyClaim(claimId, paidAmount);

      if (!claim) {
        return res.status(404).json({ error: "Claim not found" });
      }

      res.json({ claim, message: "Claim approved and paid" });
    } catch (error: any) {
      console.error("Approve claim error:", error);
      res.status(400).json({ error: error.message || "Failed to approve claim" });
    }
  });

  // POST /api/admin/surety/trusts/:id/reconcile - Run reconciliation for a trust
  app.post("/api/admin/surety/trusts/:id/reconcile", adminAuthMiddleware, suretyPinMiddleware, async (req: AuthRequest, res) => {
    try {
      const trustId = parseInt(req.params.id);
      if (isNaN(trustId)) {
        return res.status(400).json({ error: "Invalid trust ID" });
      }

      const { periodStart, periodEnd } = req.body;
      if (!periodStart || !periodEnd) {
        return res.status(400).json({ error: "periodStart and periodEnd required" });
      }

      const { createReconciliation } = await import("./services/suretyEnhancedService");
      const reconciliation = await createReconciliation(
        trustId,
        new Date(periodStart),
        new Date(periodEnd)
      );

      res.json({ reconciliation });
    } catch (error: any) {
      console.error("Create reconciliation error:", error);
      res.status(400).json({ error: error.message || "Failed to create reconciliation" });
    }
  });

  // GET /api/admin/surety/trusts/:id/reconciliations - Get reconciliations for a trust
  app.get("/api/admin/surety/trusts/:id/reconciliations", adminAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const trustId = parseInt(req.params.id);
      if (isNaN(trustId)) {
        return res.status(400).json({ error: "Invalid trust ID" });
      }

      const { getReconciliations } = await import("./services/suretyEnhancedService");
      const reconciliations = await getReconciliations(trustId);
      res.json({ reconciliations });
    } catch (error) {
      console.error("Get reconciliations error:", error);
      res.status(500).json({ error: "Failed to get reconciliations" });
    }
  });

  // GET /api/admin/surety/trusts/:id/exposure - Get detailed exposure report for a trust
  app.get("/api/admin/surety/trusts/:id/exposure", adminAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const trustId = parseInt(req.params.id);
      if (isNaN(trustId)) {
        return res.status(400).json({ error: "Invalid trust ID" });
      }

      const { generateTrustExposureReport } = await import("./services/suretyEnhancedService");
      const report = await generateTrustExposureReport(trustId);

      if (!report) {
        return res.status(404).json({ error: "Trust not found" });
      }

      res.json({ report });
    } catch (error) {
      console.error("Generate exposure report error:", error);
      res.status(500).json({ error: "Failed to generate exposure report" });
    }
  });

  // GET /api/admin/surety/portfolio - Get portfolio-level surety summary
  app.get("/api/admin/surety/portfolio", adminAuthMiddleware, async (_req: AuthRequest, res) => {
    try {
      const { getSuretyPortfolioReport } = await import("./services/suretyEnhancedService");
      const report = await getSuretyPortfolioReport();
      res.json({ report });
    } catch (error) {
      console.error("Get portfolio report error:", error);
      res.status(500).json({ error: "Failed to get portfolio report" });
    }
  });

  // ===== TRADE AND SETTLEMENT ROUTES =====
  // Trade routes for bond purchase settlement flow

  // GET /api/investor/trades - List trades for the logged-in investor
  app.get("/api/investor/trades", investorAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const investorId = req.user!.id;
      const { status } = req.query;

      // For now, return mock data structure (replace with DB query when table is migrated)
      const trades = await import("./services/tradeService").then(m => m.getTradesByInvestor(investorId));
      
      res.json({ 
        trades: trades.map(t => ({
          id: t.id,
          auctionId: t.auctionId,
          bondId: t.bondId,
          amount: t.amount,
          status: t.status,
          createdAt: t.createdAt,
        }))
      });
    } catch (error) {
      console.error("Get trades error:", error);
      res.status(500).json({ error: "Failed to get trades" });
    }
  });

  // GET /api/investor/trades/:id - Get trade details
  app.get("/api/investor/trades/:id", investorAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const tradeId = parseInt(req.params.id);
      if (isNaN(tradeId)) {
        return res.status(400).json({ error: "Invalid trade ID" });
      }

      const trade = await import("./services/tradeService").then(m => m.getTradeById(tradeId));
      if (!trade) {
        return res.status(404).json({ error: "Trade not found" });
      }

      // Verify investor owns this trade
      if (trade.investorId !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json({ trade });
    } catch (error) {
      console.error("Get trade error:", error);
      res.status(500).json({ error: "Failed to get trade" });
    }
  });

  // POST /api/investor/trades/:id/checkout - Create Stripe checkout for bond purchase
  app.post("/api/investor/trades/:id/checkout", investorAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const tradeId = parseInt(req.params.id);
      if (isNaN(tradeId)) {
        return res.status(400).json({ error: "Invalid trade ID" });
      }

      const trade = await import("./services/tradeService").then(m => m.getTradeById(tradeId));
      if (!trade) {
        return res.status(404).json({ error: "Trade not found" });
      }

      // Verify investor owns this trade
      if (trade.investorId !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (trade.status !== "PENDING") {
        return res.status(400).json({ error: "Trade is not pending checkout" });
      }

      // Get bond details
      const [bond] = await db
        .select({ name: bonds.name })
        .from(bonds)
        .where(eq(bonds.id, trade.bondId));

      // Create Stripe checkout session
      const stripe = await getUncachableStripeClient();
      
      const baseUrl = process.env.REPLIT_DOMAINS?.split(",")[0] 
        ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
        : `http://localhost:5000`;

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: bond?.name || "Judgment Bond",
                description: `Purchase of bond for $${trade.amount}`,
              },
              unit_amount: Math.round(parseFloat(trade.amount) * 100), // Convert to cents
            },
            quantity: 1,
          },
        ],
        metadata: {
          tradeId: String(tradeId),
          purpose: "bond_purchase",
          bondId: String(trade.bondId),
          investorId: String(trade.investorId),
        },
        success_url: `${baseUrl}/exchange/settlement?trade_id=${tradeId}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/exchange/auctions`,
      });

      // Update trade with checkout session ID
      await import("./services/tradeService").then(m => 
        m.updateTradeStatus(tradeId, "PENDING", { checkoutSessionId: session.id })
      );

      res.json({ 
        checkoutUrl: session.url,
        sessionId: session.id,
        message: "Redirect to payment to complete purchase"
      });
    } catch (error: any) {
      console.error("Checkout error:", error);
      res.status(500).json({ error: error.message || "Failed to create checkout session" });
    }
  });

  // POST /api/investor/trades/:id/settle - Manually settle a trade (for testing)
  app.post("/api/investor/trades/:id/settle", investorAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const tradeId = parseInt(req.params.id);
      if (isNaN(tradeId)) {
        return res.status(400).json({ error: "Invalid trade ID" });
      }

      const trade = await import("./services/tradeService").then(m => m.getTradeById(tradeId));
      if (!trade) {
        return res.status(404).json({ error: "Trade not found" });
      }

      // Verify investor owns this trade
      if (trade.investorId !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Update trade to PAID
      await import("./services/tradeService").then(m => 
        m.updateTradeStatus(tradeId, "PAID", { paymentIntentId: `manual-${Date.now()}` })
      );

      // Get investor details
      const [investor] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, trade.investorId));

      const [bond] = await db
        .select({ name: bonds.name })
        .from(bonds)
        .where(eq(bonds.id, trade.bondId));

      // Create settlement and ledger entries
      const settlement = await import("./services/tradeService").then(m => 
        m.createSettlement(tradeId, investor?.email || "", investor?.name || "", bond?.name || "")
      );

      res.json({ 
        message: "Trade settled successfully",
        tradeId,
        settlementId: settlement?.settlementId,
        journalId: settlement?.journalId
      });
    } catch (error: any) {
      console.error("Settle error:", error);
      res.status(500).json({ error: error.message || "Failed to settle trade" });
    }
  });

  // ===== LEDGER AND AUDIT ROUTES =====
  // These routes support the compliance spine

  // GET /api/admin/ledger/trial-balance - Get trial balance report
  app.get("/api/admin/ledger/trial-balance", adminAuthMiddleware, async (_req: AuthRequest, res) => {
    try {
      const { getTrialBalance, verifyLedgerIntegrity } = await import("./services/ledgerService");
      const trialBalance = await getTrialBalance();
      const verification = await verifyLedgerIntegrity();

      res.json({ 
        trialBalance,
        isValid: verification.valid,
        issues: verification.issues
      });
    } catch (error) {
      console.error("Get trial balance error:", error);
      res.status(500).json({ error: "Failed to get trial balance" });
    }
  });

  // GET /api/admin/ledger/journal - Get journal entries
  app.get("/api/admin/ledger/journal", adminAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const { type, startDate, endDate } = req.query;
      
      const { getJournalEntries } = await import("./services/ledgerService");
      const entries = await getJournalEntries({
        type: type as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      });

      res.json({ journalEntries: entries });
    } catch (error) {
      console.error("Get journal entries error:", error);
      res.status(500).json({ error: "Failed to get journal entries" });
    }
  });

  // GET /api/admin/audit/events - Get immutable event log
  app.get("/api/admin/audit/events", adminAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const { entityType, entityId, correlationId } = req.query;
      
      const { getEventChain, getEventsByEntity, getEventsByCorrelation } = await import("./services/immutableEventService");

      let events;
      if (correlationId) {
        events = await getEventsByCorrelation(correlationId as string);
      } else if (entityType && entityId) {
        events = await getEventsByEntity(entityType as string, entityId as string);
      } else {
        events = await getEventChain();
      }

      res.json({ events });
    } catch (error) {
      console.error("Get events error:", error);
      res.status(500).json({ error: "Failed to get events" });
    }
  });

  // POST /api/admin/audit/verify-chain - Verify hash chain integrity
  app.post("/api/admin/audit/verify-chain", adminAuthMiddleware, async (_req: AuthRequest, res) => {
    try {
      const { verifyEventChain } = await import("./services/immutableEventService");
      const { verifyLedgerIntegrity } = await import("./services/ledgerService");

      const [eventResult, ledgerResult] = await Promise.all([
        verifyEventChain(),
        verifyLedgerIntegrity(),
      ]);

      res.json({
        events: {
          valid: eventResult.valid,
          brokenAt: eventResult.brokenAt,
        },
        ledger: {
          valid: ledgerResult.valid,
          issues: ledgerResult.issues,
        },
      });
    } catch (error) {
      console.error("Verify chain error:", error);
      res.status(500).json({ error: "Failed to verify chains" });
    }
  });

  // ===== ASSIGNMENT & RIGHTS TRANSFER ROUTES =====

  // GET /api/investor/holdings - Get investor's bond holdings
  app.get("/api/investor/holdings", investorAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const { getInvestorHoldings } = await import("./services/assignmentService");
      const holdings = await getInvestorHoldings(req.user!.id);
      res.json({ holdings });
    } catch (error) {
      console.error("Get holdings error:", error);
      res.status(500).json({ error: "Failed to get holdings" });
    }
  });

  // GET /api/bonds/:id/cap-table - Get bond ownership cap table
  app.get("/api/bonds/:id/cap-table", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const bondId = parseInt(req.params.id);
      if (isNaN(bondId)) {
        return res.status(400).json({ error: "Invalid bond ID" });
      }

      const { getCapTable } = await import("./services/assignmentService");
      const capTable = await getCapTable(bondId);
      
      if (!capTable) {
        return res.status(404).json({ error: "Bond not found" });
      }

      res.json({ capTable });
    } catch (error) {
      console.error("Get cap table error:", error);
      res.status(500).json({ error: "Failed to get cap table" });
    }
  });

  // POST /api/investor/assignments/:id/transfer - Request assignment transfer
  const transferSchema = z.object({
    toInvestorId: z.number(),
    transferPercent: z.number().min(0.01).max(100),
    transferAmount: z.number().positive(),
  });

  app.post("/api/investor/assignments/:id/transfer", investorAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const assignmentId = parseInt(req.params.id);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ error: "Invalid assignment ID" });
      }

      const validation = transferSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid transfer parameters", details: validation.error });
      }

      const { requestTransfer } = await import("./services/assignmentService");
      const transfer = await requestTransfer({
        assignmentId,
        fromInvestorId: req.user!.id,
        toInvestorId: validation.data.toInvestorId,
        transferPercent: validation.data.transferPercent,
        transferAmount: validation.data.transferAmount,
      });

      res.json({ 
        transfer,
        message: "Transfer request submitted"
      });
    } catch (error: any) {
      console.error("Transfer request error:", error);
      res.status(400).json({ error: error.message || "Failed to request transfer" });
    }
  });

  // GET /api/investor/transfers/pending - Get pending transfers
  app.get("/api/investor/transfers/pending", investorAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const { getPendingTransfers } = await import("./services/assignmentService");
      const transfers = await getPendingTransfers(req.user!.id);
      res.json({ transfers });
    } catch (error) {
      console.error("Get pending transfers error:", error);
      res.status(500).json({ error: "Failed to get pending transfers" });
    }
  });

  // POST /api/admin/transfers/:id/execute - Execute approved transfer
  app.post("/api/admin/transfers/:id/execute", adminAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const transferId = parseInt(req.params.id);
      if (isNaN(transferId)) {
        return res.status(400).json({ error: "Invalid transfer ID" });
      }

      const { executeTransfer } = await import("./services/assignmentService");
      const success = await executeTransfer(transferId);

      if (!success) {
        return res.status(400).json({ error: "Transfer cannot be executed" });
      }

      res.json({ message: "Transfer executed successfully" });
    } catch (error: any) {
      console.error("Execute transfer error:", error);
      res.status(400).json({ error: error.message || "Failed to execute transfer" });
    }
  });

  // ===== DISTRIBUTION ROUTES =====

  // POST /api/admin/bonds/:id/receipt - Record receipt for distribution
  const receiptSchema = z.object({
    amount: z.number().positive(),
    description: z.string().min(1),
    receivedAt: z.string().optional(),
  });

  app.post("/api/admin/bonds/:id/receipt", adminAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const bondId = parseInt(req.params.id);
      if (isNaN(bondId)) {
        return res.status(400).json({ error: "Invalid bond ID" });
      }

      const validation = receiptSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid receipt parameters", details: validation.error });
      }

      const { recordReceipt } = await import("./services/distributionService");
      const distribution = await recordReceipt({
        bondId,
        amount: validation.data.amount,
        description: validation.data.description,
        receivedAt: validation.data.receivedAt ? new Date(validation.data.receivedAt) : undefined,
      });

      res.json({ 
        distribution,
        message: "Receipt recorded successfully"
      });
    } catch (error: any) {
      console.error("Record receipt error:", error);
      res.status(400).json({ error: error.message || "Failed to record receipt" });
    }
  });

  // POST /api/admin/distributions/:id/execute - Execute distribution to investors
  app.post("/api/admin/distributions/:id/execute", adminAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const distributionId = parseInt(req.params.id);
      if (isNaN(distributionId)) {
        return res.status(400).json({ error: "Invalid distribution ID" });
      }

      const { executeDistribution } = await import("./services/distributionService");
      const result = await executeDistribution(distributionId);

      res.json({ 
        message: "Distribution executed successfully",
        distribution: result.distribution,
        payouts: result.payouts,
      });
    } catch (error: any) {
      console.error("Execute distribution error:", error);
      res.status(400).json({ error: error.message || "Failed to execute distribution" });
    }
  });

  // GET /api/bonds/:id/distributions - Get distribution history for a bond
  app.get("/api/bonds/:id/distributions", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const bondId = parseInt(req.params.id);
      if (isNaN(bondId)) {
        return res.status(400).json({ error: "Invalid bond ID" });
      }

      const { getBondDistributions, getDistributionReport } = await import("./services/distributionService");
      const [distributions, report] = await Promise.all([
        getBondDistributions(bondId),
        getDistributionReport(bondId),
      ]);

      res.json({ distributions, report });
    } catch (error) {
      console.error("Get distributions error:", error);
      res.status(500).json({ error: "Failed to get distributions" });
    }
  });

  // GET /api/investor/distributions - Get investor's distribution history
  app.get("/api/investor/distributions", investorAuthMiddleware, async (req: AuthRequest, res) => {
    try {
      const { getInvestorDistributions } = await import("./services/distributionService");
      const distributions = await getInvestorDistributions(req.user!.id);
      res.json({ distributions });
    } catch (error) {
      console.error("Get investor distributions error:", error);
      res.status(500).json({ error: "Failed to get distributions" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
