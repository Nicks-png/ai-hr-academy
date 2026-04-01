-- Migration: Cria tabela candidate_history para registrar o histórico de status dos candidatos
-- Data: 2026-03-30

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS candidate_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER NOT NULL,
    old_status TEXT,
    new_status TEXT NOT NULL,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- user_id INTEGER, -- Opcional: para registrar quem fez a mudança
    FOREIGN KEY (candidate_id) REFERENCES candidates(id)
);

CREATE INDEX IF NOT EXISTS idx_candidate_history_candidate_id ON candidate_history(candidate_id);

PRAGMA foreign_keys=ON;
