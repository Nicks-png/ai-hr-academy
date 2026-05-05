'use strict'
const express = require('express')
const router  = express.Router()
const { getVagas, getVagaById, createVaga, updateVaga, deleteVaga, PROVIDERS, getProvider, extractJSON } = require('../data/vagas')
const { auth, requireRole } = require('../middleware/auth')

// GET /api/vagas — lista resumida
router.get('/', async (_req, res) => {
  const lista = (await getVagas()).map(v => ({
    id: v.id,
    titulo: v.titulo,
    marca: v.marca,
    salario: v.salario,
    regime: v.regime,
  }))
  res.json(lista)
})

// GET /api/vagas/:id — detalhe completo
router.get('/:id', async (req, res) => {
  const vaga = await getVagaById(req.params.id)
  if (!vaga) return res.status(404).json({ error: 'Vaga não encontrada.' })
  // Parse JSON fields
  try { if (vaga.requisitos) vaga.requisitos = JSON.parse(vaga.requisitos) } catch { vaga.requisitos = [] }
  try { if (vaga.diferenciais) vaga.diferenciais = JSON.parse(vaga.diferenciais) } catch { vaga.diferenciais = [] }
  try { if (vaga.competencias) vaga.competencias = JSON.parse(vaga.competencias) } catch { vaga.competencias = [] }
  res.json(vaga)
})

// POST /api/vagas — criar nova vaga
router.post('/', async (req, res) => {
  const { id, titulo, marca, descricao, requisitos, diferenciais, competencias, salario, regime } = req.body

  // Validação básica
  if (!id || !titulo || !descricao || !requisitos || !competencias || !salario || !regime) {
    return res.status(400).json({
      error: 'Campos obrigatórios: id, titulo, descricao, requisitos, competencias, salario, regime'
    })
  }


  // Verificar se ID já existe
  if (await getVagaById(id)) {
    return res.status(409).json({ error: 'ID de vaga já existe.' })
  }

  // Criar nova vaga
  await createVaga({
    id,
    titulo,
    marca: marca || 'Não especificado',
    descricao,
    requisitos: Array.isArray(requisitos) ? requisitos : [requisitos],
    diferenciais: Array.isArray(diferenciais) ? diferenciais : (diferenciais || []),
    competencias: Array.isArray(competencias) ? competencias : [competencias],
    salario,
    regime,
  })

  // Retornar sucesso
  res.status(201).json({
    message: 'Vaga criada com sucesso!',
    vaga: { id, titulo, marca: marca || 'Não especificado', descricao, requisitos, diferenciais, competencias, salario, regime }
  })
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
  "regime": "<ex: CLT · Escala 6x1 ou o que constar>"
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

// PUT /api/vagas/:id — atualizar vaga
router.put('/:id', ...requireRole('admin', 'rh'), async (req, res) => {
  const vaga = await getVagaById(req.params.id)
  if (!vaga) return res.status(404).json({ error: 'Vaga não encontrada.' })
  const allowed = ['titulo', 'marca', 'descricao', 'requisitos', 'diferenciais', 'competencias', 'salario', 'regime']
  const fields = {}
  for (const k of allowed) {
    if (req.body[k] !== undefined) fields[k] = req.body[k]
  }
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nenhum campo para atualizar.' })
  // Normalizar arrays
  for (const k of ['requisitos', 'diferenciais', 'competencias']) {
    if (fields[k] !== undefined) fields[k] = Array.isArray(fields[k]) ? fields[k] : [fields[k]]
  }
  updateVaga(req.params.id, fields)
  res.json({ ok: true })
})

// DELETE /api/vagas/:id — desativar vaga (soft delete)
router.delete('/:id', ...requireRole('admin'), async (req, res) => {
  const vaga = await getVagaById(req.params.id)
  if (!vaga) return res.status(404).json({ error: 'Vaga não encontrada.' })
  deleteVaga(req.params.id)
  res.json({ ok: true })
})

module.exports = router
