'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const wa      = require('../wa')

// ── SSE broadcast ──────────────────────────────────────────────────────────────
const sseWAClients = new Set()

router.get('/events/whatsapp', (req, res) => {
  res.set({
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()
  res.write('data: {"type":"connected"}\n\n')
  sseWAClients.add(res)
  req.on('close', () => sseWAClients.delete(res))
})

function broadcastWA(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`
  sseWAClients.forEach(r => r.write(msg))
}

// ── Candidates ────────────────────────────────────────────────────────────────

router.get('/api/candidates', (_req, res) => {
  res.json(db.prepare('SELECT * FROM candidates ORDER BY created_at DESC').all())
})

router.post('/api/candidates', (req, res) => {
  const { name, phone, job_position } = req.body || {}
  if (!name?.trim() || !phone?.trim() || !job_position?.trim())
    return res.status(400).json({ error: 'name, phone e job_position são obrigatórios.' })
  try {
    const r = db.prepare(
      'INSERT INTO candidates (name, phone, job_position) VALUES (?,?,?)'
    ).run(name.trim(), normalizePhone(phone), job_position.trim())
    res.json({ id: r.lastInsertRowid, ok: true })
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Telefone já cadastrado.' })
    res.status(500).json({ error: err.message })
  }
})

router.delete('/api/candidates/:id', (req, res) => {
  db.prepare('DELETE FROM candidates WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// Avançar selecionados → disparar WhatsApp
router.post('/api/candidates/advance', async (req, res) => {
  const { ids } = req.body || {}
  if (!Array.isArray(ids) || !ids.length)
    return res.status(400).json({ error: 'ids[] required' })

  const results = []
  for (const id of ids) {
    const c = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id)
    if (!c) { results.push({ id, ok: false, error: 'not found' }); continue }
    if (c.status !== 'Pendente') { results.push({ id, ok: false, skipped: true, status: c.status }); continue }

    const msg = buildWAMessage(c.name, c.job_position)
    try {
      await sendWhatsApp(c.phone, msg)
      db.prepare(
        "UPDATE candidates SET status='Contato enviado', contacted_at=datetime('now','localtime') WHERE id=?"
      ).run(id)
      db.prepare('INSERT INTO messages_sent (candidate_id, message, success) VALUES (?,?,1)').run(id, msg)
      broadcastWA({ type: 'status_update', candidate: db.prepare('SELECT * FROM candidates WHERE id=?').get(id) })
      results.push({ id, ok: true })
    } catch (err) {
      db.prepare('INSERT INTO messages_sent (candidate_id, message, success, error_msg) VALUES (?,?,0,?)').run(id, msg, err.message)
      results.push({ id, ok: false, error: err.message })
    }
    await delay(1200) // fila: evita ban no WhatsApp
  }
  res.json({ results })
})

// ── Responses ─────────────────────────────────────────────────────────────────

router.get('/api/responses', (_req, res) => {
  res.json(db.prepare(`
    SELECT r.*, c.name AS candidate_name, c.job_position, c.status AS candidate_status
    FROM   messages_received r
    LEFT JOIN candidates c ON c.id = r.candidate_id
    ORDER  BY r.received_at DESC
  `).all())
})

router.get('/api/responses/unread-count', (_req, res) => {
  res.json({ count: db.prepare('SELECT COUNT(*) as n FROM messages_received WHERE is_read=0').get().n })
})

router.patch('/api/responses/:id/read', (req, res) => {
  db.prepare('UPDATE messages_received SET is_read=1 WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Webhook (Evolution API → nosso backend) ───────────────────────────────────

router.post('/webhook/whatsapp', (req, res) => {
  try {
    const msgData = req.body?.data
    if (!msgData) return res.sendStatus(200)
    const jid  = msgData?.key?.remoteJid || ''
    const from = jid.replace('@s.whatsapp.net', '').replace('@g.us', '')
    const text = (
      msgData?.message?.conversation ||
      msgData?.message?.extendedTextMessage?.text ||
      msgData?.message?.imageMessage?.caption || ''
    ).trim()
    if (!from || !text || msgData?.key?.fromMe) return res.sendStatus(200)
    processIncomingMessage(from, text)
    res.sendStatus(200)
  } catch (err) {
    console.error('[Webhook]', err.message)
    res.sendStatus(500)
  }
})

// Simulação local de resposta (para testes sem ngrok/telefone real)
router.post('/webhook/test', (req, res) => {
  const { phone, text } = req.body || {}
  if (!phone || !text) return res.status(400).json({ error: 'phone e text required' })
  processIncomingMessage(phone.replace(/\D/g, ''), text)
  res.json({ ok: true })
})

function processIncomingMessage(phone, text) {
  const c = db.prepare('SELECT * FROM candidates WHERE phone=?').get(phone)
  if (!c) return  // ignora mensagens de números não cadastrados

  const ins = db.prepare(
    'INSERT INTO messages_received (candidate_id, phone, message) VALUES (?,?,?)'
  ).run(c.id, phone, text)

  if (c.status === 'Contato enviado') {
    const norm = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    const newStatus = ['sim', 's'].includes(norm) ? 'Confirmado'
                    : ['nao', 'n'].includes(norm)  ? 'Recusado'
                    : 'Resposta manual'
    db.prepare("UPDATE candidates SET status=?, confirmed_at=datetime('now','localtime') WHERE id=?").run(newStatus, c.id)
  }

  const newRow  = db.prepare('SELECT * FROM messages_received WHERE id=?').get(ins.lastInsertRowid)
  const updated = c ? db.prepare('SELECT * FROM candidates WHERE id=?').get(c.id) : null
  broadcastWA({ type: 'new_response', message: newRow, candidate: updated })
}

// ── WhatsApp status / QR ──────────────────────────────────────────────────────

router.get('/api/whatsapp/status', (_req, res) => {
  res.json({ configured: true, ...wa.getStatus() })
})

router.get('/api/whatsapp/qr', (_req, res) => {
  const qr = wa.getQR()
  if (!qr) return res.json({ qr: null, connected: wa.getStatus().connected })
  res.json({ qr })
})

// ── Shortlist Excel ───────────────────────────────────────────────────────────

router.get('/api/shortlist/excel', (_req, res) => {
  const XLSX = require('xlsx')
  const all  = db.prepare('SELECT * FROM candidates ORDER BY name COLLATE NOCASE ASC').all()

  const STATUS_LABEL = {
    'Confirmado':      'Confirmado',
    'Recusado':        'Recusado',
    'Contato enviado': 'Contato enviado',
    'Resposta manual': 'Resposta manual',
    'Pendente':        'Pendente',
  }

  const toRow = (r, i) => ({
    '#':             i + 1,
    'Nome':          r.name,
    'Vaga':          r.job_position,
    'Telefone':      r.phone,
    'Status':        STATUS_LABEL[r.status] || r.status,
    'Cadastrado em': r.created_at || '—',
    'Contato em':    r.contacted_at || '—',
    'Resposta em':   r.confirmed_at || '—',
  })

  const shortlist = all.filter(r => r.status === 'Confirmado').map(toRow)
  const todos     = all.map(toRow)

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb,
    XLSX.utils.json_to_sheet(shortlist.length ? shortlist : [{ Info: 'Nenhum candidato confirmado ainda.' }]),
    'Shortlist A-Z')
  XLSX.utils.book_append_sheet(wb,
    XLSX.utils.json_to_sheet(todos.length ? todos : [{ Info: 'Nenhum candidato.' }]),
    'Todos os Candidatos')

  const buf  = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const nome = `shortlist-accor-${new Date().toISOString().slice(0, 10)}.xlsx`
  res.set({
    'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${nome}"`,
  })
  res.send(buf)
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizePhone(phone) {
  const d = phone.replace(/\D/g, '')
  if (d.length === 10 || d.length === 11) return '55' + d
  return d
}

function buildWAMessage(name, job) {
  return `Olá, ${name}! Temos boas notícias sobre sua candidatura para ${job}.\nVocê avançou para a próxima fase! Gostaríamos de saber se você tem interesse em seguir para a próxima fase. Por favor, responda essa mensagem com *SIM* ou *NÃO*.`
}

async function sendWhatsApp(phone, text) {
  try {
    await wa.sendMessage(phone, text)
    return { ok: true }
  } catch (err) {
    console.log(`[WhatsApp MOCK] -> ${phone}: ${text.slice(0, 60)}... (${err.message})`)
    return { simulated: true }
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

module.exports = router
module.exports.broadcastWA = broadcastWA
module.exports.processIncomingMessage = processIncomingMessage
