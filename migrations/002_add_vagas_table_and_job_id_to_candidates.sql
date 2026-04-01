-- Migration: Cria tabela vagas e adiciona job_id em candidates
-- Data: 2026-03-30

PRAGMA foreign_keys=OFF;

-- Tabela de vagas
CREATE TABLE IF NOT EXISTS vagas (
    id TEXT PRIMARY KEY,
    titulo TEXT NOT NULL,
    marca TEXT,
    descricao TEXT,
    requisitos TEXT,
    diferenciais TEXT,
    competencias TEXT,
    salario TEXT,
    regime TEXT,
    status TEXT DEFAULT 'active' -- active, archived
);

-- Adiciona coluna job_id em candidates
ALTER TABLE candidates ADD COLUMN job_id TEXT;

-- Adiciona FOREIGN KEY para job_id, referenciando vagas.id
-- Assume que job_id poderá ser NULL inicialmente, caso candidatos não tenham vaga associada na importação
-- Ou que vagas.id será populado antes dos candidatos
-- CREATE INDEX para otimizar buscas por vaga
CREATE INDEX IF NOT EXISTS idx_candidates_job_id ON candidates(job_id);

PRAGMA foreign_keys=ON;
