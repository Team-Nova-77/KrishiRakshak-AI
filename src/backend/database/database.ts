import path from 'path';

let dbInstance: any;

class MemoryDbAdapter {
  farmers: any[] = [];
  history: any[] = [];
  refresh_tokens: any[] = [];
  otp_codes: any[] = [];
  farmerIdCounter = 1;
  historyIdCounter = 1;

  exec(_sql: string) {}

  prepare(sql: string) {
    const self = this;
    const cleanSql = sql.trim().replace(/\s+/g, ' ');

    return {
      get(...params: any[]) {
        if (cleanSql.includes('FROM farmers WHERE phone =')) {
          return self.farmers.find(f => f.phone === params[0]);
        }
        if (cleanSql.includes('FROM farmers WHERE id =')) {
          return self.farmers.find(f => f.id === params[0]);
        }
        if (cleanSql.includes('FROM refresh_tokens WHERE token_hash =')) {
          return self.refresh_tokens.find(t => t.token_hash === params[0] && t.revoked === 0);
        }
        if (cleanSql.includes('FROM otp_codes WHERE phone =')) {
          const list = self.otp_codes.filter(o => o.phone === params[0]).sort((a, b) => b.id - a.id);
          return list[0];
        }
        return null;
      },
      all(...params: any[]) {
        if (cleanSql.includes('FROM history WHERE farmer_id =')) {
          return self.history.filter(h => h.farmer_id === params[0]).sort((a, b) => b.id - a.id);
        }
        return [];
      },
      run(...params: any[]) {
        if (cleanSql.includes('INSERT INTO farmers')) {
          const newFarmer = {
            id: self.farmerIdCounter++,
            name: params[0],
            phone: params[1],
            village: params[2],
            crop_type: params[3],
            password_hash: params[4],
            district: '',
            state: '',
            land_size: '',
            soil_type: '',
            farming_type: ''
          };
          self.farmers.push(newFarmer);
          return { lastInsertRowid: newFarmer.id, changes: 1 };
        }
        if (cleanSql.includes('UPDATE farmers SET name =')) {
          const f = self.farmers.find(farmer => farmer.id === params[8]);
          if (f) {
            f.name = params[0];
            f.village = params[1];
            f.crop_type = params[2];
            f.district = params[3];
            f.state = params[4];
            f.land_size = params[5];
            f.soil_type = params[6];
            f.farming_type = params[7];
          }
          return { changes: f ? 1 : 0 };
        }
        if (cleanSql.includes('INSERT INTO history')) {
          const newRecord = {
            id: self.historyIdCounter++,
            farmer_id: params[0],
            crop_type: params[1],
            health_score: params[2],
            status: params[3],
            disease: params[4],
            confidence: params[5],
            severity: params[6],
            alerts: params[7],
            recommendation: params[8],
            date: params[9],
            image_path: params[10],
            weather_temp: params[11],
            weather_cond: params[12]
          };
          self.history.push(newRecord);
          return { lastInsertRowid: newRecord.id, changes: 1 };
        }
        if (cleanSql.includes('INSERT INTO refresh_tokens')) {
          const newToken = {
            id: self.refresh_tokens.length + 1,
            farmer_id: params[0],
            token_hash: params[1],
            expires_at: params[2],
            revoked: 0,
            created_at: params[3]
          };
          self.refresh_tokens.push(newToken);
          return { lastInsertRowid: newToken.id, changes: 1 };
        }
        if (cleanSql.includes('INSERT INTO otp_codes')) {
          const newOtp = {
            id: self.otp_codes.length + 1,
            phone: params[0],
            otp_code: params[1],
            expires_at: params[2],
            verified: 0,
            created_at: params[3]
          };
          self.otp_codes.push(newOtp);
          return { lastInsertRowid: newOtp.id, changes: 1 };
        }
        if (cleanSql.includes('UPDATE refresh_tokens SET revoked = 1')) {
          const t = self.refresh_tokens.find(tok => tok.token_hash === params[0]);
          if (t) t.revoked = 1;
          return { changes: t ? 1 : 0 };
        }
        if (cleanSql.includes('DELETE FROM history WHERE id =')) {
          self.history = self.history.filter(h => !(h.id === params[0] && h.farmer_id === params[1]));
          return { changes: 1 };
        }
        return { lastInsertRowid: 1, changes: 0 };
      }
    };
  }
}

export async function initDb() {
  if (dbInstance) return getDb();

  try {
    const sqliteModule = await import('better-sqlite3');
    const Database = sqliteModule.default || sqliteModule;
    const dbPath = process.env.VERCEL
      ? path.join('/tmp', 'database.sqlite')
      : path.resolve(process.cwd(), 'database.sqlite');
    dbInstance = new Database(dbPath);
  } catch (err) {
    console.warn('[KrishiRakshak AI DB Warning] Native better-sqlite3 module loading failed on serverless Lambda. Using in-memory adapter:', err);
    dbInstance = new MemoryDbAdapter();
  }

  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS farmers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT UNIQUE,
      village TEXT,
      crop_type TEXT,
      language TEXT,
      password_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      farmer_id INTEGER,
      crop_type TEXT,
      health_score INTEGER,
      status TEXT,
      disease TEXT,
      confidence INTEGER,
      severity TEXT,
      alerts TEXT, 
      recommendation TEXT,
      date TEXT,
      image_path TEXT,
      FOREIGN KEY(farmer_id) REFERENCES farmers(id)
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      farmer_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(farmer_id) REFERENCES farmers(id)
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      verified INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
  
  try { dbInstance.exec("ALTER TABLE history ADD COLUMN weather_temp INTEGER;"); } catch (e) {}
  try { dbInstance.exec("ALTER TABLE history ADD COLUMN weather_cond TEXT;"); } catch (e) {}

  // Farmer Extended Profile Migrations
  try { dbInstance.exec("ALTER TABLE farmers ADD COLUMN district TEXT;"); } catch (e) {}
  try { dbInstance.exec("ALTER TABLE farmers ADD COLUMN state TEXT;"); } catch (e) {}
  try { dbInstance.exec("ALTER TABLE farmers ADD COLUMN land_size TEXT;"); } catch (e) {}
  try { dbInstance.exec("ALTER TABLE farmers ADD COLUMN soil_type TEXT;"); } catch (e) {}
  try { dbInstance.exec("ALTER TABLE farmers ADD COLUMN farming_type TEXT;"); } catch (e) {}

  return getDb();
}

export function getDb() {
  if (!dbInstance) {
    throw new Error('Database not initialized!');
  }
  return {
    get: async (sql: string, params: any[] = []) => {
      const stmt = dbInstance.prepare(sql);
      return stmt.get(...params);
    },
    run: async (sql: string, params: any[] = []) => {
      const stmt = dbInstance.prepare(sql);
      const info = stmt.run(...params);
      return { lastID: info.lastInsertRowid, changes: info.changes };
    },
    all: async (sql: string, params: any[] = []) => {
      const stmt = dbInstance.prepare(sql);
      return stmt.all(...params);
    },
    exec: async (sql: string) => {
      dbInstance.exec(sql);
    }
  };
}
