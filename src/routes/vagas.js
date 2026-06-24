'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { getVagas, getVagaById, createVaga, updateVaga, deleteVaga, PROVIDERS, getProvider, extractJSON } = require('../data/vagas')
const { auth, requireRole } = require('../middleware/auth')

function parseVaga(v) {
  const out = { ...v }
  for (const k of ['requisitos', 'diferenciais', 'competencias', 'perguntas']) {
    try { out[k] = JSON.parse(out[k]) } catch { out[k] = [] }
  }
  return out
}

// GET /api/vagas — lista pública (somente ativas)
router.get('/', async (_req, res) => {
  const lista = (await getVagas()).map(v => ({
    id:      v.id,
    titulo:  v.titulo,
    marca:   v.marca,
    salario: v.salario,
    regime:  v.regime,
  }))
  res.json(lista)
})

// GET /api/vagas/manage — todas as vagas para gestão (auth: rh/admin)
router.get('/manage', ...requireRole('rh', 'admin'), async (_req, res) => {
  try {
    const vagas = await db.all(`SELECT * FROM vagas WHERE status != 'inactive' ORDER BY titulo COLLATE NOCASE ASC`)

    // contagem de candidatos orgânicos por vaga
    const counts = await db.all(`
      SELECT job_id,
             COUNT(*) as total,
             ROUND(AVG(CASE WHEN ai_score_total > 0 THEN ai_score_total ELSE NULL END), 0) as score_medio
      FROM candidates
      WHERE source = 'organico'
      GROUP BY job_id
    `)
    const countMap = {}
    for (const r of counts) countMap[r.job_id] = r

    const result = vagas.map(v => ({
      ...parseVaga(v),
      candidatos: countMap[v.id]?.total || 0,
      score_medio: countMap[v.id]?.score_medio || null,
    }))
    res.json(result)
  } catch (err) {
    console.error('[vagas/manage]', err.message)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// GET /api/vagas/:id — detalhe completo
router.get('/:id', async (req, res) => {
  const vaga = await getVagaById(req.params.id)
  if (!vaga) return res.status(404).json({ error: 'Vaga não encontrada.' })
  res.json(parseVaga(vaga))
})

// POST /api/vagas — criar nova vaga (auth: rh/admin)
router.post('/', ...requireRole('rh', 'admin'), async (req, res) => {
  const { id, titulo, marca, descricao, requisitos, diferenciais, competencias, salario, regime, perguntas } = req.body

  if (!id || !titulo || !descricao || !requisitos || !competencias || !salario || !regime) {
    return res.status(400).json({
      error: 'Campos obrigatórios: id, titulo, descricao, requisitos, competencias, salario, regime'
    })
  }

  if (await getVagaById(id)) {
    return res.status(409).json({ error: 'ID de vaga já existe.' })
  }

  await createVaga({
    id,
    titulo,
    marca:        marca || 'Não especificado',
    descricao,
    requisitos:   Array.isArray(requisitos)   ? requisitos   : [requisitos],
    diferenciais: Array.isArray(diferenciais) ? diferenciais : (diferenciais || []),
    competencias: Array.isArray(competencias) ? competencias : [competencias],
    salario,
    regime,
    perguntas:    Array.isArray(perguntas)    ? perguntas    : [],
  })

  res.status(201).json({ message: 'Vaga criada com sucesso!', id })
})

// PATCH /api/vagas/:id/status — alternar ativa/pausada
router.patch('/:id/status', ...requireRole('rh', 'admin'), async (req, res) => {
  try {
    const vaga = await getVagaById(req.params.id)
    if (!vaga) return res.status(404).json({ error: 'Vaga não encontrada.' })
    const novoStatus = vaga.status === 'active' ? 'paused' : 'active'
    await db.run('UPDATE vagas SET status = ? WHERE id = ?', [novoStatus, req.params.id])
    res.json({ ok: true, status: novoStatus })
  } catch (err) {
    console.error('[vagas/status]', err.message)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// PUT /api/vagas/:id — atualizar vaga
router.put('/:id', ...requireRole('admin', 'rh'), async (req, res) => {
  const vaga = await getVagaById(req.params.id)
  if (!vaga) return res.status(404).json({ error: 'Vaga não encontrada.' })
  const allowed = ['titulo', 'marca', 'descricao', 'requisitos', 'diferenciais', 'competencias', 'salario', 'regime', 'perguntas']
  const fields = {}
  for (const k of allowed) {
    if (req.body[k] !== undefined) fields[k] = req.body[k]
  }
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nenhum campo para atualizar.' })
  for (const k of ['requisitos', 'diferenciais', 'competencias', 'perguntas']) {
    if (fields[k] !== undefined) fields[k] = Array.isArray(fields[k]) ? fields[k] : [fields[k]]
  }
  await updateVaga(req.params.id, fields)
  res.json({ ok: true })
})

// DELETE /api/vagas/:id — desativar vaga (soft delete)
router.delete('/:id', ...requireRole('admin'), async (req, res) => {
  const vaga = await getVagaById(req.params.id)
  if (!vaga) return res.status(404).json({ error: 'Vaga não encontrada.' })
  await deleteVaga(req.params.id)
  res.json({ ok: true })
})

// POST /api/vagas/extract — extrai dados de vaga de texto via IA
router.post('/extract', auth, async (req, res) => {
  const { texto } = req.body || {}
  if (!texto?.trim()) return res.status(400).json({ error: 'Texto do PDF vazio.' })
  if (!getProvider()) return res.status(500).json({ error: 'Nenhuma API key configurada.' })

  const prompt = `Você é um especialista em RH. Leia o documento de descrição de cargo abaixo e extraia as informações em JSON.

DOCUMENTO:
${texto.slice(0, 6000)}

Retorne APENAS o JSON abaixo, sem markdown, sem explicações:
{
  "id_sugerido": "<slug em minúsculas sem espaços, ex: recepcionista>",
  "titulo": "<título do cargo>",
  "marca": "<marca/hotel, ex: ibis · Novotel, ou vazio se não mencionado>",
  "descricao": "<resumo da função em 2-3 frases>",
  "requisitos": ["<requisito 1>", "<requisito 2>"],
  "diferenciais": ["<diferencial 1>"],
  "competencias": ["<competencia 1>", "<competencia 2>"],
  "salario": "<faixa salarial ou 'A consultar'>",
  "regime": "<ex: CLT · Escala 6x1 ou o que constar>",
  "perguntas": ["<pergunta de competência 1 para entrevista>", "<pergunta 2>", "<pergunta 3>"]
}`

  try {
    const raw  = await chamarIA(prompt)
    const data = extractJSON(raw)
    res.json(data)
  } catch (e) {
    console.error('[vagas/extract]', e.message)
    res.status(500).json({ error: e.message })
  }
})

async function chamarIA(prompt) {
  const ORDER = ['gemini', 'groq', 'openrouter'].filter(p => PROVIDERS[p].key())
  if (!ORDER.length) throw new Error('Nenhuma API key configurada.')
  for (const provider of ORDER) {
    const cfg = PROVIDERS[provider]
    try {
      let resp
      if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${cfg.key()}`
        resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 1024, responseMimeType: 'application/json' }
          })
        })
      } else {
        resp = await fetch(`${cfg.base}/chat/completions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cfg.key()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 1024 })
        })
      }
      if (!resp.ok) continue
      const d    = await resp.json()
      const text = provider === 'gemini' ? d.candidates?.[0]?.content?.parts?.[0]?.text : d.choices?.[0]?.message?.content
      if (text) return text
    } catch (e) { console.warn(`[vagas/extract] ${provider}:`, e.message) }
  }
  throw new Error('Todos os provedores falharam.')
}

module.exports = router
