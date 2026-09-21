/**
 * Backup externo de candidaturas — Google Apps Script
 *
 * Recebe as duas fontes de verdade das candidaturas via POST e grava em duas
 * abas da mesma planilha:
 *   - "Candidaturas" (principal) — alimentada pelo SERVIDOR (src/services/sheetsBackup.js),
 *     espelha o submission_log: toda tentativa, sucesso ou falha.
 *   - "Garantia" — alimentada direto pelo NAVEGADOR (public/js/candidato.js e vaga.js),
 *     disparada ANTES do POST real pro backend. Sobrevive mesmo se o Render/Turso
 *     estiverem fora do ar.
 *
 * A própria planilha cruza as duas (coluna "Conferência" na aba Garantia) pra apontar
 * candidaturas que o navegador tentou enviar mas nunca chegaram na aba principal —
 * esse é o sinal de que algo se perdeu entre o cliente e o servidor.
 *
 * ── Colunas ───────────────────────────────────────────────────────────────────
 * "Candidaturas" (A-J): Timestamp | Vaga (ID) | Vaga (Título) | Nome | Telefone |
 *                        Email | Respostas | Currículo (trecho) | Status | Detalhe
 * "Garantia" (A-H, I=fórmula): Timestamp | Vaga (ID) | Vaga (Título) | Nome | Telefone |
 *                        Email | Respostas | Currículo (trecho) | Conferência
 * A coluna "Vaga (ID)" é técnica (usada só pela fórmula de conferência bater com a
 * aba principal) — "Vaga (Título)" é a legível pro RH. O "Currículo (trecho)" é só
 * os primeiros ~500 caracteres (limite do sendBeacon no navegador, ~64KB) — o
 * currículo completo/PDF nunca sai do sistema, fica só no Turso.
 *
 * ── Setup (fazer uma vez) ─────────────────────────────────────────────────────
 * 1. Crie uma planilha nova no Google Sheets.
 * 2. Renomeie a primeira aba para exatamente "Candidaturas" e crie uma segunda
 *    aba chamada exatamente "Garantia" (sem acento, sem espaço extra).
 * 3. Na aba "Candidaturas", linha 1 (cabeçalho, colunas A-J):
 *    Timestamp | Vaga (ID) | Vaga (Título) | Nome | Telefone | Email | Respostas | Currículo (trecho) | Status | Detalhe
 * 4. Na aba "Garantia", linha 1 (cabeçalho, colunas A-H apenas):
 *    Timestamp | Vaga (ID) | Vaga (Título) | Nome | Telefone | Email | Respostas | Currículo (trecho)
 *    NÃO digite nada na coluna I — ela é só da fórmula abaixo (o próprio array já gera o
 *    cabeçalho "Conferência" sozinho). Cole na célula I1:
 *      ={"Conferência";ARRAYFORMULA(SE($B2:$B2000="";"";SE(CONT.SES(Candidaturas!$B$2:$B$2000;$B2:$B2000;Candidaturas!$E$2:$E$2000;$E2:$E2000;Candidaturas!$I$2:$I$2000;"sucesso")>0;"✓ OK";"⚠ VERIFICAR")))}
 *    (fórmula em português/pt-BR — separador ";" e nomes SE/CONT.SES. Se sua planilha usar
 *    locale em inglês, troque ";" por "," e use IF/COUNTIFS. IMPORTANTE: o intervalo tem que
 *    ser limitado, ex. $B2:$B2000 — nunca use coluna inteira ($B:$B) nessa fórmula: o Sheets
 *    passa a considerar toda a coluna "com conteúdo" mesmo com resultado "", e o appendRow()
 *    do script passa a inserir a milhares de linhas de distância em vez de logo abaixo do cabeçalho.)
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
 *    Configure as mesmas duas variáveis no Render (ambiente de produção) e no CSP de
 *    server.js (connectSrc precisa incluir script.google.com/script.googleusercontent.com
 *    — sem isso o navegador bloqueia a chamada da aba "Garantia" silenciosamente).
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

    const comuns = [
      new Date(),
      data.vagaId || '',
      data.vagaTitulo || '',
      data.nome || '',
      data.phone || '',
      data.email || '',
      data.respostas || '',
      data.cvPreview || '',
    ]

    // Na aba "Garantia" a coluna I é reservada pra fórmula de conferência (ARRAYFORMULA
    // no cabeçalho) — nunca escrever nela aqui, senão quebra o spill da fórmula com #REF!.
    const row = isGarantia
      ? comuns
      : comuns.concat([data.status || '', data.errorMsg || ''])

    sheet.appendRow(row)
    return respond({ ok: true })
  } catch (err) {
    return respond({ ok: false, error: String(err) })
  }
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}
