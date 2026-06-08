const Database = require('better-sqlite3')
const bcrypt   = require('bcryptjs')
const path     = require('path')

const db = new Database(path.join(__dirname, '../recruitment.db'))
db.pragma('journal_mode = WAL')

// ── Tabelas de recrutamento ──────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS candidates (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    phone        TEXT    NOT NULL UNIQUE,
    job_position TEXT    NOT NULL,
    status       TEXT    DEFAULT 'Pendente',
    created_at   TEXT    DEFAULT (datetime('now','localtime')),
    contacted_at TEXT,
    confirmed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS messages_sent (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER,
    message      TEXT,
    sent_at      TEXT    DEFAULT (datetime('now','localtime')),
    success      INTEGER DEFAULT 0,
    error_msg    TEXT,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id)
  );
  CREATE TABLE IF NOT EXISTS messages_received (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER,
    phone        TEXT,
    message      TEXT,
    received_at  TEXT    DEFAULT (datetime('now','localtime')),
    is_read      INTEGER DEFAULT 0,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id)
  );
`)

// Migração segura: colunas novas em candidates
;['email TEXT', 'source TEXT', 'cv_text TEXT', 'answers TEXT'].forEach(col => {
  try { db.exec(`ALTER TABLE candidates ADD COLUMN ${col}`) } catch (_) {}
})
try { db.exec(`UPDATE candidates SET source='manual' WHERE source IS NULL`) } catch (_) {}

// ── Tabelas da Intranet ──────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS intranet_users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    DEFAULT 'employee',
    department    TEXT,
    avatar_url    TEXT,
    birth_date    TEXT,
    is_active     INTEGER DEFAULT 1,
    created_at    TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS intranet_posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id  INTEGER REFERENCES intranet_users(id),
    type       TEXT    DEFAULT 'news',
    title      TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    status     TEXT    DEFAULT 'pending',
    pinned     INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now','localtime')),
    updated_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS intranet_reactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER REFERENCES intranet_posts(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES intranet_users(id),
    emoji      TEXT    NOT NULL,
    created_at TEXT    DEFAULT (datetime('now','localtime')),
    UNIQUE(post_id, user_id, emoji)
  );
  CREATE TABLE IF NOT EXISTS intranet_documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id   INTEGER REFERENCES intranet_users(id),
    title       TEXT    NOT NULL,
    category    TEXT    DEFAULT 'geral',
    url         TEXT,
    content     TEXT,
    description TEXT,
    version     TEXT    DEFAULT '1.0',
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS tool_permissions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    role       TEXT    NOT NULL,
    tool_key   TEXT    NOT NULL,
    is_enabled INTEGER DEFAULT 1,
    UNIQUE(role, tool_key)
  );
  CREATE TABLE IF NOT EXISTS intranet_read_receipts (
    post_id  INTEGER REFERENCES intranet_posts(id) ON DELETE CASCADE,
    user_id  INTEGER REFERENCES intranet_users(id),
    read_at  TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY(post_id, user_id)
  );
`)

// ── Seed: admin padrão ───────────────────────────────────────────────────────
if (db.prepare('SELECT COUNT(*) as n FROM intranet_users').get().n === 0) {
  const hash = bcrypt.hashSync('admin123', 10)
  db.prepare(`
    INSERT OR IGNORE INTO intranet_users (name, email, password_hash, role, department)
    VALUES (?, ?, ?, 'admin', 'Recursos Humanos')
  `).run('Admin Pullman', 'admin@pullman.com', hash)
}

// ── Seed: permissões padrão por papel ────────────────────────────────────────
if (db.prepare('SELECT COUNT(*) as n FROM tool_permissions').get().n === 0) {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO tool_permissions (role, tool_key, is_enabled) VALUES (?,?,?)')
  const matrix = [
    ['admin',    'triagem',    1], ['admin',    'whatsapp',   1],
    ['admin',    'cursos',     1], ['admin',    'candidato',  1],
    ['admin',    'documentos', 1], ['admin',    'curriculo',  1],
    ['rh',       'triagem',    1], ['rh',       'whatsapp',   1],
    ['rh',       'cursos',     1], ['rh',       'candidato',  1],
    ['rh',       'documentos', 1], ['rh',       'curriculo',  1],
    ['manager',  'triagem',    1], ['manager',  'whatsapp',   0],
    ['manager',  'cursos',     1], ['manager',  'candidato',  0],
    ['manager',  'documentos', 1], ['manager',  'curriculo',  1],
    ['employee', 'triagem',    0], ['employee', 'whatsapp',   0],
    ['employee', 'cursos',     1], ['employee', 'candidato',  0],
    ['employee', 'documentos', 1], ['employee', 'curriculo',  1],
  ]
  matrix.forEach(([role, tool, enabled]) => ins.run(role, tool, enabled))
}

// ── Seed: post de boas-vindas ────────────────────────────────────────────────
if (db.prepare('SELECT COUNT(*) as n FROM intranet_posts').get().n === 0) {
  const admin = db.prepare('SELECT id FROM intranet_users WHERE role=?').get('admin')
  if (admin) {
    db.prepare(`
      INSERT INTO intranet_posts (author_id, type, title, content, status, pinned)
      VALUES (?, 'announcement', ?, ?, 'published', 1)
    `).run(admin.id,
      'Bem-vindos à Intranet Pullman Ibirapuera! 🎉',
      'Este é o hub central da nossa plataforma de RH. Aqui você encontra as ferramentas de recrutamento, comunicados da equipe, documentos corporativos e muito mais. Utilize a barra lateral para navegar entre as ferramentas disponíveis para o seu perfil.'
    )
  }
}

// ── Seed: candidatos de exemplo ──────────────────────────────────────────────
if (db.prepare('SELECT COUNT(*) as n FROM candidates').get().n === 0) {
  const ins = db.prepare('INSERT OR IGNORE INTO candidates (name, phone, job_position) VALUES (?,?,?)')
  ;[
    ['Ana Lima',       '5511987654321', 'Recepcionista de Hotel'],
    ['Carlos Souza',   '5511976543210', 'Camareira / Camareiro'],
    ['Maria Ferreira', '5511965432109', 'Chef de Cozinha'],
    ['João Pereira',   '5511954321098', 'Técnico de Manutenção'],
    ['Beatriz Santos', '5511943210987', 'Recepcionista de Hotel'],
    ['Lucas Oliveira', '5521998765432', 'Supervisor de A&B'],
    ['Fernanda Costa', '5521987654321', 'Programa Trainee Pullman'],
  ].forEach(r => ins.run(...r))
}

module.exports = db
