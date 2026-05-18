'use strict'
const express     = require('express')
const bcrypt      = require('bcryptjs')
const router      = express.Router()
const db          = require('../../db')
const { auth, requireRole } = require('../middleware/auth')

// ── Posts ─────────────────────────────────────────────────────────────────────
router.get('/api/intranet/posts', auth, async (req, res) => {
  try {
    const status = req.query.status || 'published'
    const posts  = await db.all(`
      SELECT p.*, u.name as author_name, u.role as author_role,
        (SELECT COUNT(*) FROM intranet_reactions WHERE post_id = p.id) as reaction_count,
        (SELECT COUNT(*) FROM intranet_read_receipts WHERE post_id = p.id) as read_count
      FROM intranet_posts p
      LEFT JOIN intranet_users u ON p.author_id = u.id
      WHERE p.status = ?
      ORDER BY p.pinned DESC, p.created_at DESC
    `, [status])

    const result = []
    for (const p of posts) {
      const reactions = await db.all(
        'SELECT emoji, COUNT(*) as count FROM intranet_reactions WHERE post_id = ? GROUP BY emoji',
        [p.id]
      )
      const myReactionRows = await db.all(
        'SELECT emoji FROM intranet_reactions WHERE post_id = ? AND user_id = ?',
        [p.id, req.user.id]
      )
      const myReactions = myReactionRows.map(r => r.emoji)
      const readRow = await db.get(
        'SELECT 1 FROM intranet_read_receipts WHERE post_id = ? AND user_id = ?',
        [p.id, req.user.id]
      )
      result.push({ ...p, reactions, myReactions, isRead: !!readRow })
    }

    res.json(result)
  } catch (err) {
    console.error('[intranet/posts GET]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

router.post('/api/intranet/posts', ...requireRole('rh', 'manager', 'admin'), async (req, res) => {
  try {
    const { type = 'news', title, content, pinned = 0 } = req.body
    if (!title?.trim() || !content?.trim())
      return res.status(400).json({ error: 'Título e conteúdo são obrigatórios.' })

    const status = req.user.role === 'admin' ? 'published' : 'pending'
    const r = await db.run(`
      INSERT INTO intranet_posts (author_id, type, title, content, status, pinned)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [req.user.id, type, title.trim(), content.trim(), status,
        pinned && req.user.role === 'admin' ? 1 : 0])

    res.json({ ok: true, id: r.lastInsertRowid, status })
  } catch (err) {
    console.error('[intranet/posts POST]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

router.patch('/api/intranet/posts/:id/status', ...requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.body
    if (!['published', 'rejected'].includes(status))
      return res.status(400).json({ error: 'Status inválido.' })
    await db.run(
      `UPDATE intranet_posts SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
      [status, req.params.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[intranet/posts PATCH status]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

router.post('/api/intranet/posts/:id/react', auth, async (req, res) => {
  try {
    const { emoji } = req.body
    if (!emoji) return res.status(400).json({ error: 'Emoji obrigatório.' })
    const exists = await db.get(
      'SELECT id FROM intranet_reactions WHERE post_id = ? AND user_id = ? AND emoji = ?',
      [req.params.id, req.user.id, emoji]
    )
    if (exists) {
      await db.run('DELETE FROM intranet_reactions WHERE id = ?', [exists.id])
      res.json({ ok: true, action: 'removed' })
    } else {
      await db.run('INSERT INTO intranet_reactions (post_id, user_id, emoji) VALUES (?,?,?)',
        [req.params.id, req.user.id, emoji])
      res.json({ ok: true, action: 'added' })
    }
  } catch (err) {
    console.error('[intranet/posts react]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

router.post('/api/intranet/posts/:id/read', auth, async (req, res) => {
  try {
    await db.run('INSERT OR IGNORE INTO intranet_read_receipts (post_id, user_id) VALUES (?,?)',
      [req.params.id, req.user.id])
  } catch (_) {}
  res.json({ ok: true })
})

// ── Documents ─────────────────────────────────────────────────────────────────
router.get('/api/intranet/documents', auth, async (req, res) => {
  try {
    const { category } = req.query
    let q = 'SELECT d.*, u.name as author_name FROM intranet_documents d LEFT JOIN intranet_users u ON d.author_id = u.id WHERE d.is_active = 1'
    const params = []
    if (category) { q += ' AND d.category = ?'; params.push(category) }
    q += ' ORDER BY d.created_at DESC'
    res.json(await db.all(q, params))
  } catch (err) {
    console.error('[intranet/documents GET]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

router.post('/api/intranet/documents', ...requireRole('admin', 'rh'), async (req, res) => {
  try {
    const { title, category = 'geral', url, content, description, version = '1.0' } = req.body
    if (!title?.trim()) return res.status(400).json({ error: 'Título obrigatório.' })
    if (!url?.trim() && !content?.trim())
      return res.status(400).json({ error: 'Informe um URL ou o conteúdo do documento.' })
    const r = await db.run(`
      INSERT INTO intranet_documents (author_id, title, category, url, content, description, version)
      VALUES (?,?,?,?,?,?,?)
    `, [req.user.id, title.trim(), category, url?.trim() || null, content?.trim() || null,
        description?.trim() || null, version])
    res.json({ ok: true, id: r.lastInsertRowid })
  } catch (err) {
    console.error('[intranet/documents POST]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

router.delete('/api/intranet/documents/:id', ...requireRole('admin'), async (req, res) => {
  try {
    await db.run('UPDATE intranet_documents SET is_active = 0 WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('[intranet/documents DELETE]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// ── Users (diretório) ─────────────────────────────────────────────────────────
router.get('/api/intranet/users', auth, async (req, res) => {
  try {
    const users = await db.all(
      'SELECT id,name,email,role,department,avatar_url,birth_date,is_active,created_at FROM intranet_users ORDER BY name'
    )
    res.json(users)
  } catch (err) {
    console.error('[intranet/users GET]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

router.post('/api/intranet/users', ...requireRole('admin'), async (req, res) => {
  try {
    const { name, email, password, role = 'employee', department, avatar_url, birth_date } = req.body
    if (!name?.trim() || !email?.trim() || !password)
      return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' })
    const VALID_ROLES = ['admin', 'rh', 'manager', 'employee']
    if (!VALID_ROLES.includes(role))
      return res.status(400).json({ error: 'Role inválida.' })
    if (password.length < 6)
      return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres.' })
    const hash = await bcrypt.hash(password, 10)
    try {
      const r = await db.run(`
        INSERT INTO intranet_users (name, email, password_hash, role, department, avatar_url, birth_date)
        VALUES (?,?,?,?,?,?,?)
      `, [name.trim(), email.trim().toLowerCase(), hash, role,
          department?.trim() || null, avatar_url?.trim() || null, birth_date || null])
      res.json({ ok: true, id: r.lastInsertRowid })
    } catch (err) {
      if (err.message?.includes('UNIQUE'))
        return res.status(409).json({ error: 'E-mail já cadastrado.' })
      throw err
    }
  } catch (err) {
    console.error('[intranet/users POST]', err)
    res.status(500).json({ error: 'Erro ao criar usuário.' })
  }
})

router.patch('/api/intranet/users/:id', ...requireRole('admin'), async (req, res) => {
  try {
    const { name, role, department, avatar_url, birth_date, is_active, password } = req.body
    const user = await db.get('SELECT * FROM intranet_users WHERE id = ?', [req.params.id])
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' })
    const VALID_ROLES = ['admin', 'rh', 'manager', 'employee']
    if (role && !VALID_ROLES.includes(role))
      return res.status(400).json({ error: 'Role inválida.' })
    if (password && password.length < 6)
      return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres.' })

    const updates = {
      name:       name?.trim()             ?? user.name,
      role:       role                     ?? user.role,
      department: department?.trim()       ?? user.department,
      avatar_url: avatar_url?.trim()       ?? user.avatar_url,
      birth_date: birth_date               ?? user.birth_date,
      is_active:  is_active !== undefined  ? (is_active ? 1 : 0) : user.is_active,
      password_hash: password ? await bcrypt.hash(password, 10) : user.password_hash,
    }

    await db.run(`
      UPDATE intranet_users SET name=?,role=?,department=?,avatar_url=?,birth_date=?,is_active=?,password_hash=?
      WHERE id=?
    `, [updates.name, updates.role, updates.department, updates.avatar_url,
        updates.birth_date, updates.is_active, updates.password_hash, req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('[intranet/users PATCH]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

router.delete('/api/intranet/users/:id', ...requireRole('admin'), async (req, res) => {
  try {
    await db.run('UPDATE intranet_users SET is_active = 0 WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('[intranet/users DELETE]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// ── Tool permissions ──────────────────────────────────────────────────────────
router.get('/api/intranet/permissions', ...requireRole('admin'), async (req, res) => {
  try {
    res.json(await db.all('SELECT role, tool_key, is_enabled FROM tool_permissions ORDER BY role, tool_key'))
  } catch (err) {
    console.error('[intranet/permissions GET]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

router.patch('/api/intranet/permissions', ...requireRole('admin'), async (req, res) => {
  try {
    const { role, tool_key, is_enabled } = req.body
    if (!role || !tool_key) return res.status(400).json({ error: 'role e tool_key obrigatórios.' })
    if (role === 'admin') return res.status(400).json({ error: 'Permissões do admin não podem ser alteradas.' })
    await db.run('UPDATE tool_permissions SET is_enabled = ? WHERE role = ? AND tool_key = ?',
      [is_enabled ? 1 : 0, role, tool_key])
    res.json({ ok: true })
  } catch (err) {
    console.error('[intranet/permissions PATCH]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

router.get('/api/intranet/my-tools', auth, async (req, res) => {
  try {
    const rows = await db.all(
      'SELECT tool_key FROM tool_permissions WHERE role = ? AND is_enabled = 1',
      [req.user.role]
    )
    res.json(rows.map(r => r.tool_key))
  } catch (err) {
    console.error('[intranet/my-tools]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// ── Stats integrados ──────────────────────────────────────────────────────────
router.get('/api/intranet/stats', ...requireRole('rh', 'admin'), async (req, res) => {
  try {
    const total       = (await db.get('SELECT COUNT(*) as count FROM candidates')).count
    const pendentes   = (await db.get("SELECT COUNT(*) as count FROM candidates WHERE status='Pendente'")).count
    const confirmados = (await db.get("SELECT COUNT(*) as count FROM candidates WHERE status='Confirmado'")).count
    const organicos   = (await db.get("SELECT COUNT(*) as count FROM candidates WHERE source='organico'")).count
    const postsPub    = (await db.get("SELECT COUNT(*) as count FROM intranet_posts WHERE status='published'")).count
    const pendMod     = (await db.get("SELECT COUNT(*) as count FROM intranet_posts WHERE status='pending'")).count

    const now   = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const bdays = await db.all(
      "SELECT name, birth_date FROM intranet_users WHERE is_active=1 AND birth_date IS NOT NULL AND strftime('%m', birth_date) = ?",
      [month]
    )

    res.json({ total, pendentes, confirmados, organicos, postsPublished: postsPub,
               pendingModeration: pendMod, birthdaysThisMonth: bdays })
  } catch (err) {
    console.error('[intranet/stats]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// ── Pipeline resumo ───────────────────────────────────────────────────────────
router.get('/api/intranet/pipeline', ...requireRole('rh', 'admin'), async (req, res) => {
  try {
    const STAGES = [
      { key: 'Aprovado na Triagem', label: 'Triados',         color: 'purple' },
      { key: 'Contato enviado',     label: 'Contato enviado', color: 'cyan'   },
      { key: 'Confirmado',          label: 'Confirmados',     color: 'green'  },
      { key: 'Resposta manual',     label: 'Resp. manual',    color: 'amber'  },
      { key: 'Recusado',            label: 'Recusados',       color: 'red'    },
    ]

    const totalRow = await db.get('SELECT COUNT(*) as n FROM candidates')
    const total    = totalRow?.n ?? 0

    const byStatus = await Promise.all(STAGES.map(async s => ({
      ...s,
      count: (await db.get('SELECT COUNT(*) as n FROM candidates WHERE status=?', [s.key]))?.n ?? 0,
    })))

    const hoje     = new Date().toISOString().slice(0, 10)
    const seteDias = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    const semana   = await db.get(
      "SELECT COUNT(*) as tri, COALESCE(SUM(total),0) as cvs FROM screenings WHERE date(created_at) >= ?",
      [seteDias]
    )
    const hojeRow  = await db.get(
      "SELECT COUNT(*) as n FROM screenings WHERE date(created_at) = ?",
      [hoje]
    )

    const topVagas = await db.all(
      'SELECT job_position as titulo, COUNT(*) as count FROM candidates GROUP BY job_position ORDER BY count DESC LIMIT 4'
    )

    res.json({
      total,
      byStatus,
      triagensHoje:         hojeRow?.n ?? 0,
      triagensUltimos7Dias: semana?.tri ?? 0,
      cvsUltimos7Dias:      semana?.cvs ?? 0,
      topVagas,
    })
  } catch (err) {
    console.error('[pipeline]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

module.exports = router
