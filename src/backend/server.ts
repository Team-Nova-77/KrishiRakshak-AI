import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { PORT } from './config/env.js';
import { initDb } from './database/database.js';
import { requireAuth } from './middlewares/authMiddleware.js';
import { apiLimiter, authLimiter, aiAnalysisLimiter } from './middlewares/rateLimiter.js';
import { register, login, logout, getMe, sendOtp, verifyOtp, refreshTokenHandler } from './controllers/authController.js';
import { analyze, getHistory, deleteHistoryRecord } from './controllers/cropController.js';
import { updateCrop, updateProfile } from './controllers/farmerController.js';

const upload = multer({ storage: multer.memoryStorage() });
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

export async function createApp() {
    const app = express();

    // Security HTTP Headers
    app.use(helmet({ contentSecurityPolicy: false }));

    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    app.use(cookieParser());

    // Restricted CORS Origin Configuration
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map(s => s.trim());
    app.use(cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
                callback(null, true);
            } else {
                callback(new Error('Cross-Origin Request Blocked by CORS Security Policy'));
            }
        },
        credentials: true
    }));

    // Global Rate Limiting for API routes
    app.use('/api', apiLimiter);

    try {
        await initDb();
        console.log('[KrishiRakshak AI] Database initialized.');
    } catch (err) {
        console.error('[KrishiRakshak AI DB Error]', err);
    }

    // Health check endpoint
    app.get('/api/health', (_req: Request, res: Response) => {
        res.json({ status: 'ok', service: 'KrishiRakshak AI', timestamp: new Date().toISOString() });
    });

    // Auth & OTP Routes
    app.post('/api/auth/send-otp', authLimiter, sendOtp);
    app.post('/api/auth/verify-otp', authLimiter, verifyOtp);
    app.post('/api/auth/refresh', refreshTokenHandler);
    app.post('/api/register', authLimiter, register);
    app.post('/api/login', authLimiter, login);
    app.post('/api/logout', logout);
    app.get('/api/me', requireAuth, getMe);

    // Crop Diagnostic Routes
    app.post('/api/analyze', aiAnalysisLimiter, requireAuth, upload.single('image'), analyze);
    app.get('/api/history', requireAuth, getHistory);
    app.delete('/api/history/:id', requireAuth, deleteHistoryRecord);

    // Farmer Profile Routes
    app.post('/api/farmer/update-crop', requireAuth, updateCrop);
    app.post('/api/farmer/update-profile', requireAuth, updateProfile);

    // Serve static uploads
    app.use('/uploads', express.static(uploadsDir));

    // Global Error Handler
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        console.error('[KrishiRakshak AI Server Error]', err);
        res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
    });

    return app;
}

async function startServer() {
    const app = await createApp();

    // Production build vs Dev Vite middleware
    const distPath = path.join(process.cwd(), 'dist');
    const isProduction = process.env.NODE_ENV === 'production' || fs.existsSync(path.join(distPath, 'index.html'));

    if (!isProduction) {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: 'spa',
        });
        app.use(vite.middlewares);
    } else {
        app.use(express.static(distPath));
        app.get('*', (_req: Request, res: Response) => {
            res.sendFile(path.join(distPath, 'index.html'));
        });
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`[KrishiRakshak AI] Server running on http://0.0.0.0:${PORT} (Mode: ${isProduction ? 'Production' : 'Development'})`);
    });
}

if (!process.env.VERCEL) {
    startServer();
}

