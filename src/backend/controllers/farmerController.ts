import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware.js';
import { getDb } from '../database/database.js';

export async function updateCrop(req: AuthRequest, res: Response) {
    try {
        const { crop_type } = req.body;
        const db = getDb();
        await db.run("UPDATE farmers SET crop_type = ? WHERE id = ?", [crop_type, req.user.id]);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
}

export async function updateProfile(req: AuthRequest, res: Response) {
    try {
        const { name, village, crop_type, district, state, land_size, soil_type, farming_type } = req.body;
        const db = getDb();
        await db.run(
            `UPDATE farmers 
             SET name = ?, village = ?, crop_type = ?, district = ?, state = ?, land_size = ?, soil_type = ?, farming_type = ? 
             WHERE id = ?`,
            [
                (name || '').trim(),
                (village || '').trim(),
                crop_type || 'Tomato',
                (district || '').trim(),
                (state || '').trim(),
                (land_size || '').trim(),
                (soil_type || '').trim(),
                (farming_type || '').trim(),
                req.user.id
            ]
        );
        const farmer = await db.get("SELECT * FROM farmers WHERE id = ?", [req.user.id]);
        if (farmer) delete farmer.password_hash;
        res.json({ success: true, farmer });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
}
