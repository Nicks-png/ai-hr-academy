require('dotenv').config()
const express = require('express')
const path    = require('path')

const app  = express()
const PORT = process.env.PORT || 3000

app.use(express.json({ limit: '2mb' }))

// ── Redireciona raiz para login ────────────────────────────────────────────────
app.get('/', (_req, res) => res.redirect('/login.html'))

app.use(express.static(path.join(__dirname, 'public')))

// ── API status ────────────────────────────────────────────────────────────────
app.get('/api/status', (_req, res) => {
  const { getProvider, PROVIDERS, VAGAS } = require('./src/data/vagas')
  const provider = getProvider()
  const cfg      = provider ? PROVIDERS[provider] : null
  res.json({
    ok:       !!provider,
    provider: provider || 'nenhum',
    model:    cfg?.model || '—',
    vagas:    Object.keys(VAGAS).length,
  })
})

// ── Auth + Intranet (sem proteção global — cada rota tem seu middleware) ───────
app.use('/api/auth',  require('./src/routes/auth'))
app.use('/',          require('./src/routes/intranet'))

// ── Rotas ─────────────────────────────────────────────────────────────────────
app.use('/api/vagas', require('./src/routes/vagas'))
app.use('/api',       require('./src/routes/screen'))   // POST /api/screen
app.use('/',          require('./src/routes/voice'))
app.use('/',          require('./src/routes/whatsapp'))
app.use('/',          require('./src/routes/candidato'))

// ── WhatsApp Baileys ──────────────────────────────────────────────────────────
const wa      = require('./src/wa')
const waRoute = require('./src/routes/whatsapp')
const { processIncomingMessage, broadcastWA } = waRoute

// Baileys só inicia fora do Render (sem disco persistente para QR/auth)
if (process.env.NODE_ENV !== 'production') {
  wa.connect(processIncomingMessage, broadcastWA).catch(e =>
    console.warn('[WhatsApp] Falha ao iniciar Baileys:', e.message))
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const { getProvider, PROVIDERS } = require('./src/data/vagas')
  const provider = getProvider()
  const cfg      = provider ? PROVIDERS[provider] : null
  console.log(`\n  AI-HR Academy`)
  console.log(`  http://localhost:${PORT}`)
  console.log(`  Provedor: ${provider || 'NENHUM — configure o .env'}`)
  console.log(`  Modelo:   ${cfg?.model || '—'}`)
  console.log(`  API Key:  ${provider ? 'configurada' : 'AUSENTE — configure o .env'}\n`)
})
