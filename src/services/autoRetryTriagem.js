'use strict'
const db = require('../../db')
const { triarEPersistir } = require('./triarCandidato')

// Candidatos orgânicos ficam em 'Pendente' quando a triagem falha (IA fora do ar,
// modelo descontinuado) ou quando o servidor reinicia no meio de uma triagem em
// andamento (server.js reseta 'Triando' → 'Pendente' no startup). Sem isso, só um
// retry manual do RH (POST /api/organico/:id/retriar) resolve — e o achado é fácil
// de passar batido numa lista grande. Reduz a chance de repetir o caso da "Chefe de
// Fila" (cliente viu 1 candidato quando havia 10+ presos sem triagem concluída).
const MAX_TENTATIVAS = 3
const INTERVALO_MS   = 15 * 60 * 1000

function startAutoRetryLoop() {
  check()
  setInterval(check, INTERVALO_MS)
}

async function check() {
  try {
    const travados = await db.all(`
      SELECT id FROM candidates
      WHERE status = 'Pendente' AND source = 'organico'
        AND COALESCE(triagem_tentativas, 0) < ?
    `, [MAX_TENTATIVAS])

    if (!travados.length) return
    console.log(`[auto-retry] Retriando ${travados.length} candidato(s) travado(s) em 'Pendente'`)

    for (const c of travados) {
      await db.run("UPDATE candidates SET status = 'Triando' WHERE id = ? AND status = 'Pendente'", [c.id])
      triarEPersistir(c.id).catch(err =>
        console.error(`[auto-retry] candidato ${c.id} falhou:`, err.message)
      )
      // Espaça as chamadas — evita rajada simultânea nos provedores de IA se muitos
      // candidatos estiverem travados ao mesmo tempo (ex: após restart do servidor).
      await new Promise(r => setTimeout(r, 2000))
    }
  } catch (err) {
    console.error('[auto-retry] erro ao escanear candidatos travados:', err.message)
  }
}

module.exports = { startAutoRetryLoop }
