import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';

export const PORT = parseInt(process.env.PORT || '3000', 10);
if (isNaN(PORT) || PORT <= 0 || PORT > 65535) {
    throw new Error(`[KrishiRakshak AI Environment Error] Invalid PORT specified in environment: ${process.env.PORT}`);
}

const INSECURE_SECRETS = [
    'hackathon_secret_krishi',
    'secret',
    'jwt_secret',
    'change_me',
    '123456',
    'replace_with_a_secure_random_jwt_secret_min_32_chars'
];

function resolveJwtSecret(): string {
    const envSecret = process.env.JWT_SECRET?.trim();

    if (!envSecret || INSECURE_SECRETS.includes(envSecret.toLowerCase())) {
        const fallbackSecret = process.env.VERCEL_GIT_COMMIT_SHA || 'krishirakshak_fallback_secure_jwt_secret_key_2026';
        console.warn(
            `\n⚠️  [SECURITY WARNING] JWT_SECRET environment variable is missing or insecure.`
        );
        console.warn(
            `⚠️  Using fallback secret for serverless session. Please configure JWT_SECRET in Vercel Environment Variables!\n`
        );
        return envSecret || fallbackSecret;
    }

    return envSecret;
}

export const JWT_SECRET = resolveJwtSecret();
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GROQ_API_KEY = process.env.GROQ_API_KEY;

