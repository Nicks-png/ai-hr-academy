'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const wa      = require('../wa')

// ── SSE broadcast ──────────────────────────────────────────────────────────
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

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(heartbeat); sseWAClients.delete(res) }
  }, 25000)

  req.on('close', () => { clearInterval(heartbeat); sseWAClients.delete(res) })
})

function broadcastWA(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`
  sseWAClients.forEach(r => {
    try { r.write(msg) } catch { sseWAClients.delete(r) }
  })
}

// ── Candidates ────────────────────────────────────────────────────────────────

router.get('/api/candidates', async (req, res) => {
  try {
    const { source, job } = req.query
    let q = 'SELECT * FROM candidates WHERE 1=1'
    const params = []
    if (source) { q += ' AND source = ?'; params.push(source) }
    if (job)    { q += ' AND job_position LIKE ?'; params.push(`%${job}%`) }
    q += ' ORDER BY created_at DESC'
    res.json(await db.all(q, params))
  } catch (err) {
    console.error('[candidates GET]', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/api/candidates', async (req, res) => {
  try {
    const { name, phone, job_position, job_id } = req.body || {}
    if (!name?.trim() || !phone?.trim() || !job_position?.trim())
      return res.status(400).json({ error: 'name, phone e job_position são obrigatórios.' })
    try {
      const r = await db.run(
        'INSERT INTO candidates (name, phone, job_position, job_id) VALUES (?,?,?,?)',
        [name.trim(), normalizePhone(phone), job_position.trim(), job_id?.trim() || null]
      )
      res.json({ id: r.lastInsertRowid, ok: true })
    } catch (err) {
      if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Telefone já cadastrado.' })
      throw err
    }
  } catch (err) {
    console.error('[candidates POST]', err)
    res.status(500).json({ error: err.message })
  }
})

router.delete('/api/candidates/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM candidates WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('[candidates DELETE]', err)
    res.status(500).json({ error: err.message })
  }
})

// Avançar selecionados → disparar WhatsApp
router.post('/api/candidates/advance', async (req, res) => {
  const { ids, entries } = req.body || {}
  const list = entries || (ids || []).map(id => ({ id }))
  if (!Array.isArray(list) || !list.length)
    return res.status(400).json({ error: 'ids[] required' })

  const results = []
  for (const entry of list) {
    const id = Number(entry.id || entry)
    const c = await db.get('SELECT * FROM candidates WHERE id = ?', [id])
    if (!c) { results.push({ id, ok: false, error: 'not found' }); continue }
    if (c.status !== 'Pendente' && c.status !== 'Aprovado na Triagem') { results.push({ id, ok: false, skipped: true, status: c.status }); continue }

    const msg = entry.message?.trim() || buildWAMessage(c.name, c.job_position)
    try {
      const sent = await sendWhatsApp(c.phone, msg)
      if (sent.simulated) {
        results.push({ id, ok: false, simulated: true, error: 'Candidato sem telefone real. Adicione um número WhatsApp.' })
        continue
      }
      await db.run(
        "UPDATE candidates SET status='Contato enviado', contacted_at=datetime('now','localtime') WHERE id=?",
        [id]
      )
      await db.run('INSERT INTO messages_sent (candidate_id, message, success) VALUES (?,?,1)', [id, msg])
      await db.run(
        'INSERT INTO candidate_history (candidate_id, old_status, new_status, changed_by) VALUES (?,?,?,?)',
        [id, c.status, 'Contato enviado', 'RH']
      )
      const updated = await db.get('SELECT * FROM candidates WHERE id=?', [id])
      broadcastWA({ type: 'status_update', candidate: updated })
      results.push({ id, ok: true })
      await delay(1200)
    } catch (err) {
      await db.run('INSERT INTO messages_sent (candidate_id, message, success, error_msg) VALUES (?,?,0,?)', [id, msg, err.message])
      results.push({ id, ok: false, error: err.message })
    }
  }
  res.json({ results })
})

// ── Responses ─────────────────────────────────────────────────────────────────

router.get('/api/responses', async (_req, res) => {
  try {
    res.json(await db.all(`
      SELECT r.*, c.name AS candidate_name, c.job_position, c.status AS candidate_status
      FROM   messages_received r
      LEFT JOIN candidates c ON c.id = r.candidate_id
      ORDER  BY r.received_at DESC
    `))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/api/responses/unread-count', async (_req, res) => {
  try {
    const row = await db.get('SELECT COUNT(*) as n FROM messages_received WHERE is_read=0')
    res.json({ count: row.n })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/api/candidatos/pendentes-organicos', async (_req, res) => {
  try {
    const row = await db.get(
      "SELECT COUNT(*) as n FROM candidates WHERE source='organico' AND status='Pendente'"
    )
    res.json({ count: row.n })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/api/responses/:id/read', async (req, res) => {
  try {
    await db.run('UPDATE messages_received SET is_read=1 WHERE id=?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Webhook (Evolution API → nosso backend) ─────────────────────────────────────────

router.post('/webhook/whatsapp', (req, res) => {
  const secret = process.env.WEBHOOK_SECRET
  if (secret) {
    const provided = req.headers['x-webhook-secret'] || req.headers['x-api-key'] || ''
    if (provided !== secret) return res.sendStatus(401)
  }
  try {
    const msgData = req.body?.data
    if (!msgData) return res.sendStatus(200)
    const jid  = msgData?.key?.remoteJid || ''
    const from = jid.replace(/@(s\.whatsapp\.net|lid|c\.us|g\.us)$/i, '')
    const text = (
      msgData?.message?.conversation ||
      msgData?.message?.extendedTextMessage?.text ||
      msgData?.message?.imageMessage?.caption || ''
    ).trim()
    if (!from || !text || msgData?.key?.fromMe) return res.sendStatus(200)
    // fire-and-forget async processing
    processIncomingMessage(from, text).catch(e => console.error('[Webhook] processIncomingMessage:', e.message))
    res.sendStatus(200)
  } catch (err) {
    console.error('[Webhook]', err.message)
    res.sendStatus(500)
  }
})

// Simulação local de resposta (para testes sem telefone real)
router.post('/webhook/test', (req, res) => {
  const { phone, text } = req.body || {}
  if (!phone || !text) return res.status(400).json({ error: 'phone e text required' })
  processIncomingMessage(phone.replace(/\D/g, ''), text).catch(e => console.error('[Webhook/test]', e.message))
  res.json({ ok: true })
})

async function processIncomingMessage(phone, text) {
  const c = await db.get('SELECT * FROM candidates WHERE phone=?', [phone])
  if (!c) return

  const ins = await db.run(
    'INSERT INTO messages_received (candidate_id, phone, message) VALUES (?,?,?)',
    [c.id, phone, text]
  )

  if (c.status === 'Contato enviado') {
    const norm = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
    const isYes = /\b(sim|s|claro|pode|quero|aceito|confirmo|com certeza|obvio|obv|top|topo|vou|interessado|interesse|ok|okay|yes|bora)\b/.test(norm)
    const isNo  = /\b(nao|n|nope|no|recuso|nao quero|nao posso|nao da|nada|cancel)\b/.test(norm)
    const newStatus = isYes ? 'Confirmado' : isNo ? 'Recusado' : 'Resposta manual'
    await db.run(
      "UPDATE candidates SET status=?, confirmed_at=datetime('now','localtime') WHERE id=?",
      [newStatus, c.id]
    )
    await db.run(
      'INSERT INTO candidate_history (candidate_id, old_status, new_status, changed_by, note) VALUES (?,?,?,?,?)',
      [c.id, 'Contato enviado', newStatus, 'WhatsApp (Automático)', text.slice(0, 120)]
    )
  }

  const newRow  = await db.get('SELECT * FROM messages_received WHERE id=?', [ins.lastInsertRowid])
  const updated = await db.get('SELECT * FROM candidates WHERE id=?', [c.id])
  broadcastWA({ type: 'new_response', message: newRow, candidate: updated })
}

// ── WhatsApp status / QR / connect / disconnect ────────────────────────────────

router.get('/api/whatsapp/status', (_req, res) => {
  res.json({ configured: true, ...wa.getStatus() })
})

router.get('/api/whatsapp/qr', (_req, res) => {
  const qr = wa.getQR()
  if (!qr) return res.json({ qr: null, connected: wa.getStatus().connected })
  res.json({ qr })
})

router.post('/api/whatsapp/connect', async (_req, res) => {
  if (wa.getStatus().connected) return res.json({ ok: true, already: true })
  try {
    wa.connect(processIncomingMessage, broadcastWA).catch(e =>
      console.warn('[WhatsApp] Falha ao conectar:', e.message))
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/api/whatsapp/disconnect', async (_req, res) => {
  try {
    await wa.disconnect()
    broadcastWA({ type: 'wa_status', connected: false, qr: false })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Shortlist Excel ─────────────────────────────────────────────────────────────────

router.get('/api/shortlist/excel', async (_req, res) => {
  try {
    const XLSX = require('xlsx')
    const all  = await db.all('SELECT * FROM candidates ORDER BY name COLLATE NOCASE ASC')

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
  } catch (err) {
    console.error('[shortlist/excel]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Helpers ─────────────────────────────────────────────────────────────────────

function normalizePhone(phone) {
  const d = phone.replace(/\D/g, '')
  if (d.length === 10 || d.length === 11) return '55' + d
  return d
}

function buildWAMessage(name, job) {
  return `Olá, ${name}! Temos boas notícias sobre sua candidatura para ${job}.\nVocê avançou para a próxima fase! Gostaríamos de saber se você tem interesse em seguir para a próxima fase. Por favor, responda essa mensagem com *SIM* ou *NÃO*.`
}

async function sendWhatsApp(phone, text) {
  const isRealPhone = /^\d{10,15}$/.test(phone)
  if (!isRealPhone) {
    console.log(`[WhatsApp MOCK] -> ${phone}: ${text.slice(0, 60)}...`)
    return { simulated: true }
  }
  await wa.sendMessage(phone, text)
  return { ok: true }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

module.exports = router
module.exports.broadcastWA = broadcastWA
module.exports.processIncomingMessage = processIncomingMessage
