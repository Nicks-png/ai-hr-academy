'use strict'
const jwt = require('jsonwebtoken')

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] JWT_SECRET não definida em produção. Defina a variável de ambiente e reinicie.')
    process.exit(1)
  }
  console.warn('[SECURITY] JWT_SECRET não definida — usando chave padrão insegura. Nunca use em produção.')
}
const SECRET = () => process.env.JWT_SECRET || 'accor-dev-secret'

function auth(req, res, next) {
  const header = req.headers.authorization || ''
  const token  = header.startsWith('Bearer ') ? header.slice(7) : header
  if (!token) return res.status(401).json({ error: 'Não autenticado.' })
  try {
    req.user = jwt.verify(token, SECRET())
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado.' })
  }
}

function requireRole(...roles) {
  return [
    auth,
    (req, res, next) => {
      if (!roles.includes(req.user.role))
        return res.status(403).json({ error: 'Acesso negado.' })
      next()
    },
  ]
}

module.exports = { auth, requireRole }
