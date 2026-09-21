'use strict'

// Espelha toda tentativa de candidatura (sucesso ou falha) numa planilha Google
// Sheets externa, fora da infra do Render/Turso — é a aba "Candidaturas" (principal),
// alimentada pelo servidor a partir do submission_log. A aba "Garantia" é alimentada
// direto do navegador (public/js/candidato.js), independente do servidor estar de pé,
// e a própria planilha cruza as duas pra apontar candidaturas que nunca chegaram aqui.
// Nunca deve bloquear nem derrubar o fluxo de candidatura: é best-effort, fire-and-forget.

const WEBHOOK_URL    = process.env.SHEETS_WEBHOOK_URL
const WEBHOOK_SECRET = process.env.SHEETS_WEBHOOK_SECRET || ''

function pushToSheetsBackup({ vagaId, vagaTitulo, nome, phone, email, respostas, cvPreview, success, errorMsg }) {
  if (!WEBHOOK_URL) return
  fetch(WEBHOOK_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' }, // evita preflight CORS no Apps Script
    body: JSON.stringify({
      secret:     WEBHOOK_SECRET,
      aba:        'candidaturas',
      vagaId:     vagaId || '',
      vagaTitulo: vagaTitulo || '',
      nome:       nome || '',
      phone:      phone || '',
      email:      email || '',
      respostas:  respostas || '',
      cvPreview:  cvPreview || '',
      status:     success ? 'sucesso' : 'falha',
      errorMsg:   errorMsg || '',
    }),
  }).catch(err => console.error('[sheetsBackup] falhou ao espelhar candidatura:', err.message))
}

module.exports = { pushToSheetsBackup }
