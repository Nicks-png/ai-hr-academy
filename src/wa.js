/**
 * wa.js — Conexão WhatsApp via Baileys (sem Docker, sem Evolution API)
 * Salva credenciais em .wa-auth/ — após escanear o QR uma vez, reconecta automaticamente.
 */
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys')
const QRCode = require('qrcode')
const path   = require('path')
const pino   = require('pino')

const AUTH_DIR = path.join(__dirname, '../.wa-auth')

const logger = pino({ level: 'silent' })

let sock        = null
let qrDataURL   = null   // base64 PNG para exibir no browser
let connected   = false
let onMsg       = null   // callback(phone, text)
let _broadcast  = null   // SSE broadcast function

// ── Inicializa e mantém a conexão ──────────────────────────────────────────────
async function connect(messageCallback, broadcastFn) {
  onMsg      = messageCallback
  _broadcast = broadcastFn

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

  let version
  try {
    const res = await fetchLatestBaileysVersion()
    version   = res.version
  } catch {
    version = [2, 3000, 1015901307]  // fallback estável
  }

  sock = makeWASocket({
    version,
    auth:              state,
    printQRInTerminal: true,
    logger,
    browser:           ['AI-HR Academy', 'Chrome', '120.0'],
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
      const code    = lastDisconnect?.error?.output?.statusCode
      const loggedOut = code === DisconnectReason.loggedOut
      console.log(`[WhatsApp] Conexão fechada (${code}). ${loggedOut ? 'Deslogado.' : 'Reconectando...'}`)
      _broadcast?.({ type: 'wa_status', connected: false, qr: false })
      if (!loggedOut) setTimeout(() => connect(onMsg, _broadcast), 4000)
    }
  })

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      if (msg.key.fromMe) continue
      const phone = msg.key.remoteJid?.replace('@s.whatsapp.net', '')
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

// ── Status ─────────────────────────────────────────────────────────────────────
function getQR()     { return qrDataURL }
function getStatus() { return { connected, hasQR: !!qrDataURL } }

module.exports = { connect, sendMessage, getQR, getStatus }
