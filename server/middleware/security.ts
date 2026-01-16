import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import cors from "cors";

// ===== RATE LIMITING =====

// General API rate limiter
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests",
    message: "You have exceeded the rate limit. Please try again later.",
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiter for auth routes
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login/register attempts per windowMs
  message: {
    error: "Too many auth attempts",
    message: "Too many authentication attempts. Please try again in 15 minutes.",
    retryAfter: 900,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for payment/checkout routes
export const paymentRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // Limit each IP to 50 payment attempts per hour
  message: {
    error: "Too many payment attempts",
    message: "Too many payment attempts. Please try again later.",
    retryAfter: 3600,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for webhook routes
export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // High limit for webhooks (they come from Stripe, etc.)
  message: {
    error: "Too many webhook requests",
    message: "Webhook rate limit exceeded",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ===== SECURITY MIDDLEWARE =====

// Apply security headers
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.stripe.com"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

// CORS configuration
export const corsOptions: cors.CorsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
      "http://localhost:5000",
      "http://localhost:5173",
    ];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Surety-Pin"],
  exposedHeaders: ["X-Request-Id"],
  maxAge: 86400, // 24 hours
};

// ===== INPUT VALIDATION =====

export function sanitizeInput(req: Request, _res: Response, next: NextFunction) {
  // Remove null bytes from string inputs
  for (const key in req.body) {
    if (typeof req.body[key] === "string") {
      req.body[key] = req.body[key].replace(/\0/g, "");
    }
  }
  
  for (const key in req.query) {
    if (typeof req.query[key] === "string") {
      req.query[key] = (req.query[key] as string).replace(/\0/g, "");
    }
  }
  
  next();
}

// ===== ERROR HANDLING =====

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error("[ERROR]", err);

  // Handle known operational errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      statusCode: err.statusCode,
    });
  }

  // Handle validation errors
  if (err.name === "ZodError") {
    return res.status(400).json({
      error: "Validation error",
      details: JSON.parse(err.message),
    });
  }

  // Handle known error types
  if (err.message.includes("duplicate key")) {
    return res.status(409).json({
      error: "Resource already exists",
    });
  }

  if (err.message.includes("not found")) {
    return res.status(404).json({
      error: "Resource not found",
    });
  }

  // Default to 500 for unknown errors
  const isProduction = process.env.NODE_ENV === "production";
  
  res.status(500).json({
    error: isProduction ? "Internal server error" : err.message,
    ...(isProduction ? {} : { stack: err.stack }),
  });
}

// ===== REQUEST LOGGING =====

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = crypto.randomUUID().substring(0, 8);
  const start = Date.now();

  console.log(`[REQUEST] ${requestId} ${req.method} ${req.path}`);
  
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[REQUEST] ${requestId} ${req.method} ${req.path} ${res.statusCode} ${duration}ms`
    );
  });

  next();
}

// ===== SECURITY AUDIT TRAIL =====

export function logSecurityEvent(
  event: string,
  details: Record<string, unknown>,
  req: Request
) {
  console.log("[SECURITY]", JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ip: req.ip,
    userAgent: req.get("user-agent"),
    details,
  }));
}

// ===== IP WHITELISTING FOR ADMIN ROUTES =====

export function createIpWhitelistMiddleware(allowedIps: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const clientIp = req.ip || req.socket.remoteAddress;
    
    if (allowedIps.length === 0) {
      // No restriction if no IPs configured
      return next();
    }

    if (!clientIp || !allowedIps.includes(clientIp)) {
      logSecurityEvent("ip_blocked", { 
        ip: clientIp, 
        path: req.path 
      }, req);
      
      return res.status(403).json({
        error: "Access denied",
        message: "Your IP address is not authorized to access this resource",
      });
    }

    next();
  };
}
