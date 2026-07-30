#!/usr/bin/env node
/**
 * Migração one-off: remove o UNIQUE global em candidates.phone e substitui
 * por um índice único composto (phone, job_id) — permite que a mesma pessoa
 * se candidate a vagas diferentes, mantendo o bloqueio de duplicata na MESMA vaga.
 *
 * Uso: node scripts/migrate_phone_unique_per_vaga.js
 */
require('dotenv').config()
const { createClient } = require('@libsql/client')

const client = createClient(
  process.env.TURSO_DATABASE_URL
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: 'file:recruitment.db' }
)

async function main() {
  const before = await client.execute('SELECT COUNT(*) as n FROM candidates')
  console.log(`Linhas em candidates antes: ${before.rows[0].n}`)

  await client.batch([
    'ALTER TABLE candidates RENAME TO candidates_old_migration',
    `CREATE TABLE candidates (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT    NOT NULL,
      phone            TEXT,
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
      interview_slot   TEXT,
      cv_pdf           TEXT,
      job_id_organico  TEXT
    )`,
    `INSERT INTO candidates (
      id, name, phone, job_position, status, created_at, contacted_at, confirmed_at,
      ai_enabled, anos_xp, pretensao, job_id, skills, ai_score_total, ai_recomendacao,
      ai_pontos_fortes, ai_pontos_atencao, ai_resumo, ai_dimensoes, email, source,
      cv_text, answers, score, recomendacao, vaga_id, observacao, interview_slot,
      cv_pdf, job_id_organico
    )
    SELECT
      id, name, phone, job_position, status, created_at, contacted_at, confirmed_at,
      ai_enabled, anos_xp, pretensao, job_id, skills, ai_score_total, ai_recomendacao,
      ai_pontos_fortes, ai_pontos_atencao, ai_resumo, ai_dimensoes, email, source,
      cv_text, answers, score, recomendacao, vaga_id, observacao, interview_slot,
      cv_pdf, job_id_organico
    FROM candidates_old_migration`,
    'CREATE UNIQUE INDEX idx_candidates_phone_job ON candidates(phone, job_id)',
    'DROP TABLE candidates_old_migration',
  ], 'write')

  const after = await client.execute('SELECT COUNT(*) as n FROM candidates')
  console.log(`Linhas em candidates depois: ${after.rows[0].n}`)

  if (Number(after.rows[0].n) !== Number(before.rows[0].n)) {
    throw new Error('Contagem de linhas não bate! Verifique candidates_old_migration antes de prosseguir.')
  }

  console.log('Migração concluída com sucesso.')
}

main().catch(err => {
  console.error('ERRO NA MIGRAÇÃO:', err)
  process.exit(1)
})
