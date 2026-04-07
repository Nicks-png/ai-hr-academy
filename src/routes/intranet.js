'use strict'
const express     = require('express')
const bcrypt      = require('bcryptjs')
const router      = express.Router()
const db          = require('../db')
const { auth, requireRole } = require('../middleware/auth')

// ── Posts ─────────────────────────────────────────────────────────────────────
router.get('/api/intranet/posts', auth, (req, res) => {
  const status = req.query.status || 'published'
  const posts  = db.prepare(`
    SELECT p.*, u.name as author_name, u.role as author_role,
      (SELECT COUNT(*) FROM intranet_reactions WHERE post_id = p.id) as reaction_count,
      (SELECT COUNT(*) FROM intranet_read_receipts WHERE post_id = p.id) as read_count
    FROM intranet_posts p
    LEFT JOIN intranet_users u ON p.author_id = u.id
    WHERE p.status = ?
    ORDER BY p.pinned DESC, p.created_at DESC
  `).all(status)

  // Attach reactions per post and read status for this user
  const result = posts.map(p => {
    const reactions = db.prepare(`
      SELECT emoji, COUNT(*) as count FROM intranet_reactions
      WHERE post_id = ? GROUP BY emoji
    `).all(p.id)
    const myReactions = db.prepare(
      'SELECT emoji FROM intranet_reactions WHERE post_id = ? AND user_id = ?'
    ).all(p.id, req.user.id).map(r => r.emoji)
    const isRead = !!db.prepare(
      'SELECT 1 FROM intranet_read_receipts WHERE post_id = ? AND user_id = ?'
    ).get(p.id, req.user.id)
    return { ...p, reactions, myReactions, isRead }
  })

  res.json(result)
})

router.post('/api/intranet/posts', ...requireRole('rh', 'manager', 'admin'), (req, res) => {
  const { type = 'news', title, content, pinned = 0 } = req.body
  if (!title?.trim() || !content?.trim())
    return res.status(400).json({ error: 'Título e conteúdo são obrigatórios.' })

  const status = req.user.role === 'admin' ? 'published' : 'pending'
  const r = db.prepare(`
    INSERT INTO intranet_posts (author_id, type, title, content, status, pinned)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.user.id, type, title.trim(), content.trim(), status,
         pinned && req.user.role === 'admin' ? 1 : 0)

  res.json({ ok: true, id: r.lastInsertRowid, status })
})

router.patch('/api/intranet/posts/:id/status', ...requireRole('admin'), (req, res) => {
  const { status } = req.body
  if (!['published', 'rejected'].includes(status))
    return res.status(400).json({ error: 'Status inválido.' })
  db.prepare(`UPDATE intranet_posts SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(status, req.params.id)
  res.json({ ok: true })
})

router.post('/api/intranet/posts/:id/react', auth, (req, res) => {
  const { emoji } = req.body
  if (!emoji) return res.status(400).json({ error: 'Emoji obrigatório.' })
  const exists = db.prepare(
    'SELECT id FROM intranet_reactions WHERE post_id = ? AND user_id = ? AND emoji = ?'
  ).get(req.params.id, req.user.id, emoji)
  if (exists) {
    db.prepare('DELETE FROM intranet_reactions WHERE id = ?').run(exists.id)
    res.json({ ok: true, action: 'removed' })
  } else {
    db.prepare('INSERT INTO intranet_reactions (post_id, user_id, emoji) VALUES (?,?,?)')
      .run(req.params.id, req.user.id, emoji)
    res.json({ ok: true, action: 'added' })
  }
})

router.post('/api/intranet/posts/:id/read', auth, (req, res) => {
  try {
    db.prepare('INSERT OR IGNORE INTO intranet_read_receipts (post_id, user_id) VALUES (?,?)')
      .run(req.params.id, req.user.id)
  } catch (_) {}
  res.json({ ok: true })
})

// ── Documents ─────────────────────────────────────────────────────────────────
router.get('/api/intranet/documents', auth, (req, res) => {
  const { category } = req.query
  let q = 'SELECT d.*, u.name as author_name FROM intranet_documents d LEFT JOIN intranet_users u ON d.author_id = u.id WHERE d.is_active = 1'
  const params = []
  if (category) { q += ' AND d.category = ?'; params.push(category) }
  q += ' ORDER BY d.created_at DESC'
  res.json(db.prepare(q).all(...params))
})

router.post('/api/intranet/documents', ...requireRole('admin', 'rh'), (req, res) => {
  const { title, category = 'geral', url, content, description, version = '1.0' } = req.body
  if (!title?.trim()) return res.status(400).json({ error: 'Título obrigatório.' })
  if (!url?.trim() && !content?.trim())
    return res.status(400).json({ error: 'Informe um URL ou o conteúdo do documento.' })
  const r = db.prepare(`
    INSERT INTO intranet_documents (author_id, title, category, url, content, description, version)
    VALUES (?,?,?,?,?,?,?)
  `).run(req.user.id, title.trim(), category, url?.trim() || null, content?.trim() || null,
         description?.trim() || null, version)
  res.json({ ok: true, id: r.lastInsertRowid })
})

router.delete('/api/intranet/documents/:id', ...requireRole('admin'), (req, res) => {
  db.prepare('UPDATE intranet_documents SET is_active = 0 WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ── Users (diretório) ─────────────────────────────────────────────────────────
router.get('/api/intranet/users', auth, (req, res) => {
  const users = db.prepare(
    'SELECT id,name,email,role,department,avatar_url,birth_date,is_active,created_at FROM intranet_users ORDER BY name'
  ).all()
  res.json(users)
})

router.post('/api/intranet/users', ...requireRole('admin'), (req, res) => {
  const { name, email, password, role = 'employee', department, avatar_url, birth_date } = req.body
  if (!name?.trim() || !email?.trim() || !password)
    return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' })
  const hash = bcrypt.hashSync(password, 10)
  try {
    const r = db.prepare(`
      INSERT INTO intranet_users (name, email, password_hash, role, department, avatar_url, birth_date)
      VALUES (?,?,?,?,?,?,?)
    `).run(name.trim(), email.trim().toLowerCase(), hash, role,
           department?.trim() || null, avatar_url?.trim() || null, birth_date || null)
    res.json({ ok: true, id: r.lastInsertRowid })
  } catch (err) {
    if (err.message?.includes('UNIQUE'))
      return res.status(409).json({ error: 'E-mail já cadastrado.' })
    res.status(500).json({ error: 'Erro ao criar usuário.' })
  }
})

router.patch('/api/intranet/users/:id', ...requireRole('admin'), (req, res) => {
  const { name, role, department, avatar_url, birth_date, is_active, password } = req.body
  const user = db.prepare('SELECT * FROM intranet_users WHERE id = ?').get(req.params.id)
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' })

  const updates = {
    name:       name?.trim()             ?? user.name,
    role:       role                     ?? user.role,
    department: department?.trim()       ?? user.department,
    avatar_url: avatar_url?.trim()       ?? user.avatar_url,
    birth_date: birth_date               ?? user.birth_date,
    is_active:  is_active !== undefined  ? (is_active ? 1 : 0) : user.is_active,
    password_hash: password ? bcrypt.hashSync(password, 10) : user.password_hash,
  }

  db.prepare(`
    UPDATE intranet_users SET name=?,role=?,department=?,avatar_url=?,birth_date=?,is_active=?,password_hash=?
    WHERE id=?
  `).run(updates.name, updates.role, updates.department, updates.avatar_url,
         updates.birth_date, updates.is_active, updates.password_hash, req.params.id)
  res.json({ ok: true })
})

router.delete('/api/intranet/users/:id', ...requireRole('admin'), (req, res) => {
  db.prepare('UPDATE intranet_users SET is_active = 0 WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ── Tool permissions ──────────────────────────────────────────────────────────
router.get('/api/intranet/permissions', ...requireRole('admin'), (req, res) => {
  res.json(db.prepare('SELECT role, tool_key, is_enabled FROM tool_permissions ORDER BY role, tool_key').all())
})

router.patch('/api/intranet/permissions', ...requireRole('admin'), (req, res) => {
  const { role, tool_key, is_enabled } = req.body
  if (!role || !tool_key) return res.status(400).json({ error: 'role e tool_key obrigatórios.' })
  if (role === 'admin') return res.status(400).json({ error: 'Permissões do admin não podem ser alteradas.' })
  db.prepare('UPDATE tool_permissions SET is_enabled = ? WHERE role = ? AND tool_key = ?')
    .run(is_enabled ? 1 : 0, role, tool_key)
  res.json({ ok: true })
})

router.get('/api/intranet/my-tools', auth, (req, res) => {
  const tools = db.prepare(
    'SELECT tool_key FROM tool_permissions WHERE role = ? AND is_enabled = 1'
  ).all(req.user.role).map(r => r.tool_key)
  res.json(tools)
})

// ── Stats integrados ──────────────────────────────────────────────────────────
router.get('/api/intranet/stats', ...requireRole('rh', 'admin'), (req, res) => {
  const { count: total }    = db.prepare('SELECT COUNT(*) as count FROM candidates').get()
  const { count: pendentes }= db.prepare("SELECT COUNT(*) as count FROM candidates WHERE status='Pendente'").get()
  const { count: confirmados }=db.prepare("SELECT COUNT(*) as count FROM candidates WHERE status='Confirmado'").get()
  const { count: organicos }= db.prepare("SELECT COUNT(*) as count FROM candidates WHERE source='organico'").get()
  const { count: postsPub } = db.prepare("SELECT COUNT(*) as count FROM intranet_posts WHERE status='published'").get()
  const { count: pendMod }  = db.prepare("SELECT COUNT(*) as count FROM intranet_posts WHERE status='pending'").get()

  const now      = new Date()
  const month    = String(now.getMonth() + 1).padStart(2, '0')
  const bdays    = db.prepare(
    "SELECT name, birth_date FROM intranet_users WHERE is_active=1 AND birth_date IS NOT NULL AND strftime('%m', birth_date) = ?"
  ).all(month)

  res.json({ total, pendentes, confirmados, organicos, postsPublished: postsPub,
             pendingModeration: pendMod, birthdaysThisMonth: bdays })
})

module.exports = router
