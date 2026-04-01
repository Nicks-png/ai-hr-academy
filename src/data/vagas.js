'use strict'

const db = require('../../db');

async function getVagas() {
  return db.prepare(`SELECT * FROM vagas WHERE status = 'active' ORDER BY titulo COLLATE NOCASE ASC`).all();
}

async function getVagaById(id) {
  return db.prepare('SELECT * FROM vagas WHERE id = ?').get(id);
}

async function createVaga(vaga) {
  const { id, titulo, marca, descricao, requisitos, diferenciais, competencias, salario, regime, status } = vaga;
  const result = db.prepare(
    'INSERT INTO vagas (id, titulo, marca, descricao, requisitos, diferenciais, competencias, salario, regime, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, titulo, marca, descricao, JSON.stringify(requisitos), JSON.stringify(diferenciais), JSON.stringify(competencias), salario, regime, status || 'active');
  return result.lastInsertRowid;
}

// TODO: Adicionar funções de atualização e remoção de vagas conforme necessário


const PESOS = { heartist: 20, tecnico: 25, experiencia: 20, disponibilidade: 20, potencial: 15 }

function calcScore(dimensoes) {
  return Math.round(
    Object.entries(PESOS).reduce((acc, [k, peso]) => {
      const score = Number(dimensoes[k]?.score) || 0
      return acc + (Math.min(10, Math.max(0, score)) * peso) / 10
    }, 0)
  )
}

function extractJSON(text) {
  if (!text) throw new Error('Resposta vazia da IA.')
  try { return JSON.parse(text) } catch (_) {}
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try { return JSON.parse(stripped) } catch (_) {}
  const match = text.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) } catch (_) {}
  }
  console.error('[extractJSON] falhou. Início da resposta:', text.slice(0, 200))
  throw new Error('A IA não retornou JSON válido. Tente novamente.')
}

const PROVIDERS = {
  gemini:     { base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', key: () => process.env.GEMINI_API_KEY },
  groq:       { base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', key: () => process.env.GROQ_API_KEY },
  openrouter: { base: 'https://openrouter.ai/api/v1', model: process.env.AI_MODEL || 'google/gemini-2.0-flash-exp:free', key: () => process.env.OPENROUTER_API_KEY },
}

function getProvider() {
  if (process.env.GEMINI_API_KEY)     return 'gemini'
  if (process.env.GROQ_API_KEY)       return 'groq'
  if (process.env.OPENROUTER_API_KEY) return 'openrouter'
  return null
}

module.exports = { getVagas, getVagaById, createVaga, PESOS, calcScore, extractJSON, PROVIDERS, getProvider }
