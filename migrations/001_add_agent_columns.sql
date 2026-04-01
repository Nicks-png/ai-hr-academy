-- Migration: Adiciona colunas para o Smart HR Agent
-- Data: 2025-03-30

PRAGMA foreign_keys=OFF;

-- Adiciona colunas na tabela candidates
ALTER TABLE candidates ADD COLUMN ai_enabled INTEGER DEFAULT 1;
ALTER TABLE candidates ADD COLUMN anos_xp INTEGER DEFAULT 0;
ALTER TABLE candidates ADD COLUMN pretensao INTEGER DEFAULT 0;

-- Cria índice para melhorar performance das consultas do agente
CREATE INDEX IF NOT EXISTS idx_candidates_ai_enabled ON candidates(ai_enabled);
CREATE INDEX IF NOT EXISTS idx_candidates_phone ON candidates(phone);

PRAGMA foreign_keys=ON;
