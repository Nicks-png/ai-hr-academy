'use strict'
const express  = require('express')
const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const router   = express.Router()
const db       = require('../../db')
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

async function getTools(role) {
  const rows = await db.all(
    'SELECT tool_key FROM tool_permissions WHERE role = ? AND is_enabled = 1',
    [role]
  )
  return rows.map(r => r.tool_key)
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress
    if (checkRateLimit(ip))
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' })

    const { email, password } = req.body
    if (!email?.trim() || !password)
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' })

    const user = await db.get(
      'SELECT * FROM intranet_users WHERE email = ? AND is_active = 1',
      [email.trim().toLowerCase()]
    )

    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' })

    const payload = { id: user.id, name: user.name, email: user.email,
                      role: user.role, department: user.department }
    const token = jwt.sign(payload, SECRET(), { expiresIn: '8h' })
    const [tools, teams] = await Promise.all([
      getTools(user.role),
      db.all(
        'SELECT t.id, t.name, ut.role as team_role FROM teams t JOIN user_teams ut ON t.id = ut.team_id WHERE ut.user_id = ?',
        [user.id]
      ),
    ])

    res.json({
      token,
      user:  { id: user.id, name: user.name, email: user.email,
               role: user.role, department: user.department, avatar_url: user.avatar_url },
      tools,
      teams,
    })
  } catch (err) {
    console.error('[auth/login]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await db.get(
      'SELECT id,name,email,role,department,avatar_url FROM intranet_users WHERE id = ?',
      [req.user.id]
    )
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' })
    res.json({ user, tools: await getTools(user.role) })
  } catch (err) {
    console.error('[auth/me]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

module.exports = router
