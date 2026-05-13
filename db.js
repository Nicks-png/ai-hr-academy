const Database = require('better-sqlite3')
const path     = require('path')

const db = new Database(path.join(__dirname, 'recruitment.db'))
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

db.exec(`
  CREATE TABLE IF NOT EXISTS screenings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    vaga_id     TEXT    NOT NULL,
    vaga_titulo TEXT    NOT NULL,
    total       INTEGER DEFAULT 0,
    resultado   TEXT,
    created_at  TEXT    DEFAULT (datetime('now','localtime'))
  )
`)

db.exec(`
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

db.exec(`
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

db.exec(`
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

db.exec(`
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

// Migrações de coluna
try { db.exec(`ALTER TABLE candidates ADD COLUMN observacao TEXT`) } catch (_) {}
try { db.exec(`ALTER TABLE candidates ADD COLUMN interview_slot TEXT`) } catch (_) {}
try { db.exec(`ALTER TABLE candidate_history ADD COLUMN changed_by TEXT`) } catch (_) {}
try { db.exec(`ALTER TABLE candidate_history ADD COLUMN note TEXT`) } catch (_) {}

// Migração: remove NOT NULL do phone (permite candidatos sem telefone no CV)
{
  const cols = db.pragma('table_info(candidates)')
  const phoneCol = cols.find(c => c.name === 'phone')
  const needsMigration = phoneCol && phoneCol.notnull === 1

  if (needsMigration) {
    db.exec(`
      BEGIN;
      CREATE TABLE candidates_new (
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
        observacao       TEXT
      );
      INSERT INTO candidates_new
        SELECT id, name,
          CASE WHEN phone LIKE 'triagem_%' THEN NULL ELSE phone END,
          job_position, status, created_at, contacted_at, confirmed_at,
          ai_enabled, anos_xp, pretensao, job_id, skills, ai_score_total,
          ai_recomendacao, ai_pontos_fortes, ai_pontos_atencao, ai_resumo,
          ai_dimensoes, email, source, cv_text, answers, score, recomendacao,
          vaga_id, observacao
        FROM candidates;
      DROP TABLE candidates;
      ALTER TABLE candidates_new RENAME TO candidates;
      COMMIT;
    `)
  }
}

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
