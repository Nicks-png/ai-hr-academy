require('dotenv').config()
const express = require('express')
const path    = require('path')

const app   = express()
const PORT  = process.env.PORT || 3000

// Suporte a múltiplos provedores via .env
function getProvider() {
  if (process.env.GEMINI_API_KEY)     return 'gemini'
  if (process.env.GROQ_API_KEY)       return 'groq'
  if (process.env.OPENROUTER_API_KEY) return 'openrouter'
  return null
}

const PROVIDERS = {
  gemini:     { base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', key: () => process.env.GEMINI_API_KEY },
  groq:       { base: 'https://api.groq.com/openai/v1',                         model: 'llama-3.3-70b-versatile', key: () => process.env.GROQ_API_KEY },
  openrouter: { base: 'https://openrouter.ai/api/v1',                            model: process.env.AI_MODEL || 'google/gemini-2.0-flash-exp:free', key: () => process.env.OPENROUTER_API_KEY },
}

app.use(express.json({ limit: '2mb' }))
app.use(express.static(path.join(__dirname)))

// ─── Vagas Accor Brasil ────────────────────────────────────────────────────────

const VAGAS = {
  recepcionista: {
    titulo: 'Recepcionista de Hotel',
    marca: 'ibis · Mercure · Novotel',
    descricao: 'Atendimento ao hóspede no check-in/check-out, gestão de reservas via Opera PMS, resolução de solicitações e comunicação interdepartamental.',
    requisitos: ['Ensino médio completo', 'Comunicação clara e objetiva', 'Disponibilidade para turnos, fins de semana e feriados', 'Conhecimento básico em informática'],
    diferenciais: ['Inglês básico ou intermediário', 'Experiência com Opera PMS', 'Curso técnico em hotelaria ou turismo', 'Espanhol'],
    competencias: ['Orientação ao cliente', 'Trabalho em equipe', 'Atenção aos detalhes', 'Proatividade', 'Comunicação efetiva'],
    salario: 'R$ 1.921 – R$ 2.500',
    regime: 'CLT · Escala 6x1 · Turnos rotativos',
  },
  camareira: {
    titulo: 'Camareira / Camareiro',
    marca: 'ibis · ibis budget · Mercure',
    descricao: 'Limpeza e organização de apartamentos e áreas comuns, controle de enxoval e amenidades, registro de ocorrências na governança.',
    requisitos: ['Ensino fundamental completo', 'Boa condição física para trabalho em pé', 'Disponibilidade para turnos, fins de semana e feriados'],
    diferenciais: ['Experiência prévia em hotelaria ou serviços domésticos', 'Conhecimento de produtos de limpeza', 'Organização e atenção a detalhes'],
    competencias: ['Atenção aos detalhes', 'Organização', 'Autonomia', 'Trabalho em equipe', 'Resistência física'],
    salario: 'R$ 1.818 – R$ 2.200',
    regime: 'CLT · Escala 6x1 · Turnos',
  },
  gerente: {
    titulo: 'Gerente Geral de Hotel',
    marca: 'Novotel · Mercure · Pullman',
    descricao: 'Gestão completa da unidade hoteleira: liderança de equipes multidepartamentais, P&L, relacionamento com proprietários e gestão da experiência do hóspede.',
    requisitos: ['Superior em Hotelaria, Administração ou áreas correlatas', 'Mínimo 3 anos em gestão hoteleira', 'Inglês avançado', 'Gestão financeira e Revenue Management'],
    diferenciais: ['MBA ou pós-graduação', 'Experiência em redes internacionais', 'Espanhol', 'Certificações em hotelaria'],
    competencias: ['Liderança inspiracional', 'Gestão financeira (P&L)', 'Orientação a resultados', 'Gestão de pessoas', 'Visão estratégica'],
    salario: 'R$ 7.000 – R$ 12.000',
    regime: 'CLT · Regime executivo',
  },
  chef: {
    titulo: 'Chef de Cozinha',
    marca: 'Novotel · Mercure · Pullman',
    descricao: 'Desenvolvimento de cardápio, gestão da brigada de cozinha, controle de custos e desperdício, conformidade com normas ANVISA e HACCP.',
    requisitos: ['Formação técnica ou superior em Gastronomia', 'Mínimo 2 anos como Chef ou Sous-Chef', 'Conhecimento de HACCP e normas ANVISA', 'Gestão de equipes'],
    diferenciais: ['Experiência internacional', 'Inglês', 'Culinária regional brasileira ou internacional', 'Experiência em F&B hoteleiro'],
    competencias: ['Criatividade culinária', 'Liderança de brigada', 'Controle de custos', 'Organização e precisão', 'Compliance sanitário'],
    salario: 'R$ 4.000 – R$ 8.000',
    regime: 'CLT · Escala variável com fins de semana e feriados',
  },
  supervisorFB: {
    titulo: 'Supervisor de Alimentos e Bebidas',
    marca: 'ibis · Mercure · Novotel',
    descricao: 'Supervisão do restaurante e bar do hotel, gestão de equipe de garçons, controle de estoque de F&B e garantia dos padrões de serviço Accor.',
    requisitos: ['Ensino médio completo', 'Mínimo 1 ano em supervisão de restaurante ou bar', 'Disponibilidade para turnos e fins de semana'],
    diferenciais: ['Curso técnico em hotelaria ou gastronomia', 'Inglês básico', 'Controle de custos e estoque'],
    competencias: ['Supervisão de equipes', 'Orientação ao cliente', 'Controle de qualidade', 'Organização', 'Comunicação'],
    salario: 'R$ 2.500 – R$ 4.000',
    regime: 'CLT · Escala 6x1',
  },
  manutencao: {
    titulo: 'Técnico de Manutenção',
    marca: 'ibis · Mercure · Novotel · Pullman',
    descricao: 'Manutenção preventiva e corretiva de instalações elétricas, hidráulicas e mecânicas do hotel, além de atendimento de chamados de hóspedes.',
    requisitos: ['Ensino técnico em Eletrotécnica, Mecânica ou correlatas', 'CREA ou registro profissional ativo', 'Disponibilidade para plantões e fins de semana'],
    diferenciais: ['Experiência em hotelaria', 'Conhecimento em refrigeração/HVAC', 'NR10 e NR35'],
    competencias: ['Resolução de problemas técnicos', 'Organização', 'Autonomia', 'Atenção à segurança', 'Comunicação'],
    salario: 'R$ 2.200 – R$ 4.000',
    regime: 'CLT · Plantões · 12x36 ou 6x1',
  },
  trainee: {
    titulo: 'Programa Trainee Accor',
    marca: 'Accor Group Brasil',
    descricao: 'Programa de desenvolvimento acelerado para recém-formados com rotação por departamentos-chave, mentoria sênior e formação para cargos gerenciais.',
    requisitos: ['Formação superior concluída entre 2023–2025', 'Inglês intermediário ou avançado', 'Disponibilidade para realocação pelo Brasil'],
    diferenciais: ['Segundo idioma (espanhol, francês)', 'Intercâmbio ou experiência internacional', 'Voluntariado e liderança estudantil'],
    competencias: ['Agilidade de aprendizado', 'Liderança potencial', 'Adaptabilidade', 'Comunicação', 'Visão de negócios'],
    salario: 'Confidencial + benefícios competitivos',
    regime: 'CLT · Programa de 18 meses',
  },
}

// Pesos por dimensão (somam 100)
const PESOS = { heartist: 20, tecnico: 25, experiencia: 20, disponibilidade: 20, potencial: 15 }

function calcScore(dimensoes) {
  return Math.round(
    Object.entries(PESOS).reduce((acc, [k, peso]) => {
      const score = Number(dimensoes[k]?.score) || 0
      return acc + (Math.min(10, Math.max(0, score)) * peso) / 10
    }, 0)
  )
}

function extractJSON(text) {
  try { return JSON.parse(text) } catch (_) {}
  const match = text.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) } catch (_) {}
  }
  throw new Error('Resposta da IA não retornou JSON válido')
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

app.get('/api/status', (_req, res) => {
  const provider = getProvider()
  const cfg      = provider ? PROVIDERS[provider] : null
  res.json({
    ok:       !!provider,
    provider: provider || 'nenhum',
    model:    cfg?.model || '—',
    vagas:    Object.keys(VAGAS).length,
  })
})

app.get('/api/vagas', (_req, res) => {
  const lista = Object.entries(VAGAS).map(([id, v]) => ({
    id,
    titulo: v.titulo,
    marca:  v.marca,
    salario: v.salario,
    regime: v.regime,
  }))
  res.json(lista)
})

app.get('/api/vagas/:id', (req, res) => {
  const vaga = VAGAS[req.params.id]
  if (!vaga) return res.status(404).json({ error: 'Vaga não encontrada.' })
  res.json(vaga)
})

// POST /api/screen  →  SSE stream
app.post('/api/screen', async (req, res) => {
  const { vagaId, candidatos } = req.body || {}

  if (!vagaId || !VAGAS[vagaId])
    return res.status(400).json({ error: 'vagaId inválido.' })
  if (!Array.isArray(candidatos) || candidatos.length === 0)
    return res.status(400).json({ error: 'Envie ao menos um candidato.' })
  if (candidatos.length > 10)
    return res.status(400).json({ error: 'Máximo de 10 candidatos por triagem.' })
  if (!getProvider())
    return res.status(500).json({ error: 'Nenhuma API key configurada no .env (GEMINI_API_KEY, GROQ_API_KEY ou OPENROUTER_API_KEY).' })

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const sse = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const vaga = VAGAS[vagaId]
  sse('start', { total: candidatos.length, vaga: vaga.titulo })

  const resultados = []

  for (let i = 0; i < candidatos.length; i++) {
    const c = candidatos[i]
    if (!c.nome?.trim() || !c.curriculo?.trim()) {
      sse('candidato', { index: i, nome: c.nome || `Candidato ${i + 1}`, erro: 'Nome ou currículo vazio.' })
      continue
    }

    sse('progress', { index: i, nome: c.nome, status: 'analisando' })

    try {
      const dimensoes = await analisarCandidato(vaga, c)
      const scoreTotal = calcScore(dimensoes.dimensoes)
      const resultado  = { ...dimensoes, scoreTotal }
      resultados.push({ nome: c.nome, ...resultado })
      sse('candidato', { index: i, nome: c.nome, resultado })
    } catch (err) {
      sse('candidato', { index: i, nome: c.nome, erro: err.message })
    }
  }

  // Ranking final — só quem tem scoreTotal
  const ranking = resultados
    .sort((a, b) => b.scoreTotal - a.scoreTotal)
    .map((r, pos) => ({ ...r, posicao: pos + 1 }))

  sse('done', { ranking })
  res.end()
})

// ─── IA — análise individual ──────────────────────────────────────────────────

async function analisarCandidato(vaga, candidato) {
  const system = `Você é especialista em Talent & Culture da Accor Brasil.

CONTEXTO DA EMPRESA:
Accor Brasil — 330+ hotéis, 50.000+ colaboradores, maior rede hoteleira da América do Sul.
Filosofia Heartist®: colaboradores que unem coração e arte no atendimento. Autenticidade e paixão pela hospitalidade são inegociáveis.
Desafio crítico do setor: turnover de 52% — disponibilidade para escala 6x1 é fator eliminatório.
Regime: CLT brasileiro. Avalie disponibilidade para fins de semana, feriados e turnos rotativos.

VAGA EM ABERTO:
Cargo: ${vaga.titulo} | Marca: ${vaga.marca}
Descrição: ${vaga.descricao}
Requisitos obrigatórios: ${vaga.requisitos.join(' · ')}
Diferenciais valorizados: ${vaga.diferenciais.join(' · ')}
Competências-chave: ${vaga.competencias.join(' · ')}
Faixa salarial: ${vaga.salario} | Regime: ${vaga.regime}

REGRA: Baseie-se exclusivamente no que está escrito no currículo. Não invente informações.`

  const user = `CANDIDATO: ${candidato.nome}

CURRÍCULO:
${candidato.curriculo.trim()}

Retorne APENAS o JSON abaixo, sem texto adicional:
{
  "dimensoes": {
    "heartist":       { "score": <0-10>, "justificativa": "<1 frase direta>" },
    "tecnico":        { "score": <0-10>, "justificativa": "<1 frase direta>" },
    "disponibilidade":{ "score": <0-10>, "justificativa": "<1 frase direta>" },
    "experiencia":    { "score": <0-10>, "justificativa": "<1 frase direta>" },
    "potencial":      { "score": <0-10>, "justificativa": "<1 frase direta>" }
  },
  "pontosFort":   ["<ponto objetivo>", "<ponto objetivo>"],
  "pontosAtencao":["<ponto objetivo>", "<ponto objetivo>"],
  "recomendacao": "<Avançar|Aguardar|Dispensar>",
  "resumo":       "<2-3 frases objetivas para o gestor>"
}`

  const provider = getProvider()
  const cfg      = PROVIDERS[provider]

  let content
  if (provider === 'gemini') {
    // API nativa do Gemini (maior cota no plano gratuito)
    const url  = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.key()}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.15, maxOutputTokens: 4096, responseMimeType: 'application/json' },
      }),
    })
    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error(`gemini ${resp.status}: ${txt.slice(0, 200)}`)
    }
    const data = await resp.json()
    content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  } else {
    // OpenAI-compatible (Groq, OpenRouter)
    const resp = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.key()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user },
        ],
        temperature: 0.15,
        max_tokens: 700,
      }),
    })
    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error(`${provider} ${resp.status}: ${txt.slice(0, 200)}`)
    }
    const data = await resp.json()
    content = data.choices?.[0]?.message?.content?.trim()
  }

  if (!content) throw new Error('Resposta vazia da IA.')

  // Remove possíveis blocos de código markdown
  const clean = content.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
  return extractJSON(clean)
}

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const provider = getProvider()
  const cfg      = provider ? PROVIDERS[provider] : null
  console.log(`\n  AI-HR Academy — Accor Screener`)
  console.log(`  http://localhost:${PORT}`)
  console.log(`  Provedor: ${provider || 'NENHUM — configure o .env'}`)
  console.log(`  Modelo:   ${cfg?.model || '—'}`)
  console.log(`  API Key: ${provider ? 'configurada' : 'AUSENTE — configure o .env'}\n`)
})
