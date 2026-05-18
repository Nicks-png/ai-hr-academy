'use strict'
const { createClient } = require('@libsql/client')
const bcrypt = require('bcryptjs')

const client = createClient(
  process.env.TURSO_DATABASE_URL
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: 'file:recruitment.db' }
)

const db = {
  get:   async (sql, args = []) => { const r = await client.execute({ sql, args }); return r.rows[0] ?? null },
  all:   async (sql, args = []) => { const r = await client.execute({ sql, args }); return r.rows },
  run:   async (sql, args = []) => { const r = await client.execute({ sql, args }); return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.rowsAffected } },
  exec:  async (sql) => { for (const s of sql.split(';').map(s => s.trim()).filter(Boolean)) await client.execute(s) },
  batch: async (stmts) => client.batch(stmts, 'write'),
}

async function init() {
  // ── Core tables ────────────────────────────────────────────────────────────
  await db.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT    NOT NULL,
      phone            TEXT    UNIQUE,
      job_position     TEXT    NOT NULL,
      status           TEXT    DEFAULT 'Pendente',
      created_at       TEXT    DEFAULT (datetime('now','localtime')),
      contacted_at     TEXT,
      confirmed_at     TEXT,
      ai_enabled       INTEGER DEFAULT 1,
      anos_xp          INTEGER DEFAULT 0,
      pretensao        INTEGER DEFAULT 0,
      job_id           TEXT,
      skills           TEXT,
      ai_score_total   INTEGER DEFAULT 0,
      ai_recomendacao  TEXT,
      ai_pontos_fortes TEXT,
      ai_pontos_atencao TEXT,
      ai_resumo        TEXT,
      ai_dimensoes     TEXT,
      email            TEXT,
      source           TEXT,
      cv_text          TEXT,
      answers          TEXT,
      score            INTEGER,
      recomendacao     TEXT,
      vaga_id          TEXT,
      observacao       TEXT,
      interview_slot   TEXT
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages_sent (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER,
      message      TEXT,
      sent_at      TEXT    DEFAULT (datetime('now','localtime')),
      success      INTEGER DEFAULT 0,
      error_msg    TEXT,
      FOREIGN KEY (candidate_id) REFERENCES candidates(id)
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages_received (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER,
      phone        TEXT,
      message      TEXT,
      received_at  TEXT    DEFAULT (datetime('now','localtime')),
      is_read      INTEGER DEFAULT 0,
      FOREIGN KEY (candidate_id) REFERENCES candidates(id)
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS screenings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vaga_id     TEXT    NOT NULL,
      vaga_titulo TEXT    NOT NULL,
      total       INTEGER DEFAULT 0,
      resultado   TEXT,
      created_at  TEXT    DEFAULT (datetime('now','localtime'))
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS interview_feedback (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL,
      interviewer  TEXT,
      pontualidade INTEGER,
      apresentacao INTEGER,
      comunicacao  INTEGER,
      tecnico      INTEGER,
      fit_cultural INTEGER,
      notas        TEXT,
      created_at   TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (candidate_id) REFERENCES candidates(id)
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS interview_schedule (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      date       TEXT    NOT NULL,
      start_time TEXT    NOT NULL,
      num_slots  INTEGER NOT NULL,
      local      TEXT,
      created_by TEXT,
      created_at TEXT    DEFAULT (datetime('now','localtime'))
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS candidate_history (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL,
      old_status   TEXT,
      new_status   TEXT    NOT NULL,
      changed_by   TEXT,
      note         TEXT,
      changed_at   TEXT    DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (candidate_id) REFERENCES candidates(id)
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS talent_pool (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL UNIQUE,
      tags         TEXT,
      notas        TEXT,
      added_by     TEXT,
      added_at     TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (candidate_id) REFERENCES candidates(id)
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS vagas (
      id          TEXT    PRIMARY KEY,
      titulo      TEXT    NOT NULL,
      marca       TEXT,
      descricao   TEXT,
      requisitos  TEXT,
      diferenciais TEXT,
      competencias TEXT,
      salario     TEXT,
      regime      TEXT,
      status      TEXT    DEFAULT 'active',
      created_at  TEXT    DEFAULT (datetime('now','localtime'))
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS reminders_sent (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id  INTEGER NOT NULL,
      type          TEXT    NOT NULL,
      schedule_date TEXT    NOT NULL,
      sent_at       TEXT    DEFAULT (datetime('now','localtime')),
      UNIQUE (candidate_id, type, schedule_date)
    )
  `)

  // ── Intranet / Auth ─────────────────────────────────────────────────────────
  await db.exec(`
    CREATE TABLE IF NOT EXISTS intranet_users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      email         TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'employee',
      department    TEXT,
      avatar_url    TEXT,
      birth_date    TEXT,
      is_active     INTEGER DEFAULT 1,
      created_at    TEXT    DEFAULT (datetime('now','localtime'))
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS intranet_posts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id  INTEGER,
      type       TEXT    DEFAULT 'news',
      title      TEXT    NOT NULL,
      content    TEXT    NOT NULL,
      status     TEXT    DEFAULT 'pending',
      pinned     INTEGER DEFAULT 0,
      created_at TEXT    DEFAULT (datetime('now','localtime')),
      updated_at TEXT    DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (author_id) REFERENCES intranet_users(id)
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS intranet_reactions (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      emoji   TEXT    NOT NULL,
      UNIQUE (post_id, user_id, emoji),
      FOREIGN KEY (post_id) REFERENCES intranet_posts(id),
      FOREIGN KEY (user_id) REFERENCES intranet_users(id)
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS intranet_read_receipts (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      UNIQUE (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES intranet_posts(id),
      FOREIGN KEY (user_id) REFERENCES intranet_users(id)
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS intranet_documents (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id   INTEGER,
      title       TEXT    NOT NULL,
      category    TEXT    DEFAULT 'geral',
      url         TEXT,
      content     TEXT,
      description TEXT,
      version     TEXT    DEFAULT '1.0',
      is_active   INTEGER DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (author_id) REFERENCES intranet_users(id)
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS tool_permissions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      role       TEXT    NOT NULL,
      tool_key   TEXT    NOT NULL,
      is_enabled INTEGER DEFAULT 1,
      UNIQUE (role, tool_key)
    )
  `)

  // ── Seeds ───────────────────────────────────────────────────────────────────
  const candCount = await db.get('SELECT COUNT(*) as n FROM candidates')
  if ((candCount?.n ?? 0) === 0) {
    for (const [name, phone, job_position] of [
      ['Ana Lima',       '5511987654321', 'Recepcionista de Hotel'],
      ['Carlos Souza',   '5511976543210', 'Camareira / Camareiro'],
      ['Maria Ferreira', '5511965432109', 'Chef de Cozinha'],
      ['João Pereira',   '5511954321098', 'Técnico de Manutenção'],
      ['Beatriz Santos', '5511943210987', 'Recepcionista de Hotel'],
      ['Lucas Oliveira', '5521998765432', 'Supervisor de A&B'],
      ['Fernanda Costa', '5521987654321', 'Programa Trainee Accor'],
    ]) {
      await db.run('INSERT OR IGNORE INTO candidates (name, phone, job_position) VALUES (?,?,?)', [name, phone, job_position])
    }
  }

  const userCount = await db.get('SELECT COUNT(*) as n FROM intranet_users')
  if ((userCount?.n ?? 0) === 0) {
    const hash1 = await bcrypt.hash('Accor@2025', 10)
    const hash2 = await bcrypt.hash('Accor@2025', 10)
    await db.run(
      'INSERT OR IGNORE INTO intranet_users (name, email, password_hash, role, department) VALUES (?,?,?,?,?)',
      ['Nicolas', 'nicolas.nog09@gmail.com', hash1, 'admin', 'TI']
    )
    await db.run(
      'INSERT OR IGNORE INTO intranet_users (name, email, password_hash, role, department) VALUES (?,?,?,?,?)',
      ['Rachel', 'rachel.nog09@gmail.com', hash2, 'admin', 'RH']
    )
  }

  const permCount = await db.get('SELECT COUNT(*) as n FROM tool_permissions')
  if ((permCount?.n ?? 0) === 0) {
    const adminTools   = ['triagem', 'selecao', 'whatsapp', 'email', 'analytics', 'talentos', 'intranet', 'admin', 'vagas', 'curriculo']
    const rhTools      = ['triagem', 'selecao', 'whatsapp', 'email', 'analytics', 'talentos', 'intranet', 'vagas']
    const managerTools = ['selecao', 'email', 'analytics', 'intranet']
    const empTools     = ['intranet']
    for (const t of adminTools)   await db.run('INSERT OR IGNORE INTO tool_permissions (role, tool_key, is_enabled) VALUES (?,?,?)', ['admin',    t, 1])
    for (const t of rhTools)      await db.run('INSERT OR IGNORE INTO tool_permissions (role, tool_key, is_enabled) VALUES (?,?,?)', ['rh',       t, 1])
    for (const t of managerTools) await db.run('INSERT OR IGNORE INTO tool_permissions (role, tool_key, is_enabled) VALUES (?,?,?)', ['manager',  t, 1])
    for (const t of empTools)     await db.run('INSERT OR IGNORE INTO tool_permissions (role, tool_key, is_enabled) VALUES (?,?,?)', ['employee', t, 1])
  }

  console.log('[DB] Inicializado com sucesso.')
}

db.init = init

module.exports = db
