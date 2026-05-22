import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cors from "cors";
import { initDb, getDb } from "./database.js";
import { analyzeCropImage } from "./gemini.js";
import dotenv from "dotenv";
import fs from "fs";
dotenv.config(); // It will automatically look for .env
const upload = multer({ storage: multer.memoryStorage() });
const JWT_SECRET = process.env.JWT_SECRET || "hackathon_secret_krishi";
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}


async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cors());

  await initDb();
  console.log("Database initialized.");

  // API Routes
  app.post("/api/register", async (req, res) => {
    try {
      const { name, phone, village, crop_type, language, password } = req.body;
      const db = getDb();
      const existing = await db.get("SELECT id FROM farmers WHERE phone = ?", [phone]);
      if (existing) {
        return res.status(400).json({ error: "Phone number already registered" });
      }
      const hash = await bcrypt.hash(password, 10);
      const result = await db.run(
        "INSERT INTO farmers (name, phone, village, crop_type, language, password_hash) VALUES (?, ?, ?, ?, ?, ?)",
        [name, phone, village, crop_type, language, hash]
      );
      const token = jwt.sign({ id: result.lastID, name, phone }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ success: true, token, farmer: { id: result.lastID, name, phone, village, crop_type, language } });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
  
  app.post("/api/login", async (req, res) => {
    try {
      const { phone, password } = req.body;
      const db = getDb();
      const farmer = await db.get("SELECT * FROM farmers WHERE phone = ?", [phone]);
      if (!farmer) {
        return res.status(400).json({ error: "Invalid credentials" });
      }
      const valid = await bcrypt.compare(password, farmer.password_hash);
      if (!valid) {
        return res.status(400).json({ error: "Invalid credentials" });
      }
      const token = jwt.sign({ id: farmer.id, name: farmer.name, phone }, JWT_SECRET, { expiresIn: '7d' });
      delete farmer.password_hash;
      res.json({ success: true, token, farmer });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Auth Middleware
  const requireAuth = (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
    const token = authHeader.split(' ')[1];
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  };

  // Serve Uploads statically
  app.use('/uploads', express.static(uploadsDir));

  app.post("/api/analyze", requireAuth, upload.single("image"), async (req: any, res: any) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image uploaded" });
      const { language, crop_type, mobilenet, weather_temp, weather_cond } = req.body;
      
      // Save file to uploads folder
      const fileExt = path.extname(req.file.originalname) || ".jpg";
      const filename = `crop_${Date.now()}_${Math.floor(Math.random() * 1000)}${fileExt}`;
      const filePath = path.join(uploadsDir, filename);
      await fs.promises.writeFile(filePath, req.file.buffer);
      const relativeImagePath = `/uploads/${filename}`;

      const result = await analyzeCropImage(req.file.buffer, req.file.mimetype, language || "en", mobilenet, weather_temp, weather_cond);
      
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
  });

  app.get("/api/history", requireAuth, async (req: any, res: any) => {
    try {
      const db = getDb();
      const h = await db.all("SELECT * FROM history WHERE farmer_id = ? ORDER BY id DESC LIMIT 50", [req.user.id]);
      res.json({ success: true, history: h });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/history/:id", requireAuth, async (req: any, res: any) => {
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
  });

  app.post("/api/farmer/update-crop", requireAuth, async (req: any, res: any) => {
    try {
      const { crop_type } = req.body;
      const db = getDb();
      await db.run("UPDATE farmers SET crop_type = ? WHERE id = ?", [crop_type, req.user.id]);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/farmer/update-profile", requireAuth, async (req: any, res: any) => {
    try {
      const { name, village, crop_type } = req.body;
      const db = getDb();
      await db.run(
        "UPDATE farmers SET name = ?, village = ?, crop_type = ? WHERE id = ?",
        [name, village, crop_type, req.user.id]
      );
      const farmer = await db.get("SELECT * FROM farmers WHERE id = ?", [req.user.id]);
      if (farmer) delete farmer.password_hash;
      res.json({ success: true, farmer });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });




  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
