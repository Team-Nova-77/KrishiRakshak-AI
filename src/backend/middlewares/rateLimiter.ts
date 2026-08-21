import rateLimit from 'express-rate-limit';

// Global API Rate Limiter (100 requests per 15 mins)
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: "Too many requests from this IP. Please try again after 15 minutes."
    }
});

// Strict Auth Limiter for Register / Login (5 attempts per 15 mins)
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: "Too many login/registration attempts. Please try again after 15 minutes."
    }
});

// AI Crop Analysis Limiter (10 requests per 60 mins)
export const aiAnalysisLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: "Hourly crop analysis limit reached (10 per hour). Please wait before requesting more scans."
    }
});
