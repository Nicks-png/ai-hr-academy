'use strict'

// Transcreve um documento (PDF/imagem) via Gemini Vision. Usado tanto pela rota
// autenticada POST /api/ocr (triagem.html, curriculo.html) quanto pelo fallback
// server-side em POST /api/candidatos/submit (candidato.html, /vaga/:id) — currículos
// digitalizados/fotografados chegam com texto quase vazio do PDF.js no navegador.

const MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest']
const sleep  = ms => new Promise(r => setTimeout(r, ms))

async function ocrTranscribe(data, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('Gemini API Key não configurada. OCR requer Gemini.')

  const prompt = `Transcreva TODO o texto deste currículo exatamente como está escrito. Não analise, não interprete — apenas transcreva fielmente nome, contatos, experiências, formação, cursos e habilidades.`

  // Retry com troca de modelo em instabilidade transitória (429/5xx) — sem isso, um
  // pico passageiro de demanda no Gemini derruba justamente o fallback de currículo
  // digitalizado, que é quem mais precisa ser resiliente.
  let lastErr = null
  for (const model of MODELS) {
    for (let retry = 0; retry <= 2; retry++) {
      let resp
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
        resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [
              { inlineData: { mimeType, data } },
              { text: prompt },
            ] }],
            generationConfig: { temperature: 0, maxOutputTokens: 8192 },
          }),
        })
      } catch (networkErr) {
        lastErr = networkErr
        await sleep(3000)
        continue
      }

      if (resp.status === 429 || resp.status >= 500) {
        lastErr = new Error(`${resp.status}`)
        if (retry < 2) { await sleep((retry + 1) * 4000); continue }
        break
      }

      if (!resp.ok) {
        const err = await resp.text()
        lastErr = new Error(`OCR falhou: ${err.slice(0, 200)}`)
        break
      }

      const json  = await resp.json()
      const texto = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      if (!texto) { lastErr = new Error('OCR retornou texto vazio.'); break }
      return texto
    }
  }
  throw lastErr || new Error('OCR falhou.')
}

module.exports = { ocrTranscribe }
