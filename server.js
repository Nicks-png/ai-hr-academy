require('dotenv').config()
const express = require('express')
const helmet  = require('helmet')
const path    = require('path')

const app  = express()
const PORT = process.env.PORT || 3002

app.use(helmet({ contentSecurityPolicy: false }))
app.use(express.json({ limit: '20mb' }))

// ── Redireciona raiz para login ────────────────────────────────────────────────
app.get('/', (_req, res) => res.redirect('/login.html'))

app.use(express.static(path.join(__dirname, 'public')))

// ── API status ────────────────────────────────────────────────────────────────
app.get('/api/status', async (_req, res) => {
  const { getVagas, getProvider, PROVIDERS } = require('./src/data/vagas')
  const provider = getProvider()
  const cfg      = provider ? PROVIDERS[provider] : null
  res.json({
    ok:       !!provider,
    provider: provider || 'nenhum',
    model:    cfg?.model || '—',
    vagas:    (await getVagas()).length,
  })
})

// ── Configuração pública (Client ID do Azure, etc.) ──────────────────────────
app.get('/api/config', (_req, res) => {
  res.json({ azureClientId: process.env.AZURE_CLIENT_ID || null })
})

// ── Auth + Intranet (sem proteção global — cada rota tem seu middleware) ───────
app.use('/api/auth',  require('./src/routes/auth'))
app.use('/',          require('./src/routes/intranet'))

// ── Rotas ─────────────────────────────────────────────────────────────────────
app.use('/api/vagas', require('./src/routes/vagas'))
app.use('/api',       require('./src/routes/export'))
app.use('/api',       require('./src/routes/screen'))      // POST /api/screen
app.use('/api',       require('./src/routes/email'))       // POST /api/email/gerar
app.use('/api',       require('./src/routes/curriculo'))   // POST /api/curriculo/avaliar
app.use('/api',       require('./src/routes/selecao'))
app.use('/',          require('./src/routes/vagas-abertas'))
app.use('/',          require('./src/routes/voice'))
app.use('/',          require('./src/routes/whatsapp'))
app.use('/',          require('./src/routes/candidato'))

// ── Start ─────────────────────────────────────────────────────────────────────
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

  // Se não houver vagas, popular com dados de exemplo
  if (vagas.length === 0) {
    const sampleVagas = require('./src/data/sample-vagas');
    console.log('[DB] Populando tabela de vagas com dados de exemplo...');
    for (const vagaId in sampleVagas) {
      if (Object.hasOwnProperty.call(sampleVagas, vagaId)) {
        await createVaga({ id: vagaId, ...sampleVagas[vagaId] });
      }
    }
    console.log('[DB] Vagas de exemplo populadas.');
  }
})
