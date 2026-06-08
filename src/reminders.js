'use strict'
const db = require('../db')

function startReminderLoop(sendFn) {
  check(sendFn)
  setInterval(() => check(sendFn), 15 * 60 * 1000)
}

async function check(sendFn) {
  try {
    const schedule = await db.get('SELECT * FROM interview_schedule ORDER BY id DESC LIMIT 1')
    if (!schedule) return

    const now      = new Date()
    const today    = now.toISOString().slice(0, 10)
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10)
    const hour     = now.getHours()

    const confirmed = (await db.all(
      "SELECT * FROM candidates WHERE status = 'Confirmado' AND phone IS NOT NULL"
    )).sort((a, b) => (b.ai_score_total || 0) - (a.ai_score_total || 0))

    for (let i = 0; i < confirmed.length && i < schedule.num_slots; i++) {
      const c    = confirmed[i]
      const slot = addMinutes(schedule.start_time, i * 30)
      const [y, m, d] = schedule.date.split('-')
      const dateFmt   = `${d}/${m}/${y}`

      // D-1: dia anterior a partir das 18h
      if (schedule.date === tomorrow && hour >= 18) {
        if (!(await alreadySent(c.id, 'd1', schedule.date))) {
          await safeSend(sendFn, c.phone, buildD1(c.name, dateFmt, slot, schedule.local))
          await markSent(c.id, 'd1', schedule.date)
          console.log(`[Lembrete D-1] → ${c.name} (${slot})`)
        }
      }

      // H-2: 1h45–2h15 antes do slot no dia da entrevista
      if (schedule.date === today) {
        const [sh, sm] = slot.split(':').map(Number)
        const diff = sh * 60 + sm - (hour * 60 + now.getMinutes())
        if (diff >= 105 && diff <= 135) {
          if (!(await alreadySent(c.id, 'h2', schedule.date))) {
            await safeSend(sendFn, c.phone, buildH2(c.name, slot, schedule.local))
            await markSent(c.id, 'h2', schedule.date)
            console.log(`[Lembrete H-2] → ${c.name} (${slot})`)
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Reminders] Erro no loop:', e.message)
  }
}

async function safeSend(sendFn, phone, msg) {
  try { await sendFn(phone, msg) } catch (e) { console.warn('[Reminders] Falha ao enviar:', e.message) }
}

async function alreadySent(candidateId, type, scheduleDate) {
  const row = await db.get(
    'SELECT 1 FROM reminders_sent WHERE candidate_id=? AND type=? AND schedule_date=?',
    [candidateId, type, scheduleDate]
  )
  return !!row
}

async function markSent(candidateId, type, scheduleDate) {
  await db.run(
    'INSERT OR IGNORE INTO reminders_sent (candidate_id, type, schedule_date) VALUES (?,?,?)',
    [candidateId, type, scheduleDate]
  )
}

function addMinutes(time, mins) {
  const [h, m] = (time || '08:00').split(':').map(Number)
  const total  = h * 60 + m + mins
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
}

function buildD1(nome, data, hora, local) {
  const primeiro = (nome || 'candidato').split(' ')[0]
  return `Olá, ${primeiro}! 👋\n\nLembramos que *amanhã* você tem entrevista agendada no Pullman Ibirapuera!\n\n📅 *Data:* ${data}\n⏰ *Horário:* ${hora}${local ? `\n📍 *Local:* ${local}` : ''}\n\nPor favor, compareça com 10 minutos de antecedência. Em caso de imprevisto, entre em contato conosco.\n\nAté amanhã! 😊`
}

function buildH2(nome, hora, local) {
  const primeiro = (nome || 'candidato').split(' ')[0]
  return `Olá, ${primeiro}! ⏰\n\nSua entrevista no Pullman Ibirapuera começa em *aproximadamente 2 horas!*\n\n⏰ *Horário:* ${hora}${local ? `\n📍 *Local:* ${local}` : ''}\n\nEstamos aguardando você. Boa sorte! 🌟`
}

module.exports = { startReminderLoop }
