const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class Storage {
  constructor(dbPath = null) {
    const dataDir = path.join(process.cwd(), '.queuectl');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    this.dbPath = dbPath || path.join(dataDir, 'jobs.db');
    this.db = new Database(this.dbPath);
    this.init();
  }

  init() {
    // Create jobs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        next_retry_at TEXT,
        worker_id TEXT,
        error_message TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_state ON jobs(state);
      CREATE INDEX IF NOT EXISTS idx_next_retry ON jobs(next_retry_at);
      CREATE INDEX IF NOT EXISTS idx_worker ON jobs(worker_id);
    `);

    // Create config table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Initialize default config
    const defaultConfig = this.db.prepare('SELECT COUNT(*) as count FROM config').get();
    if (defaultConfig.count === 0) {
      const insert = this.db.prepare('INSERT INTO config (key, value) VALUES (?, ?)');
      insert.run('max_retries', '3');
      insert.run('backoff_base', '2');
    }
  }

  // Job operations
  createJob(job) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO jobs (id, command, state, attempts, max_retries, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      job.id,
      job.command,
      job.state || 'pending',
      job.attempts || 0,
      job.max_retries || 3,
      job.created_at || now,
      job.updated_at || now
    );
    return this.getJob(job.id);
  }

  getJob(id) {
    const stmt = this.db.prepare('SELECT * FROM jobs WHERE id = ?');
    const row = stmt.get(id);
    return row ? this.rowToJob(row) : null;
  }

  updateJob(id, updates) {
    const fields = [];
    const values = [];
    
    updates.updated_at = new Date().toISOString();
    
    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
    
    values.push(id);
    const stmt = this.db.prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
    return this.getJob(id);
  }

  lockJob(id, workerId) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE jobs 
      SET state = 'processing', worker_id = ?, updated_at = ?
      WHERE id = ? AND state = 'pending'
    `);
    const result = stmt.run(workerId, now, id);
    return result.changes > 0;
  }

  getNextPendingJob() {
    const stmt = this.db.prepare(`
      SELECT * FROM jobs 
      WHERE state = 'pending' 
      ORDER BY created_at ASC 
      LIMIT 1
    `);
    const row = stmt.get();
    return row ? this.rowToJob(row) : null;
  }

  getRetryableJobs() {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      SELECT * FROM jobs 
      WHERE state = 'failed' 
      AND attempts < max_retries
      AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY next_retry_at ASC
      LIMIT 1
    `);
    const row = stmt.get(now);
    return row ? this.rowToJob(row) : null;
  }

  listJobs(state = null) {
    let query = 'SELECT * FROM jobs';
    let params = [];
    
    if (state) {
      query += ' WHERE state = ?';
      params.push(state);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);
    return rows.map(row => this.rowToJob(row));
  }

  getDLQJobs() {
    const stmt = this.db.prepare("SELECT * FROM jobs WHERE state = 'dead' ORDER BY updated_at DESC");
    const rows = stmt.all();
    return rows.map(row => this.rowToJob(row));
  }

  moveToDLQ(id) {
    return this.updateJob(id, { state: 'dead', worker_id: null });
  }

  retryFromDLQ(id) {
    const job = this.getJob(id);
    if (!job || job.state !== 'dead') {
      return null;
    }
    return this.updateJob(id, {
      state: 'pending',
      attempts: 0,
      next_retry_at: null,
      error_message: null
    });
  }

  getStats() {
    const stmt = this.db.prepare(`
      SELECT 
        state,
        COUNT(*) as count
      FROM jobs
      GROUP BY state
    `);
    const rows = stmt.all();
    const stats = { pending: 0, processing: 0, completed: 0, failed: 0, dead: 0 };
    rows.forEach(row => {
      stats[row.state] = row.count;
    });
    return stats;
  }

  rowToJob(row) {
    return {
      id: row.id,
      command: row.command,
      state: row.state,
      attempts: row.attempts,
      max_retries: row.max_retries,
      created_at: row.created_at,
      updated_at: row.updated_at,
      next_retry_at: row.next_retry_at,
      worker_id: row.worker_id,
      error_message: row.error_message
    };
  }

  // Config operations
  getConfig(key) {
    const stmt = this.db.prepare('SELECT value FROM config WHERE key = ?');
    const row = stmt.get(key);
    return row ? row.value : null;
  }

  setConfig(key, value) {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
    stmt.run(key, value);
  }

  getAllConfig() {
    const stmt = this.db.prepare('SELECT key, value FROM config');
    const rows = stmt.all();
    const config = {};
    rows.forEach(row => {
      config[row.key] = row.value;
    });
    return config;
  }

  close() {
    this.db.close();
  }
}

module.exports = Storage;

