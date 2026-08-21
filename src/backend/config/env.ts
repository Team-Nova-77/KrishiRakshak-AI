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

    if (IS_PRODUCTION) {
        if (!envSecret) {
            throw new Error(
                '[KrishiRakshak AI Security Error] FATAL: JWT_SECRET environment variable is missing in production! Server start aborted.'
            );
        }
        if (INSECURE_SECRETS.includes(envSecret.toLowerCase())) {
            throw new Error(
                '[KrishiRakshak AI Security Error] FATAL: Insecure or default JWT_SECRET detected in production environment! Server start aborted.'
            );
        }
        return envSecret;
    }

    if (!envSecret || INSECURE_SECRETS.includes(envSecret.toLowerCase())) {
        const randomDevSecret = crypto.randomBytes(32).toString('hex');
        console.warn(
            `\n⚠️  [SECURITY WARNING] JWT_SECRET is missing or using an insecure fallback.`
        );
        console.warn(
            `⚠️  Generated an ephemeral dev secret for this session: "${randomDevSecret.substring(0, 8)}..."`
        );
        console.warn(
            `⚠️  Please set a strong JWT_SECRET in your .env file!\n`
        );
        return envSecret || randomDevSecret;
    }

    return envSecret;
}

export const JWT_SECRET = resolveJwtSecret();
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GROQ_API_KEY = process.env.GROQ_API_KEY;

