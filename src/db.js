const Database = require('better-sqlite3')
const path     = require('path')

const db = new Database(path.join(__dirname, '../recruitment.db'))
db.pragma('journal_mode = WAL')

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

// Migração segura: adicionar colunas novas sem perder dados existentes
;['email TEXT', 'source TEXT', 'cv_text TEXT', 'answers TEXT'].forEach(col => {
  try { db.exec(`ALTER TABLE candidates ADD COLUMN ${col}`) } catch (_) {}
})
try { db.exec(`UPDATE candidates SET source='manual' WHERE source IS NULL`) } catch (_) {}

// Seed data se banco estiver vazio
if (db.prepare('SELECT COUNT(*) as n FROM candidates').get().n === 0) {
  const ins = db.prepare('INSERT OR IGNORE INTO candidates (name, phone, job_position) VALUES (?,?,?)')
  ;[
    ['Ana Lima',       '5511987654321', 'Recepcionista de Hotel'],
    ['Carlos Souza',   '5511976543210', 'Camareira / Camareiro'],
    ['Maria Ferreira', '5511965432109', 'Chef de Cozinha'],
    ['João Pereira',   '5511954321098', 'Técnico de Manutenção'],
    ['Beatriz Santos', '5511943210987', 'Recepcionista de Hotel'],
    ['Lucas Oliveira', '5521998765432', 'Supervisor de A&B'],
    ['Fernanda Costa', '5521987654321', 'Programa Trainee Accor'],
  ].forEach(r => ins.run(...r))
}

module.exports = db
