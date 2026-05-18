'use strict'
const express = require('express')
const router  = express.Router()
const db      = require('../../db')
const { auth, requireRole } = require('../middleware/auth')

// Helper: verifica se usuário é líder do time
async function isLeader(userId, teamId) {
  const row = await db.get(
    'SELECT role FROM user_teams WHERE user_id = ? AND team_id = ?',
    [userId, teamId]
  )
  return row?.role === 'leader'
}

// GET /api/teams — times do usuário (admin vê todos)
router.get('/teams', auth, async (req, res) => {
  try {
    let rows
    if (req.user.role === 'admin') {
      rows = await db.all(`
        SELECT t.*,
          (SELECT COUNT(*) FROM user_teams WHERE team_id = t.id) as member_count,
          u.name as created_by_name
        FROM teams t
        LEFT JOIN intranet_users u ON t.created_by = u.id
        ORDER BY t.created_at DESC
      `)
    } else {
      rows = await db.all(`
        SELECT t.*,
          (SELECT COUNT(*) FROM user_teams WHERE team_id = t.id) as member_count,
          u.name as created_by_name,
          ut.role as my_role
        FROM teams t
        JOIN user_teams ut ON t.id = ut.team_id AND ut.user_id = ?
        LEFT JOIN intranet_users u ON t.created_by = u.id
        ORDER BY t.created_at DESC
      `, [req.user.id])
    }
    res.json(rows)
  } catch (err) {
    console.error('[teams GET]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// POST /api/teams — criar time (admin)
router.post('/teams', ...requireRole('admin'), async (req, res) => {
  try {
    const { name, description } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Nome obrigatório.' })
    const r = await db.run(
      'INSERT INTO teams (name, description, created_by) VALUES (?, ?, ?)',
      [name.trim(), description?.trim() || null, req.user.id]
    )
    res.json({ ok: true, id: r.lastInsertRowid })
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Nome já existe.' })
    console.error('[teams POST]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// DELETE /api/teams/:id — excluir time (admin)
router.delete('/teams/:id', ...requireRole('admin'), async (req, res) => {
  try {
    await db.run('DELETE FROM user_teams WHERE team_id = ?', [req.params.id])
    const r = await db.run('DELETE FROM teams WHERE id = ?', [req.params.id])
    if (r.changes === 0) return res.status(404).json({ error: 'Grupo não encontrado.' })
    res.json({ ok: true })
  } catch (err) {
    console.error('[teams DELETE]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// GET /api/teams/:id/members — listar membros
router.get('/teams/:id/members', auth, async (req, res) => {
  try {
    const teamId = req.params.id
    if (req.user.role !== 'admin') {
      const member = await db.get(
        'SELECT 1 FROM user_teams WHERE user_id = ? AND team_id = ?',
        [req.user.id, teamId]
      )
      if (!member) return res.status(403).json({ error: 'Acesso negado.' })
    }
    const members = await db.all(`
      SELECT u.id, u.name, u.email, u.role as user_role, u.department,
             ut.role as team_role
      FROM intranet_users u
      JOIN user_teams ut ON u.id = ut.user_id
      WHERE ut.team_id = ?
      ORDER BY ut.role DESC, u.name ASC
    `, [teamId])
    res.json(members)
  } catch (err) {
    console.error('[teams members GET]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// POST /api/teams/:id/members — adicionar membro (admin ou líder)
router.post('/teams/:id/members', auth, async (req, res) => {
  try {
    const teamId = parseInt(req.params.id, 10)
    const { userId, role = 'member' } = req.body
    if (!userId) return res.status(400).json({ error: 'userId obrigatório.' })
    if (!['leader', 'member'].includes(role))
      return res.status(400).json({ error: 'Role inválido.' })

    if (req.user.role !== 'admin' && !(await isLeader(req.user.id, teamId)))
      return res.status(403).json({ error: 'Apenas admin ou líder do grupo.' })

    // Somente admin pode adicionar líder
    const finalRole = (role === 'leader' && req.user.role !== 'admin') ? 'member' : role

    await db.run(
      'INSERT OR REPLACE INTO user_teams (user_id, team_id, role) VALUES (?, ?, ?)',
      [userId, teamId, finalRole]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[teams members POST]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// DELETE /api/teams/:id/members/:userId — remover membro (admin ou líder)
router.delete('/teams/:id/members/:userId', auth, async (req, res) => {
  try {
    const teamId = parseInt(req.params.id, 10)
    const userId = parseInt(req.params.userId, 10)

    if (req.user.role !== 'admin' && !(await isLeader(req.user.id, teamId)))
      return res.status(403).json({ error: 'Apenas admin ou líder do grupo.' })

    const r = await db.run(
      'DELETE FROM user_teams WHERE user_id = ? AND team_id = ?',
      [userId, teamId]
    )
    if (r.changes === 0) return res.status(404).json({ error: 'Membro não encontrado.' })
    res.json({ ok: true })
  } catch (err) {
    console.error('[teams members DELETE]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

// PATCH /api/teams/:id/members/:userId — promover/rebaixar (admin)
router.patch('/teams/:id/members/:userId', ...requireRole('admin'), async (req, res) => {
  try {
    const { role } = req.body
    if (!['leader', 'member'].includes(role))
      return res.status(400).json({ error: 'Role inválido.' })
    const r = await db.run(
      'UPDATE user_teams SET role = ? WHERE user_id = ? AND team_id = ?',
      [role, req.params.userId, req.params.id]
    )
    if (r.changes === 0) return res.status(404).json({ error: 'Membro não encontrado.' })
    res.json({ ok: true })
  } catch (err) {
    console.error('[teams members PATCH]', err)
    res.status(500).json({ error: 'Erro interno.' })
  }
})

module.exports = router
