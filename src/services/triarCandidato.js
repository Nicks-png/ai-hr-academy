'use strict'
const db = require('../../db')
const { getVagaById, PROVIDERS, calcScore, extractJSON } = require('../data/vagas')

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── Análise individual via IA ─────────────────────────────────────────────────
async function analisarCandidato(vaga, candidato) {
  const system = `Você é especialista em Talent & Culture da Accor Brasil.

CONTEXTO DA EMPRESA:
Accor Brasil — 330+ hotéis, 50.000+ colaboradores, maior rede hoteleira da América do Sul.
Filosofia Heartist®: colaboradores que unem coração e arte no atendimento. Autenticidade e paixão pela hospitalidade são inegociáveis.
Desafio crítico do setor: turnover de 52% — estabilidade e retenção são prioridade na seleção.
Regime: CLT brasileiro. Para a dimensão "estabilidade", avalie tempo médio em cada emprego, padrão de saídas e sinais de comprometimento de longo prazo visíveis no currículo.

VAGA EM ABERTO:
Cargo: ${vaga.titulo} | Marca: ${vaga.marca}
Descrição: ${vaga.descricao}
Requisitos obrigatórios: ${JSON.parse(vaga.requisitos).join(' · ')}
Diferenciais valorizados: ${JSON.parse(vaga.diferenciais).join(' · ')}
Competências-chave: ${JSON.parse(vaga.competencias).join(' · ')}
Faixa salarial: ${vaga.salario} | Regime: ${vaga.regime}

REGRA: Baseie-se exclusivamente no que está escrito no currículo. Não invente informações.`

  const cvTexto = candidato.curriculo.trim().slice(0, 12000)

  const user = `CANDIDATO: ${candidato.nome}

CURRÍCULO:
${cvTexto}

Retorne APENAS o JSON abaixo, sem texto adicional:
{
  "nome_detectado": "<nome completo extraído do currículo>",
  "idade":        <número inteiro ou null se não informado>,
  "telefone":     "<número de telefone ou null>",
  "linkedin":     "<URL completa do LinkedIn ou null>",
  "nivel_ingles": "<nível de inglês evidenciado no currículo: Básico | Intermediário | Avançado | Fluente | Nativo | null se não mencionado>",
  "dimensoes": {
    "heartist":       { "score": <0-10>, "justificativa": "<1 frase direta>" },
    "tecnico":        { "score": <0-10>, "justificativa": "<1 frase direta>" },
    "estabilidade":   { "score": <0-10>, "justificativa": "<1 frase direta>" },
    "experiencia":    { "score": <0-10>, "justificativa": "<1 frase direta>" },
    "potencial":      { "score": <0-10>, "justificativa": "<1 frase direta>" }
  },
  "pontosFort":   ["<ponto objetivo>", "<ponto objetivo>"],
  "pontosAtencao":["<ponto objetivo>", "<ponto objetivo>"],
  "recomendacao": "<Avançar|Aguardar|Dispensar>",
  "resumo":       "<2-3 frases objetivas para o gestor>"
}`

  const PROVIDER_ORDER = ['gemini', 'groq', 'openrouter'].filter(p => PROVIDERS[p].key())
  if (!PROVIDER_ORDER.length) throw new Error('Nenhuma API key configurada.')

  const GEMINI_MODELS     = ['gemini-2.0-flash', 'gemini-2.0-flash-lite']
  const OPENROUTER_MODELS = [
    process.env.AI_MODEL,
    'google/gemma-4-31b-it:free',
    'google/gemma-4-26b-a4b-it:free',
    'nousresearch/hermes-3-llama-3.1-405b:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'openai/gpt-oss-20b:free',
  ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i)

  for (const provider of PROVIDER_ORDER) {
    const cfg = PROVIDERS[provider]
    const models = provider === 'gemini' ? GEMINI_MODELS
                 : provider === 'openrouter' ? OPENROUTER_MODELS
                 : [cfg.model]

    for (const modelAtual of models) {
      let lastErr = null
      for (let retry = 0; retry <= 3; retry++) {
        let resp
        try {
          if (provider === 'gemini') {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelAtual}:generateContent?key=${cfg.key()}`
            resp = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: system }] },
                contents: [{ role: 'user', parts: [{ text: user }] }],
                generationConfig: { temperature: 0.15, maxOutputTokens: 8192, responseMimeType: 'application/json' },
              }),
            })
          } else {
            resp = await fetch(`${cfg.base}/chat/completions`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${cfg.key()}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: modelAtual,
                messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                temperature: 0.15,
                max_tokens: 1200,
              }),
            })
          }
        } catch (networkErr) {
          lastErr = networkErr
          await sleep(5000)
          continue
        }

        if (resp.status === 404) { lastErr = new Error('404'); break }
        if (resp.status === 429) {
          lastErr = new Error('429')
          if (retry < 2) { await sleep((retry + 1) * 8000); continue }
          break
        }
        if (resp.status >= 500) {
          lastErr = new Error(`${resp.status}`)
          if (retry < 3) { await sleep((retry + 1) * 8000); continue }
          break
        }

        if (!resp.ok) {
          const txt = await resp.text()
          console.warn(`[triar] ${provider}/${modelAtual} → ${resp.status}: ${txt.slice(0, 200)}`)
          lastErr = new Error(`${provider} ${resp.status}`)
          break
        }

        const data = await resp.json()
        let content
        if (provider === 'gemini') {
          const cand   = data.candidates?.[0]
          const finish = cand?.finishReason
          if (!cand || finish === 'SAFETY') throw new Error('Conteúdo bloqueado pelo filtro de segurança.')
          if (finish === 'MAX_TOKENS') throw new Error('Currículo muito longo. Reduza o texto.')
          content = (cand?.content?.parts || []).map(p => p.text || '').join('').trim()
        } else {
          content = data.choices?.[0]?.message?.content?.trim()
        }
        if (!content) throw new Error('Resposta vazia da IA.')
        const clean = content.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
        console.log(`[triar] OK via ${provider}/${modelAtual}`)
        return extractJSON(clean)
      }
      if (lastErr) console.warn(`[triar] ${provider}/${modelAtual} falhou:`, lastErr.message)
    }
  }
  throw new Error('Todos os provedores de IA falharam.')
}

// ── Triagem automática: busca candidato no DB, analisa e persiste resultado ───
async function triarEPersistir(candidateDbId) {
  try {
    const c = await db.get(
      'SELECT id, name, cv_text, job_id FROM candidates WHERE id = ?',
      [candidateDbId]
    )
    if (!c || !c.cv_text || !c.job_id) {
      console.warn(`[triar] Candidato ${candidateDbId} sem cv_text ou job_id — pulando.`)
      return
    }

    const vaga = await getVagaById(c.job_id)
    if (!vaga) {
      console.warn(`[triar] Vaga ${c.job_id} não encontrada — pulando.`)
      return
    }

    console.log(`[triar] Iniciando triagem automática: ${c.name} → ${vaga.titulo}`)

    const analise = await analisarCandidato(vaga, { nome: c.name, curriculo: c.cv_text })

    // Normalizar dimensão estabilidade
    if (analise.dimensoes) {
      if (!analise.dimensoes.estabilidade?.score && analise.dimensoes.disponibilidade?.score)
        analise.dimensoes.estabilidade = analise.dimensoes.disponibilidade
      delete analise.dimensoes.disponibilidade
    }

    const scoreTotal = calcScore(analise.dimensoes || {})

    await db.run(`
      UPDATE candidates SET
        ai_score_total    = ?,
        ai_recomendacao   = ?,
        ai_resumo         = ?,
        ai_pontos_fortes  = ?,
        ai_pontos_atencao = ?,
        ai_dimensoes      = ?,
        status            = 'Triagem Concluída'
      WHERE id = ?
    `, [
      scoreTotal,
      analise.recomendacao  || null,
      analise.resumo        || null,
      JSON.stringify(analise.pontosFort    || []),
      JSON.stringify(analise.pontosAtencao || []),
      JSON.stringify(analise.dimensoes     || {}),
      candidateDbId,
    ])

    console.log(`[triar] Concluído: ${c.name} → score ${scoreTotal} (${analise.recomendacao})`)
  } catch (err) {
    console.error(`[triar] Erro ao triar candidato ${candidateDbId}:`, err.message)
    // Volta para Pendente para que o gestor possa retriar manualmente
    try {
      await db.run("UPDATE candidates SET status = 'Pendente' WHERE id = ? AND status = 'Triando'", [candidateDbId])
    } catch (_) {}
  }
}

module.exports = { analisarCandidato, triarEPersistir }
