// middleware/security.js - NEW FILE
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

// Security headers
const securityHeaders = (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
};

// Input sanitization
const sanitizeInput = (req, res, next) => {
  // Strip Mongo operator keys ($gt, $ne, $where, ...) and dotted keys from
  // user-controlled objects so a body like {"password": {"$ne": null}} or
  // {"$where": "..."} can never reach a Mongoose query unexpanded.
  const sanitizeObject = (obj) => {
    if (!obj || typeof obj !== "object") return obj;

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        obj[i] = sanitizeObject(obj[i]);
      }
      return obj;
    }

    for (const key of Object.keys(obj)) {
      if (key.startsWith("$") || key.includes(".")) {
        delete obj[key];
        continue;
      }
      if (typeof obj[key] === "string") {
        obj[key] = obj[key].replace(
          /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
          "",
        );
      } else if (typeof obj[key] === "object" && obj[key] !== null) {
        obj[key] = sanitizeObject(obj[key]);
      }
    }
    return obj;
  };

  if (req.body) sanitizeObject(req.body);
  if (req.query) sanitizeObject(req.query);
  if (req.params) sanitizeObject(req.params);
  next();
};

// Enhanced rate limiting for different endpoints
const createRateLimit = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      error: message,
      code: "RATE_LIMIT_EXCEEDED",
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

// Different rate limits for different operations.
// Previous limits (1000 req / 15 min on login) allowed roughly one request
// per second, which does not meaningfully throttle credential stuffing.
const authRateLimit = createRateLimit(
  15 * 60 * 1000,
  10,
  "Too many login attempts. Please try again in 15 minutes.",
);
// Deliberately a SEPARATE instance (own counter) from authRateLimit, even
// though both guard "auth". Police login is now two requests
// (password, then OTP) - sharing one 10-request/15min budget with /login
// meant a single retry on either step could burn through the other step's
// allowance too, and since this is keyed by IP, an entire station behind
// one NAT'd address would share that budget across every officer. The
// per-officer 5-attempt OTP lockout (see verifyPoliceOtp) is the real
// defense against guessing; this is just a broader backstop, so it can
// afford a larger budget.
const otpVerifyRateLimit = createRateLimit(
  15 * 60 * 1000,
  30,
  "Too many OTP verification attempts. Please try again in 15 minutes.",
);
const apiRateLimit = createRateLimit(
  15 * 60 * 1000,
  300,
  "Too many API requests",
);
const uploadRateLimit = createRateLimit(
  60 * 60 * 1000,
  30,
  "Too many upload attempts",
);

module.exports = {
  securityHeaders,
  sanitizeInput,
  authRateLimit,
  otpVerifyRateLimit,
  apiRateLimit,
  uploadRateLimit,
};
