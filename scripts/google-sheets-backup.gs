/**
 * Backup externo de candidaturas — Google Apps Script
 *
 * Recebe as duas fontes de verdade das candidaturas via POST e grava em duas
 * abas da mesma planilha:
 *   - "Candidaturas" (principal) — alimentada pelo SERVIDOR (src/services/sheetsBackup.js),
 *     espelha o submission_log: toda tentativa, sucesso ou falha.
 *   - "Garantia" — alimentada direto pelo NAVEGADOR (public/js/candidato.js), disparada
 *     ANTES do POST real pro backend. Sobrevive mesmo se o Render/Turso estiverem fora do ar.
 *
 * A própria planilha cruza as duas (coluna "Status" na aba Garantia) pra apontar
 * candidaturas que o navegador tentou enviar mas nunca chegaram na aba principal —
 * esse é o sinal de que algo se perdeu entre o cliente e o servidor.
 *
 * ── Setup (fazer uma vez) ─────────────────────────────────────────────────────
 * 1. Crie uma planilha nova no Google Sheets.
 * 2. Renomeie a primeira aba para exatamente "Candidaturas" e crie uma segunda
 *    aba chamada exatamente "Garantia" (sem acento, sem espaço extra).
 * 3. Na aba "Candidaturas", linha 1 (cabeçalho): Timestamp | Vaga | Nome | Telefone | Status | Detalhe
 * 4. Na aba "Garantia", linha 1 (cabeçalho): Timestamp | Vaga | Nome | Telefone | Status
 *    Na célula E1 dessa aba, cole a fórmula abaixo (cruza automaticamente com a aba principal):
 *      ={"Conferência";ARRAYFORMULA(IF($B2:$B="","",IF(COUNTIFS(Candidaturas!$B:$B,$B2:$B,Candidaturas!$D:$D,$D2:$D,Candidaturas!$E:$E,"sucesso")>0,"✓ OK","⚠ VERIFICAR")))}
 * 5. Extensões → Apps Script. Apague o conteúdo padrão e cole este arquivo inteiro.
 * 6. Troque SECRET abaixo por uma string aleatória qualquer (não precisa ser complexa —
 *    é só um filtro anti-spam básico, não segurança real, já que o navegador chama
 *    essa URL diretamente e ela fica visível na aba Rede do navegador).
 * 7. Implantar → Nova implantação → tipo "App da Web".
 *    Executar como: Eu (sua conta). Quem pode acessar: Qualquer pessoa.
 * 8. Autorize as permissões pedidas (é o seu próprio script, acessando sua própria planilha).
 * 9. Copie a URL do app da web gerada (termina em /exec) e coloque no .env do projeto:
 *      SHEETS_WEBHOOK_URL=<url do passo 9>
 *      SHEETS_WEBHOOK_SECRET=<o mesmo valor do SECRET abaixo>
 *    Configure as mesmas duas variáveis no Render (ambiente de produção).
 * 10. Sempre que editar este arquivo no Apps Script, é preciso reimplantar
 *     (Implantar → Gerenciar implantações → ✏️ → Nova versão) pra valer.
 */

const SECRET = 'TROQUE_POR_UM_VALOR_ALEATORIO'

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents)
    if (SECRET && data.secret !== SECRET) {
      return respond({ ok: false, error: 'unauthorized' })
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet()
    const isGarantia = data.aba === 'garantia'
    const sheet = ss.getSheetByName(isGarantia ? 'Garantia' : 'Candidaturas')
    if (!sheet) return respond({ ok: false, error: 'aba não encontrada: ' + data.aba })

    const row = isGarantia
      ? [new Date(), data.vagaId || '', data.nome || '', data.phone || '', 'tentativa']
      : [new Date(), data.vagaId || '', data.nome || '', data.phone || '', data.status || '', data.errorMsg || '']

    sheet.appendRow(row)
    return respond({ ok: true })
  } catch (err) {
    return respond({ ok: false, error: String(err) })
  }
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}
