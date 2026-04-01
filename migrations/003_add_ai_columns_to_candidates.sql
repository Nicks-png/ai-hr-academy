-- Migration: Adiciona colunas de AI para triagem de currículos em candidates
-- Data: 2026-03-30

PRAGMA foreign_keys=OFF;

ALTER TABLE candidates ADD COLUMN skills TEXT;
ALTER TABLE candidates ADD COLUMN ai_score_total INTEGER DEFAULT 0;
ALTER TABLE candidates ADD COLUMN ai_recomendacao TEXT;
ALTER TABLE candidates ADD COLUMN ai_pontos_fortes TEXT;
ALTER TABLE candidates ADD COLUMN ai_pontos_atencao TEXT;
ALTER TABLE candidates ADD COLUMN ai_resumo TEXT;
ALTER TABLE candidates ADD COLUMN ai_dimensoes TEXT;

PRAGMA foreign_keys=ON;
