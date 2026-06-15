/**
 * wa.js — Conexão WhatsApp via Baileys
 * Credenciais persistidas no Turso (tabela wa_auth) — sobrevive a redeploys no Render.
 */
const {
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  initAuthCreds,
  BufferJSON,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys')
const QRCode = require('qrcode')
const pino   = require('pino')
const db     = require('../db')

const logger = pino({ level: 'silent' })

let sock             = null
let qrDataURL        = null
let connected        = false
let onMsg            = null
let _broadcast       = null
let manualDisconnect = false

// ── Auth state persistido no Turso ────────────────────────────────────────────
async function useTursoAuthState() {
  const write = async (key, data) => {
    const value = JSON.stringify(data, BufferJSON.replacer)
    await db.run('INSERT OR REPLACE INTO wa_auth (key, value) VALUES (?, ?)', [key, value])
  }

  const read = async (key) => {
    const row = await db.get('SELECT value FROM wa_auth WHERE key = ?', [key])
    if (!row) return null
    try { return JSON.parse(row.value, BufferJSON.reviver) } catch { return null }
  }

  const remove = async (key) => {
    await db.run('DELETE FROM wa_auth WHERE key = ?', [key])
  }

  const creds = (await read('creds')) || initAuthCreds()

  return {
    state: {
      creds,
      keys: makeCacheableSignalKeyStore({
        get: async (type, ids) => {
          const data = {}
          await Promise.all(ids.map(async (id) => {
            const value = await read(`${type}-${id}`)
            if (value != null) data[id] = value
          }))
          return data
        },
        set: async (data) => {
          await Promise.all(
            Object.entries(data).flatMap(([category, entries]) =>
              Object.entries(entries).map(([id, value]) =>
                value != null
                  ? write(`${category}-${id}`, value)
                  : remove(`${category}-${id}`)
              )
            )
          )
        },
      }, logger),
    },
    saveCreds: () => write('creds', creds),
  }
}

// ── Inicializa e mantém a conexão ──────────────────────────────────────────────
async function connect(messageCallback, broadcastFn) {
  onMsg      = messageCallback
  _broadcast = broadcastFn

  const { state, saveCreds } = await useTursoAuthState()

  let version
  try {
    const res = await fetchLatestBaileysVersion()
    version   = res.version
  } catch {
    version = [2, 3000, 1015901307]
  }

  sock = makeWASocket({
    version,
    auth:               state,
    printQRInTerminal:  true,
    logger,
    browser:            ['AI-HR Academy', 'Chrome', '120.0'],
    markOnlineOnConnect: false,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      try { qrDataURL = await QRCode.toDataURL(qr) } catch { qrDataURL = null }
      connected = false
      console.log('[WhatsApp] QR Code gerado — acesse /api/whatsapp/qr ou veja o terminal')
      _broadcast?.({ type: 'wa_status', connected: false, qr: true })
    }

    if (connection === 'open') {
      qrDataURL = null
      connected = true
      console.log('[WhatsApp] Conectado com sucesso!')
      _broadcast?.({ type: 'wa_status', connected: true, qr: false })
    }

    if (connection === 'close') {
      connected = false
      const code      = lastDisconnect?.error?.output?.statusCode
      const loggedOut = code === DisconnectReason.loggedOut
      console.log(`[WhatsApp] Conexão fechada (${code}). ${loggedOut ? 'Deslogado.' : 'Reconectando...'}`)
      _broadcast?.({ type: 'wa_status', connected: false, qr: false })
      if (!loggedOut && !manualDisconnect) setTimeout(() => connect(onMsg, _broadcast), 4000)
    }
  })

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      if (msg.key.fromMe) continue
      const phone = msg.key.remoteJid?.replace(/@(s\.whatsapp\.net|lid|c\.us|g\.us)$/i, '')
      const text  = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption || ''
      ).trim()
      if (phone && text) {
        console.log(`[WhatsApp] <- ${phone}: ${text}`)
        onMsg?.(phone, text)
      }
    }
  })
}

// ── Enviar mensagem ────────────────────────────────────────────────────────────
async function sendMessage(phone, text) {
  if (!sock || !connected) throw new Error('WhatsApp não conectado. Escaneie o QR Code primeiro.')
  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`
  await sock.sendMessage(jid, { text })
}

// ── Desconectar manualmente ────────────────────────────────────────────────────
async function disconnect() {
  manualDisconnect = true
  if (sock) {
    try { await sock.logout() } catch { /* ignora */ }
    sock = null
  }
  connected = false
  qrDataURL = null
}

// ── Limpar sessão salva (força novo QR scan) ───────────────────────────────────
async function clearSession() {
  await db.run('DELETE FROM wa_auth')
  console.log('[WhatsApp] Sessão apagada do banco — reconecte escaneando o QR.')
}

// ── Status ─────────────────────────────────────────────────────────────────────
function getQR()     { return qrDataURL }
function getStatus() { return { connected, hasQR: !!qrDataURL } }

module.exports = { connect, disconnect, sendMessage, getQR, getStatus, clearSession }
