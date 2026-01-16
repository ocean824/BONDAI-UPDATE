// Configuration validation - fail fast if required env vars are missing
// Enhanced for enterprise-scale bond operations ($100B+ capacity)

export function validateConfig() {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Critical security: JWT secret must be set
  if (!process.env.SESSION_SECRET && !process.env.JWT_SECRET) {
    errors.push("❌ SESSION_SECRET or JWT_SECRET must be set for secure authentication");
  }

  // Database connection required
  if (!process.env.DATABASE_URL) {
    errors.push("❌ DATABASE_URL must be set for database connection");
  }

  // OpenAI integration keys (via Replit AI Integrations)
  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    console.warn("⚠️  Warning: AI integration keys not configured. AI extraction and chat features will be unavailable.");
    console.warn("   Set AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY to enable AI features.");
  }

  // Optional: FastAPI trending service
  if (!process.env.FASTAPI_BASE_URL) {
    console.warn("⚠️  Warning: FASTAPI_BASE_URL not set. Trending refresh via FastAPI will be disabled.");
  }
  
  // Payment provider configuration checks
  const paymentProvider = process.env.PAYMENT_PROVIDER || 'stripe';
  
  if (paymentProvider === 'stripe') {
    if (!process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY_REPLIT) {
      warnings.push("⚠️  Stripe secret key not configured. Payment features will be disabled until configured.");
    }
    if (!process.env.STRIPE_PUBLISHABLE_KEY && !process.env.STRIPE_PUBLISHABLE_KEY_REPLIT) {
      warnings.push("⚠️  Stripe publishable key not configured. Checkout will not work properly.");
    }
  } else if (paymentProvider === 'plaid') {
    if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
      warnings.push("⚠️  Plaid credentials not configured. ACH payments will be unavailable.");
    }
  } else if (paymentProvider === 'square') {
    if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
      warnings.push("⚠️  Square credentials not configured. Square payments will be unavailable.");
    }
  }

  // Enterprise features checks
  if (process.env.MAX_BOND_VALUE && isNaN(parseFloat(process.env.MAX_BOND_VALUE))) {
    errors.push("❌ MAX_BOND_VALUE must be a valid number");
  }

  if (process.env.REQUIRE_2FA && !['true', 'false'].includes(process.env.REQUIRE_2FA)) {
    errors.push("❌ REQUIRE_2FA must be 'true' or 'false'");
  }

  if (errors.length > 0) {
    console.error("\n🚨 Configuration validation failed:\n");
    errors.forEach(error => console.error(`  ${error}`));
    console.error("\nPlease set the required environment variables and restart the application.\n");
    process.exit(1);
  }

  // Print warnings
  if (warnings.length > 0) {
    console.warn("\n⚠️  Configuration warnings (non-critical):\n");
    warnings.forEach(warning => console.warn(`  ${warning}`));
    console.warn("");
  }

  console.log("✅ Configuration validated successfully");
}

// Enterprise payment provider configuration
export interface PaymentProviderConfig {
  provider: 'stripe' | 'plaid' | 'square' | 'mock';
  enabled: boolean;
  maxTransactionAmount: number;
  supportedCurrencies: string[];
  supportedPaymentMethods: string[];
}

export const paymentConfig = {
  provider: (process.env.PAYMENT_PROVIDER || 'stripe') as 'stripe' | 'plaid' | 'square' | 'mock',
  enabled: (process.env.PAYMENTS_ENABLED || 'true') === 'true',
  
  // Stripe configuration (primary/default)
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY_REPLIT,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY_REPLIT,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    apiVersion: '2025-08-27.basil' as const,
  },
  
  // Plaid configuration (ACH payments)
  plaid: {
    clientId: process.env.PLAID_CLIENT_ID,
    secret: process.env.PLAID_SECRET,
    environment: process.env.PLAID_ENV || 'sandbox',
    products: ['auth', 'transactions', 'identity'] as const,
  },
  
  // Square configuration (alternative payments)
  square: {
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    locationId: process.env.SQUARE_LOCATION_ID,
    environment: process.env.SQUARE_ENVIRONMENT || 'sandbox',
  },
  
  // Mock configuration (testing)
  mock: {
    enabled: process.env.USE_MOCK_PAYMENTS === 'true',
  },
};

// Enterprise transaction limits
export const enterpriseLimits = {
  maxBondValue: parseFloat(process.env.MAX_BOND_VALUE || '10000000000'), // $10B default max per bond
  maxBundleValue: parseFloat(process.env.MAX_BUNDLE_VALUE || '100000000000'), // $100B default max per bundle
  maxTransactionAmount: parseFloat(process.env.MAX_TRANSACTION_AMOUNT || '100000000'), // $100M per transaction
  requireTwoFactor: process.env.REQUIRE_2FA === 'true',
  auditRetentionDays: parseInt(process.env.AUDIT_RETENTION_DAYS || '2555'), // ~7 years for compliance
  sessionTimeoutMinutes: parseInt(process.env.SESSION_TIMEOUT_MINUTES || '60'),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100'),
};

// High availability configuration
export const haConfig = {
  enableReadReplicas: process.env.ENABLE_READ_REPLICAS === 'true',
  readReplicaUrls: (process.env.READ_REPLICA_URLS || '').split(',').filter(Boolean),
  enableCaching: process.env.ENABLE_CACHING !== 'false',
  cacheTTLSeconds: parseInt(process.env.CACHE_TTL_SECONDS || '300'), // 5 minutes
  enableCircuitBreaker: process.env.ENABLE_CIRCUIT_BREAKER !== 'false',
  circuitBreakerThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '5'),
  circuitBreakerTimeoutMs: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT_MS || '30000'), // 30 seconds
};

// Compliance configuration
export const complianceConfig = {
  kycEnabled: process.env.KYC_ENABLED === 'true',
  amlEnabled: process.env.AML_ENABLED === 'true',
  sarReportingEnabled: process.env.SAR_REPORTING_ENABLED === 'true',
  auditLogEnabled: process.env.AUDIT_LOG_ENABLED !== 'false',
  dataRetentionYears: parseInt(process.env.DATA_RETENTION_YEARS || '7'),
  geoRestrictionEnabled: process.env.GEO_RESTRICTION_ENABLED === 'true',
  allowedCountries: (process.env.ALLOWED_COUNTRIES || 'US,CA,UK,EU').split(',').map(s => s.trim()),
};

export const config = {
  jwtSecret: process.env.SESSION_SECRET || process.env.JWT_SECRET!,
  databaseUrl: process.env.DATABASE_URL!,
  
  // Payment configuration
  payment: paymentConfig,
  
  // Enterprise limits
  enterprise: enterpriseLimits,
  
  // High availability
  ha: haConfig,
  
  // Compliance
  compliance: complianceConfig,
  
  // AI Configuration
  openai: {
    baseUrl: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    enabled: !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY),
  },
  
  // FastAPI Configuration
  fastapi: {
    baseUrl: process.env.FASTAPI_BASE_URL,
    internalToken: process.env.FASTAPI_INTERNAL_TOKEN,
    enabled: !!process.env.FASTAPI_BASE_URL,
  },
  
  // Surety PIN (for admin operations)
  suretyAdminPin: process.env.SURETY_ADMIN_PIN || '123456',
  
  // Application settings
  app: {
    name: process.env.APP_NAME || 'BondAI Platform',
    environment: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000'),
    logLevel: process.env.LOG_LEVEL || 'info',
  },
};

// Type exports for use in other modules
export type PaymentProvider = 'stripe' | 'plaid' | 'square' | 'mock';
