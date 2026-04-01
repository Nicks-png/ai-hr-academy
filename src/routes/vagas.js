'use strict'
const express = require('express')
const router  = express.Router()
const { getVagas, getVagaById, createVaga } = require('../data/vagas')

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
  if (vaga.requisitos) vaga.requisitos = JSON.parse(vaga.requisitos)
  if (vaga.diferenciais) vaga.diferenciais = JSON.parse(vaga.diferenciais)
  if (vaga.competencias) vaga.competencias = JSON.parse(vaga.competencias)
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

module.exports = router
