import { Response } from 'express';
import path from 'path';
import fs from 'fs';
import { AuthRequest } from '../middlewares/authMiddleware.js';
import { getDb } from '../database/database.js';
import { analyzeCropImage } from '../services/aiService.js';

const uploadsDir = path.join(process.cwd(), 'uploads');

export async function analyze(req: AuthRequest, res: Response) {
    try {
        if (!req.file) return res.status(400).json({ error: "No image uploaded" });
        const { language, crop_type, mobilenet, weather_temp, weather_cond } = req.body;
        
        // Save file to uploads folder
        const fileExt = path.extname(req.file.originalname) || ".jpg";
        const filename = `crop_${Date.now()}_${Math.floor(Math.random() * 1000)}${fileExt}`;
        const filePath = path.join(uploadsDir, filename);
        await fs.promises.writeFile(filePath, req.file.buffer);
        const relativeImagePath = `/uploads/${filename}`;

        const result = await analyzeCropImage(
            req.file.buffer,
            req.file.mimetype,
            language || "en",
            mobilenet,
            weather_temp,
            weather_cond
        );
        
        const db = getDb();
        await db.run(
            `INSERT INTO history (farmer_id, crop_type, health_score, status, disease, confidence, severity, alerts, recommendation, date, image_path, weather_temp, weather_cond)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.id, crop_type || "Unknown", result.healthScore, result.status, result.disease,
                result.confidence, result.severity, JSON.stringify(result.alerts || []),
                JSON.stringify({ 
                   fertilizer: result.fertilizerRecommendation, 
                   irrigation: result.irrigationRecommendation, 
                   management: result.fieldManagementSupport, 
                   tips: result.preventionAdvice 
                }),
                new Date().toISOString(), relativeImagePath,
                weather_temp ? parseInt(weather_temp) : null,
                weather_cond || null
            ]
        );
        res.json({ success: true, result });
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ error: e.message || "Analysis failed" });
    }
}

export async function getHistory(req: AuthRequest, res: Response) {
    try {
        const db = getDb();
        const history = await db.all("SELECT * FROM history WHERE farmer_id = ? ORDER BY id DESC LIMIT 50", [req.user.id]);
        res.json({ success: true, history });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
}

export async function deleteHistoryRecord(req: AuthRequest, res: Response) {
    try {
        const db = getDb();
        const record = await db.get("SELECT image_path FROM history WHERE id = ? AND farmer_id = ?", [req.params.id, req.user.id]);
        if (!record) {
            return res.status(404).json({ error: "Record not found" });
        }
        
        // Delete image file if it exists and is on filesystem
        if (record.image_path && record.image_path !== "N/A" && record.image_path.startsWith("/uploads/")) {
            const fullImagePath = path.join(process.cwd(), record.image_path);
            if (fs.existsSync(fullImagePath)) {
                try {
                    fs.unlinkSync(fullImagePath);
                } catch (e) {
                    console.error("Failed to delete image file", e);
                }
            }
        }

        await db.run("DELETE FROM history WHERE id = ? AND farmer_id = ?", [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
}
