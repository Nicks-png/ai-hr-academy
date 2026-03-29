'use strict'
const express = require('express')
const router  = express.Router()
const { VAGAS } = require('../data/vagas')

// GET /api/vagas — lista resumida
router.get('/', (_req, res) => {
  const lista = Object.entries(VAGAS).map(([id, v]) => ({
    id,
    titulo:  v.titulo,
    marca:   v.marca,
    salario: v.salario,
    regime:  v.regime,
  }))
  res.json(lista)
})

// GET /api/vagas/:id — detalhe completo
router.get('/:id', (req, res) => {
  const vaga = VAGAS[req.params.id]
  if (!vaga) return res.status(404).json({ error: 'Vaga não encontrada.' })
  res.json(vaga)
})

module.exports = router
