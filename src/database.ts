import Database from 'better-sqlite3';
import path from 'path';

let dbInstance: any;

export async function initDb() {
  const dbPath = path.resolve(process.cwd(), 'database.sqlite');
  dbInstance = new Database(dbPath);

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

  `);
  
  try {
    dbInstance.exec("ALTER TABLE history ADD COLUMN weather_temp INTEGER;");
  } catch (e) {}
  try {
    dbInstance.exec("ALTER TABLE history ADD COLUMN weather_cond TEXT;");
  } catch (e) {}
  
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
