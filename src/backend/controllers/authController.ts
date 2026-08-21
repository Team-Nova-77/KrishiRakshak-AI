import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDb } from '../database/database.js';
import { JWT_SECRET, IS_PRODUCTION } from '../config/env.js';
import { AuthRequest } from '../middlewares/authMiddleware.js';
import { normalizePhone, generateAndSaveOtp, verifyOtpCode } from '../services/otpService.js';

const ACCESS_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 15 * 60 * 1000 // 15 minutes
};

const REFRESH_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

async function issueAuthTokens(res: Response, farmer: { id: number; name: string; phone: string }) {
    const db = getDb();
    
    // Short-lived Access Token (15m)
    const accessToken = jwt.sign(
        { id: farmer.id, name: farmer.name, phone: farmer.phone, type: 'access' },
        JWT_SECRET,
        { expiresIn: '15m' }
    );

    // Long-lived Refresh Token (7d)
    const refreshToken = jwt.sign(
        { id: farmer.id, name: farmer.name, phone: farmer.phone, type: 'refresh' },
        JWT_SECRET,
        { expiresIn: '7d' }
    );

    // Hash refresh token for DB storage
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const createdAt = new Date().toISOString();

    // Revoke previous active refresh tokens for this farmer
    await db.run("UPDATE refresh_tokens SET revoked = 1 WHERE farmer_id = ?", [farmer.id]);

    // Save new refresh token in DB
    await db.run(
        "INSERT INTO refresh_tokens (farmer_id, token_hash, expires_at, revoked, created_at) VALUES (?, ?, ?, 0, ?)",
        [farmer.id, tokenHash, expiresAt, createdAt]
    );

    res.cookie('token', accessToken, ACCESS_COOKIE_OPTIONS);
    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);
}

export async function sendOtp(req: Request, res: Response) {
    try {
        const { phone } = req.body;
        if (!phone) {
            return res.status(400).json({ error: "Phone number is required" });
        }
        const result = await generateAndSaveOtp(phone);
        res.json(result);
    } catch (e: any) {
        res.status(400).json({ error: e.message || "Failed to send OTP" });
    }
}

export async function verifyOtp(req: Request, res: Response) {
    try {
        const { phone, otp } = req.body;
        if (!phone || !otp) {
            return res.status(400).json({ error: "Phone number and OTP code are required" });
        }
        const isValid = await verifyOtpCode(phone, otp);
        if (!isValid) {
            return res.status(400).json({ error: "Invalid or expired OTP code" });
        }
        res.json({ success: true, message: "OTP verified successfully" });
    } catch (e: any) {
        res.status(400).json({ error: e.message || "OTP verification failed" });
    }
}

export async function register(req: Request, res: Response) {
    try {
        const { name, phone, village, crop_type, language, password, otp } = req.body;
        
        if (!phone || !password || !name) {
            return res.status(400).json({ error: "Name, phone number, and password are required" });
        }

        const normalizedPhone = normalizePhone(phone);
        const db = getDb();
        const existing = await db.get("SELECT id FROM farmers WHERE phone = ?", [normalizedPhone]);
        if (existing) {
            return res.status(400).json({ error: "Phone number already registered" });
        }

        // Verify OTP if provided or required
        if (otp) {
            const isOtpValid = await verifyOtpCode(normalizedPhone, otp);
            if (!isOtpValid) {
                return res.status(400).json({ error: "Invalid or expired OTP code" });
            }
        }

        const hash = await bcrypt.hash(password, 10);
        const result = await db.run(
            "INSERT INTO farmers (name, phone, village, crop_type, language, password_hash) VALUES (?, ?, ?, ?, ?, ?)",
            [name.trim(), normalizedPhone, (village || '').trim(), crop_type || 'Tomato', language || 'en', hash]
        );
        
        const farmer = {
            id: result.lastID,
            name: name.trim(),
            phone: normalizedPhone,
            village: (village || '').trim(),
            crop_type: crop_type || 'Tomato',
            language: language || 'en'
        };
        
        await issueAuthTokens(res, farmer);
        res.json({ success: true, farmer });
    } catch (e: any) {
        res.status(400).json({ error: e.message || "Registration failed" });
    }
}

export async function login(req: Request, res: Response) {
    try {
        const { phone, password } = req.body;

        if (!phone || !password) {
            return res.status(400).json({ error: "Phone number and password are required" });
        }

        const normalizedPhone = normalizePhone(phone);
        const db = getDb();
        const farmer = await db.get("SELECT * FROM farmers WHERE phone = ?", [normalizedPhone]);
        if (!farmer) {
            return res.status(400).json({ error: "Invalid phone number or password" });
        }

        const valid = await bcrypt.compare(password, farmer.password_hash);
        if (!valid) {
            return res.status(400).json({ error: "Invalid phone number or password" });
        }

        delete farmer.password_hash;
        await issueAuthTokens(res, farmer);
        res.json({ success: true, farmer });
    } catch (e: any) {
        res.status(400).json({ error: e.message || "Login failed" });
    }
}

export async function refreshTokenHandler(req: Request, res: Response) {
    try {
        const refreshToken = req.cookies?.refreshToken;
        if (!refreshToken) {
            return res.status(401).json({ error: "Refresh token missing" });
        }

        let decoded: any;
        try {
            decoded = jwt.verify(refreshToken, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: "Invalid or expired refresh token" });
        }

        if (decoded.type !== 'refresh') {
            return res.status(401).json({ error: "Invalid token type" });
        }

        const db = getDb();
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

        // Check if token exists in DB and is unrevoked
        const tokenRecord = await db.get(
            "SELECT id, revoked, expires_at FROM refresh_tokens WHERE farmer_id = ? AND token_hash = ?",
            [decoded.id, tokenHash]
        );

        if (!tokenRecord || tokenRecord.revoked === 1) {
            return res.status(401).json({ error: "Refresh token revoked or invalid" });
        }

        if (new Date(tokenRecord.expires_at).getTime() < Date.now()) {
            return res.status(401).json({ error: "Refresh token expired" });
        }

        const farmer = await db.get(
            "SELECT id, name, phone, village, crop_type, language, district, state, land_size, soil_type, farming_type FROM farmers WHERE id = ?",
            [decoded.id]
        );
        if (!farmer) {
            return res.status(401).json({ error: "Farmer not found" });
        }

        // Issue new access token (15m)
        const newAccessToken = jwt.sign(
            { id: farmer.id, name: farmer.name, phone: farmer.phone, type: 'access' },
            JWT_SECRET,
            { expiresIn: '15m' }
        );

        res.cookie('token', newAccessToken, ACCESS_COOKIE_OPTIONS);
        res.json({ success: true, farmer });
    } catch (e: any) {
        res.status(500).json({ error: e.message || "Token refresh failed" });
    }
}

export async function logout(req: AuthRequest, res: Response) {
    try {
        const refreshToken = req.cookies?.refreshToken;
        if (refreshToken) {
            const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
            const db = getDb();
            await db.run("UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?", [tokenHash]);
        } else if (req.user?.id) {
            const db = getDb();
            await db.run("UPDATE refresh_tokens SET revoked = 1 WHERE farmer_id = ?", [req.user.id]);
        }
    } catch (e) {
        console.error("Error revoking refresh token on logout:", e);
    }

    res.clearCookie('token', { ...ACCESS_COOKIE_OPTIONS, maxAge: 0 });
    res.clearCookie('refreshToken', { ...REFRESH_COOKIE_OPTIONS, maxAge: 0 });
    res.json({ success: true, message: "Logged out successfully" });
}

export async function getMe(req: AuthRequest, res: Response) {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const db = getDb();
        const farmer = await db.get(
            "SELECT id, name, phone, village, crop_type, language, district, state, land_size, soil_type, farming_type FROM farmers WHERE id = ?",
            [userId]
        );
        if (!farmer) {
            return res.status(404).json({ error: "Farmer profile not found" });
        }

        res.json({ success: true, farmer });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
}


