'use strict'
const express  = require('express')
const router   = express.Router()
const { PROVIDERS, getProvider, extractJSON } = require('../data/vagas')

// POST /api/email/gerar
router.post('/email/gerar', async (req, res) => {
  const { triagemData, totalCvs, destinatario, tom, obs, ajuste } = req.body || {}

  if (!triagemData?.resultado?.length)
    return res.status(400).json({ error: 'Selecione uma triagem com candidatos.' })
  if (!totalCvs || Number(totalCvs) < 1)
    return res.status(400).json({ error: 'Informe o total de currículos recebidos.' })
  if (!getProvider())
    return res.status(500).json({ error: 'Nenhuma API key configurada.' })

  const tomDesc = {
    profissional: 'profissional e objetivo',
    cordial:      'cordial e próximo, mantendo profissionalismo',
    formal:       'formal e protocolar',
  }[tom] || 'profissional e objetivo'

  const resultado   = triagemData.resultado
  const dataTriagem = new Date(triagemData.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const ordenados  = [...resultado].sort((a, b) => (b.scoreTotal ?? 0) - (a.scoreTotal ?? 0))
  const top3       = ordenados.filter(c => (c.recomendacao || '').toLowerCase().includes('avan')).slice(0, 3)
  const destaques  = top3.length ? top3 : ordenados.slice(0, 3)

  const candidatosBloco = destaques
    .map((c, i) => `${i + 1}. ${c.nome} — Score: ${c.scoreTotal ?? '—'}/100`)
    .join('\n')

  const avancar    = resultado.filter(c => (c.recomendacao || '').toLowerCase().includes('avan')).length
  const aguardar   = resultado.filter(c => (c.recomendacao || '').toLowerCase().includes('aguar')).length
  const dispensar  = resultado.filter(c => (c.recomendacao || '').toLowerCase().includes('dispen')).length

  const obsBloco = obs ? `\n\nOBSERVAÇÕES ADICIONAIS DO RECRUTADOR:\n${obs}` : ''
  const ajusteBloco = ajuste ? `\n\nINSTRUÇÃO DE AJUSTE: ${ajuste}` : ''

  const prompt = `Você é especialista em Talent & Culture do Pullman Ibirapuera com comunicação impecável.

Gere um e-mail profissional de atualização de processo seletivo para enviar ao cliente/gestor.

TOM: ${tomDesc}
DESTINATÁRIO: ${destinatario || 'o destinatário'}

DADOS DA TRIAGEM:
- Vaga: ${triagemData.vaga_titulo}
- Data da triagem: ${dataTriagem}
- Total de currículos recebidos: ${totalCvs}
- Total triados: ${resultado.length}
- Avançar: ${avancar} | Aguardar: ${aguardar} | Dispensar: ${dispensar}

CANDIDATOS (em ordem de score):
${candidatosBloco}${obsBloco}${ajusteBloco}

REGRAS:
REGRAS OBRIGATÓRIAS — nunca ignore:
1. Mencione o total de currículos recebidos (${totalCvs}) no corpo do e-mail
2. Use sempre o nome completo dos candidatos — nunca abrevie
3. Recomende exatamente os 3 candidatos listados acima — nem mais, nem menos
4. Não inclua resumo, pontos fortes ou análise individual dos candidatos — apenas nome e score
- Estrutura: saudação → resumo do processo (total de currículos + triados) → os 3 candidatos recomendados (nome completo + score) → próximos passos → fechamento
- O assunto deve ser específico (incluir nome da vaga)
- IMPORTANTE: responda SOMENTE com o JSON abaixo. Sem explicações, sem markdown, sem texto antes ou depois:

{"assunto":"<assunto>","corpo":"<corpo com \\n para quebras de linha>"}`

  try {
    const texto = await chamarIA(prompt)
    let json
    try {
      json = extractJSON(texto)
    } catch {
      // Fallback: tenta extrair assunto/corpo de texto livre
      json = parsearTextoLivre(texto)
    }
    if (!json.assunto || !json.corpo) throw new Error('Resposta incompleta da IA.')
    json.assunto = limparMarkdown(json.assunto)
    json.corpo   = limparMarkdown(json.corpo)
    res.json(json)
  } catch (e) {
    console.error('[email] Erro:', e.message)
    res.status(500).json({ error: e.message })
  }
})

async function chamarIA(prompt) {
  const ORDER = ['gemini', 'groq', 'openrouter'].filter(p => PROVIDERS[p].key())
  if (!ORDER.length) throw new Error('Nenhuma API key configurada.')

  for (const provider of ORDER) {
    const cfg = PROVIDERS[provider]
    try {
      let resp
      if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${cfg.key()}`
        resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 2048, responseMimeType: 'application/json' }
          })
        })
      } else {
        resp = await fetch(`${cfg.base}/chat/completions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cfg.key()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: cfg.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 2048
          })
        })
      }

      if (resp.status === 429) { console.warn(`[email] ${provider} 429, tentando próximo`); continue }
      if (!resp.ok) { console.warn(`[email] ${provider} ${resp.status}`); continue }

      const data = await resp.json()
      const text = provider === 'gemini'
        ? data.candidates?.[0]?.content?.parts?.[0]?.text
        : data.choices?.[0]?.message?.content
      if (text) { console.log(`[email] OK via ${provider}`); return text }
    } catch (e) {
      console.warn(`[email] ${provider} erro:`, e.message)
    }
  }
  throw new Error('Todos os provedores falharam. Tente novamente em instantes.')
}

function limparMarkdown(texto) {
  return texto
    .replace(/\*\*(.+?)\*\*/g, '$1')  // **negrito**
    .replace(/\*(.+?)\*/g, '$1')       // *itálico*
    .replace(/_{2}(.+?)_{2}/g, '$1')   // __negrito__
    .replace(/_(.+?)_/g, '$1')         // _itálico_
    .replace(/#{1,6}\s+/g, '')         // # títulos
    .replace(/`(.+?)`/g, '$1')         // `código`
    .trim()
}

function parsearTextoLivre(texto) {
  if (!texto?.trim()) throw new Error('Resposta vazia da IA.')
  const linhas = texto.trim().split('\n')

  // Tenta detectar "Assunto: ..." na primeira linha ou em linha própria
  let assunto = ''
  let corpoLinhas = []
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i].trim()
    if (!assunto && /^(assunto|subject)\s*:/i.test(l)) {
      assunto = l.replace(/^(assunto|subject)\s*:\s*/i, '').trim()
      corpoLinhas = linhas.slice(i + 1)
      break
    }
  }

  // Se não achou assunto em linha própria, usa a primeira linha não vazia como assunto
  if (!assunto) {
    const primeiraLinha = linhas.find(l => l.trim())
    assunto = primeiraLinha?.trim() || 'Atualização de Processo Seletivo'
    corpoLinhas = linhas.slice(linhas.indexOf(primeiraLinha) + 1)
  }

  const corpo = corpoLinhas.join('\n').replace(/^\n+/, '').trim()
  if (!corpo) throw new Error('A IA não retornou um e-mail com conteúdo.')
  return { assunto, corpo }
}

module.exports = router
