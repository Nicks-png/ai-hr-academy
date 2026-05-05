'use strict'
const express  = require('express')
const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const router   = express.Router()
const db       = require('../db')
const { auth } = require('../middleware/auth')

const SECRET = () => process.env.JWT_SECRET || 'accor-dev-secret'

// Rate limiting simples em memória: max 10 tentativas por IP em 15 min
const loginAttempts = new Map()
function checkRateLimit(ip) {
  const now  = Date.now()
  const key  = ip || 'unknown'
  const entry = loginAttempts.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 }
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 15 * 60 * 1000 }
  entry.count++
  loginAttempts.set(key, entry)
  return entry.count > 10
}


function getTools(role) {
  return db.prepare(
    'SELECT tool_key FROM tool_permissions WHERE role = ? AND is_enabled = 1'
  ).all(role).map(r => r.tool_key)
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress
  if (checkRateLimit(ip))
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' })

  const { email, password } = req.body
  if (!email?.trim() || !password)
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' })

  const user = db.prepare(
    'SELECT * FROM intranet_users WHERE email = ? AND is_active = 1'
  ).get(email.trim().toLowerCase())

  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' })

  const payload = { id: user.id, name: user.name, email: user.email,
                    role: user.role, department: user.department }
  const token = jwt.sign(payload, SECRET(), { expiresIn: '8h' })
  const tools = getTools(user.role)

  res.json({
    token,
    user:  { id: user.id, name: user.name, email: user.email,
             role: user.role, department: user.department, avatar_url: user.avatar_url },
    tools,
  })
})

// GET /api/auth/me
router.get('/me', auth, (req, res) => {
  const user = db.prepare(
    'SELECT id,name,email,role,department,avatar_url FROM intranet_users WHERE id = ?'
  ).get(req.user.id)
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' })
  res.json({ user, tools: getTools(user.role) })
})

module.exports = router
