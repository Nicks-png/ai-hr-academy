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

    // Admin vê tudo; outros veem posts globais (team_id IS NULL) + posts do seu time
    let posts
    if (req.user.role === 'admin') {
      posts = await db.all(`
        SELECT p.*, u.name as author_name, u.role as author_role,
          t.name as team_name,
          (SELECT COUNT(*) FROM intranet_reactions WHERE post_id = p.id) as reaction_count,
          (SELECT COUNT(*) FROM intranet_read_receipts WHERE post_id = p.id) as read_count
        FROM intranet_posts p
        LEFT JOIN intranet_users u ON p.author_id = u.id
        LEFT JOIN teams t ON p.team_id = t.id
        WHERE p.status = ?
        ORDER BY p.pinned DESC, p.created_at DESC
      `, [status])
    } else {
      const userTeams = await db.all('SELECT team_id FROM user_teams WHERE user_id = ?', [req.user.id])
      const teamIds   = userTeams.map(r => r.team_id)
      const placeholders = teamIds.length ? teamIds.map(() => '?').join(',') : 'NULL'
      posts = await db.all(`
        SELECT p.*, u.name as author_name, u.role as author_role,
          t.name as team_name,
          (SELECT COUNT(*) FROM intranet_reactions WHERE post_id = p.id) as reaction_count,
          (SELECT COUNT(*) FROM intranet_read_receipts WHERE post_id = p.id) as read_count
        FROM intranet_posts p
        LEFT JOIN intranet_users u ON p.author_id = u.id
        LEFT JOIN teams t ON p.team_id = t.id
        WHERE p.status = ?
          AND (p.team_id IS NULL ${teamIds.length ? `OR p.team_id IN (${placeholders})` : ''})
        ORDER BY p.pinned DESC, p.created_at DESC
      `, [status, ...teamIds])
    }

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
    const { type = 'news', title, content, pinned = 0, team_id = null } = req.body
    if (!title?.trim() || !content?.trim())
      return res.status(400).json({ error: 'Título e conteúdo são obrigatórios.' })

    const status = req.user.role === 'admin' ? 'published' : 'pending'
    const r = await db.run(`
      INSERT INTO intranet_posts (author_id, type, title, content, status, pinned, team_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [req.user.id, type, title.trim(), content.trim(), status,
        pinned && req.user.role === 'admin' ? 1 : 0,
        team_id || null])

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
    const VALID_ROLES = ['rh', 'manager', 'employee']
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Role inválida.' })
    await db.run(
      'INSERT INTO tool_permissions (role, tool_key, is_enabled) VALUES (?,?,?) ON CONFLICT(role,tool_key) DO UPDATE SET is_enabled=excluded.is_enabled',
      [role, tool_key, is_enabled ? 1 : 0]
    )
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
    const month = String(new Date().getMonth() + 1).padStart(2, '0')
    const [cands, posts, bdays] = await Promise.all([
      db.get(`SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='Pendente'   THEN 1 ELSE 0 END) as pendentes,
        SUM(CASE WHEN status='Confirmado' THEN 1 ELSE 0 END) as confirmados,
        SUM(CASE WHEN source='organico'   THEN 1 ELSE 0 END) as organicos
        FROM candidates`),
      db.get(`SELECT
        SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) as postsPublished,
        SUM(CASE WHEN status='pending'   THEN 1 ELSE 0 END) as pendingModeration
        FROM intranet_posts`),
      db.all(
        "SELECT name, birth_date FROM intranet_users WHERE is_active=1 AND birth_date IS NOT NULL AND strftime('%m', birth_date) = ?",
        [month]
      ),
    ])
    res.json({
      total:              cands?.total       ?? 0,
      pendentes:          cands?.pendentes   ?? 0,
      confirmados:        cands?.confirmados ?? 0,
      organicos:          cands?.organicos   ?? 0,
      postsPublished:     posts?.postsPublished     ?? 0,
      pendingModeration:  posts?.pendingModeration  ?? 0,
      birthdaysThisMonth: bdays,
    })
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

    // Admin vê pipeline global; outros veem só do seu time (via screenings)
    const isAdmin  = req.user.role === 'admin'
    const hoje     = new Date().toISOString().slice(0, 10)
    const seteDias = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)

    let teamFilter = ''
    let teamParams = []
    if (!isAdmin) {
      const userTeams = await db.all('SELECT team_id FROM user_teams WHERE user_id = ?', [req.user.id])
      if (userTeams.length) {
        const ids = userTeams.map(r => r.team_id)
        teamFilter = `AND team_id IN (${ids.map(() => '?').join(',')})`
        teamParams = ids
      } else {
        teamFilter = 'AND created_by_user_id = ?'
        teamParams = [req.user.id]
      }
    }

    const [countsRow, screeningStats, topVagas] = await Promise.all([
      db.get(`SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='Aprovado na Triagem' THEN 1 ELSE 0 END) as s0,
        SUM(CASE WHEN status='Contato enviado'     THEN 1 ELSE 0 END) as s1,
        SUM(CASE WHEN status='Confirmado'          THEN 1 ELSE 0 END) as s2,
        SUM(CASE WHEN status='Resposta manual'     THEN 1 ELSE 0 END) as s3,
        SUM(CASE WHEN status='Recusado'            THEN 1 ELSE 0 END) as s4
        FROM candidates`),
      db.get(`SELECT
        SUM(CASE WHEN date(created_at) >= ? THEN 1 ELSE 0 END)                   as tri,
        SUM(CASE WHEN date(created_at) >= ? THEN COALESCE(total,0) ELSE 0 END)   as cvs,
        SUM(CASE WHEN date(created_at) =  ? THEN 1 ELSE 0 END)                   as hoje
        FROM screenings WHERE 1=1 ${teamFilter}`,
        [seteDias, seteDias, hoje, ...teamParams]),
      db.all('SELECT job_position as titulo, COUNT(*) as count FROM candidates GROUP BY job_position ORDER BY count DESC LIMIT 4'),
    ])

    const total    = countsRow?.total ?? 0
    const byStatus = STAGES.map((s, i) => ({
      ...s,
      count: countsRow?.[`s${i}`] ?? 0,
    }))

    res.json({
      total,
      byStatus,
      triagensHoje:         screeningStats?.hoje ?? 0,
      triagensUltimos7Dias: screeningStats?.tri  ?? 0,
      cvsUltimos7Dias:      screeningStats?.cvs  ?? 0,
      topVagas,
    })
  } catch (err) {
    console.error('[pipeline]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

module.exports = router
