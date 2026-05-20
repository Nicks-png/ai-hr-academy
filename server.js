require('dotenv').config()
const express = require('express')
const helmet  = require('helmet')
const path    = require('path')
const db      = require('./db')

const app  = express()
const PORT = process.env.PORT || 3002

app.use(helmet({ contentSecurityPolicy: false }))
app.use(express.json({ limit: '20mb' }))

// ── Redireciona raiz para login ────────────────────────────────────────────────
app.get('/', (_req, res) => res.redirect('/login.html'))

// ── Página pública de vaga (QR code) ─────────────────────────────────────────
app.get('/vaga/:id', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'vaga.html')))

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders (res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
      res.setHeader('Pragma', 'no-cache')
      res.setHeader('Expires', '0')
    }
  },
}))

// ── API status ────────────────────────────────────────────────────────────────
app.get('/api/status', async (_req, res) => {
  const { getVagas, getProvider, PROVIDERS } = require('./src/data/vagas')
  const provider = getProvider()
  const cfg      = provider ? PROVIDERS[provider] : null
  const keys = {
    gemini:      !!process.env.GEMINI_API_KEY,
    groq:        !!process.env.GROQ_API_KEY,
    openrouter:  !!process.env.OPENROUTER_API_KEY,
  }
  res.json({
    ok:       !!provider,
    provider: provider || 'nenhum',
    model:    cfg?.model || '—',
    vagas:    (await getVagas()).length,
    keys,
  })
})

// ── Configuração pública (Client ID do Azure, etc.) ──────────────────────────
app.get('/api/config', (_req, res) => {
  res.json({ azureClientId: process.env.AZURE_CLIENT_ID || null, redirectUri: process.env.AZURE_REDIRECT_URI || null })
})

// ── Auth + Intranet (sem proteção global — cada rota tem seu middleware) ───────
app.use('/api/auth',  require('./src/routes/auth'))
app.use('/',          require('./src/routes/intranet'))

// ── Rotas ─────────────────────────────────────────────────────────────────────
app.use('/api/vagas', require('./src/routes/vagas'))
app.use('/api',       require('./src/routes/teams'))
app.use('/api',       require('./src/routes/feedback'))
app.use('/api',       require('./src/routes/analytics'))
app.use('/api',       require('./src/routes/talentos'))
app.use('/api',       require('./src/routes/export'))
app.use('/api',       require('./src/routes/screen'))      // POST /api/screen
app.use('/api',       require('./src/routes/email'))       // POST /api/email/gerar
app.use('/api',       require('./src/routes/curriculo'))   // POST /api/curriculo/avaliar
app.use('/api',       require('./src/routes/selecao'))
app.use('/api',       require('./src/routes/interviews'))
app.use('/',          require('./src/routes/vagas-abertas'))
app.use('/',          require('./src/routes/voice'))
app.use('/',          require('./src/routes/whatsapp'))
app.use('/',          require('./src/routes/candidato'))

// ── Start ─────────────────────────────────────────────────────────────────────
const wa = require('./src/wa')

db.init().then(async () => {
  const dbMode = process.env.TURSO_DATABASE_URL ? `Turso (${process.env.TURSO_DATABASE_URL.slice(0, 40)}...)` : 'SQLite local (dados NÃO persistem entre deploys!)'
  console.log(`[DB] Modo: ${dbMode}`)

  // Candidatos que ficaram presos em 'Triando' por restart do servidor
  try {
    const stuck = await db.run(
      "UPDATE candidates SET status = 'Pendente' WHERE status = 'Triando'"
    )
    if (stuck.changes > 0)
      console.log(`[startup] ${stuck.changes} candidato(s) resetado(s) de 'Triando' → 'Pendente'`)
  } catch (e) {
    console.warn('[startup] Não foi possível resetar candidatos presos:', e.message)
  }

  app.listen(PORT, async () => {
    const { getVagas, getProvider, createVaga, PROVIDERS } = require('./src/data/vagas')
    const provider = getProvider()
    const cfg      = provider ? PROVIDERS[provider] : null
    const vagas    = await getVagas()
    console.log(`\n  AI-HR Academy`)
    console.log(`  http://localhost:${PORT}`)
    console.log(`  Provedor: ${provider || 'NENHUM — configure o .env'}`)
    console.log(`  Modelo:   ${cfg?.model || '—'}`)
    console.log(`  API Key:  ${provider ? 'configurada' : 'AUSENTE — configure o .env'}`)
    console.log(`  Vagas no DB: ${vagas.length}\n`)

    // Lembretes automáticos de entrevista (D-1 / H-2)
    const { startReminderLoop } = require('./src/reminders')
    startReminderLoop(async (phone, text) => {
      try { await wa.sendMessage(phone, text) } catch { /* WA desconectado — ignora */ }
    })

    // Se não houver vagas, popular com catálogo padrão (inclui perguntas)
    if (vagas.length === 0) {
      const { VAGAS: vagaSeed } = require('./src/data/vagas')
      console.log('[DB] Populando tabela de vagas com catálogo padrão...')
      for (const vagaId in vagaSeed) {
        if (Object.hasOwnProperty.call(vagaSeed, vagaId)) {
          await createVaga({ id: vagaId, ...vagaSeed[vagaId] })
        }
      }
      console.log('[DB] Vagas populadas.')
    }
  })
}).catch(err => {
  console.error('[DB] init falhou:', err)
  process.exit(1)
})
