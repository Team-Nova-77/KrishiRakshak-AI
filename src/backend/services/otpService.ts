import crypto from 'crypto';
import { getDb } from '../database/database.js';

export function normalizePhone(rawPhone: string): string {
    const cleaned = String(rawPhone || '').trim().replace(/[\s\-\(\)]/g, '');
    
    // Indian 10-digit mobile number format fallback
    if (/^[6-9]\d{9}$/.test(cleaned)) {
        return `+91${cleaned}`;
    }
    
    // Standard E.164 format (+[country code][number])
    const e164Regex = /^\+[1-9]\d{6,14}$/;
    if (e164Regex.test(cleaned)) {
        return cleaned;
    }
    
    throw new Error('Invalid mobile phone number format. Please provide a valid 10-digit mobile number or E.164 format (+919876543210).');
}

export async function generateAndSaveOtp(rawPhone: string) {
    const phone = normalizePhone(rawPhone);
    const db = getDb();

    // 6-digit numeric OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes validity
    const createdAt = new Date().toISOString();

    await db.run(
        "INSERT INTO otp_codes (phone, otp_code, expires_at, verified, created_at) VALUES (?, ?, ?, 0, ?)",
        [phone, otpCode, expiresAt, createdAt]
    );

    console.log(`\n========================================`);
    console.log(`📱 [SMS OTP GATEWAY MOCK]`);
    console.log(`📱 Sent OTP "${otpCode}" to phone ${phone}`);
    console.log(`📱 Valid for 5 minutes.`);
    console.log(`========================================\n`);

    return {
        success: true,
        phone,
        message: `OTP sent successfully to ${phone}. (Mock OTP in dev console)`
    };
}

export async function verifyOtpCode(rawPhone: string, code: string): Promise<boolean> {
    const phone = normalizePhone(rawPhone);
    const cleanCode = String(code || '').trim();
    const db = getDb();

    const record = await db.get(
        `SELECT id, expires_at FROM otp_codes 
         WHERE phone = ? AND otp_code = ? AND verified = 0 
         ORDER BY id DESC LIMIT 1`,
        [phone, cleanCode]
    );

    if (!record) {
        return false;
    }

    const isExpired = new Date(record.expires_at).getTime() < Date.now();
    if (isExpired) {
        return false;
    }

    // Mark as verified
    await db.run("UPDATE otp_codes SET verified = 1 WHERE id = ?", [record.id]);
    return true;
}
