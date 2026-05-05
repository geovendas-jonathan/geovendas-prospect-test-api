/* eslint-disable no-console */
const path = require('path')
const express = require('express')
const morgan = require('morgan')
const Database = require('better-sqlite3')

const PORT = Number(process.env.PORT) || 3001
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'events.db')
const FAIL_MODE = process.env.FAIL_MODE || ''
const DELAY_MS = Number(process.env.DELAY_MS) || 0

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at     TEXT NOT NULL DEFAULT (datetime('now')),
    event           TEXT,
    prospect_id     INTEGER,
    cnpj            TEXT,
    ip              TEXT,
    auth_header     TEXT,
    headers_json    TEXT,
    body_json       TEXT,
    status_returned INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_events_received_at ON events(received_at DESC);
  CREATE INDEX IF NOT EXISTS idx_events_event ON events(event);
`)

const insertStmt = db.prepare(`
  INSERT INTO events (event, prospect_id, cnpj, ip, auth_header, headers_json, body_json, status_returned)
  VALUES (@event, @prospect_id, @cnpj, @ip, @auth_header, @headers_json, @body_json, @status_returned)
`)

const app = express()
app.use(morgan('dev'))
app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function resolveClientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (xff) {
    return String(xff).split(',')[0].trim()
  }
  const xri = req.headers['x-real-ip']
  if (xri) return String(xri).trim()
  return req.ip || req.socket?.remoteAddress || null
}

function pickFailMode(req) {
  return (req.query.fail || FAIL_MODE || '').toString()
}

function pickDelayMs(req) {
  const q = Number(req.query.delay)
  if (Number.isFinite(q) && q > 0) return q
  return DELAY_MS
}

app.post('/webhook', async (req, res) => {
  const failMode = pickFailMode(req)
  const delayMs = pickDelayMs(req)
  const body = req.body || {}

  let statusReturned = 200
  if (failMode === '500') statusReturned = 500
  else if (failMode === '401') statusReturned = 401

  const eventRow = {
    event: typeof body.event === 'string' ? body.event : null,
    prospect_id: Number.isFinite(body.prospectId) ? body.prospectId : null,
    cnpj: body.cnpj ? String(body.cnpj) : null,
    ip: resolveClientIp(req),
    auth_header: req.headers['authorization'] || null,
    headers_json: JSON.stringify(req.headers),
    body_json: JSON.stringify(body),
    status_returned: statusReturned,
  }

  const info = insertStmt.run(eventRow)
  const id = info.lastInsertRowid

  if (delayMs > 0) {
    await sleep(delayMs)
  }

  if (statusReturned === 500) {
    return res.status(500).json({ ok: false, id, error: 'Simulated 500' })
  }
  if (statusReturned === 401) {
    return res.status(401).json({ ok: false, id, error: 'Simulated 401' })
  }
  return res.status(200).json({ ok: true, id })
})

app.get('/events', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500)
  const offset = Number(req.query.offset) || 0
  const eventFilter = req.query.event ? String(req.query.event) : null

  let rows
  let total
  if (eventFilter) {
    rows = db
      .prepare(
        `SELECT id, received_at, event, prospect_id, cnpj, ip, status_returned
         FROM events WHERE event = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(eventFilter, limit, offset)
    total = db
      .prepare(`SELECT COUNT(*) AS c FROM events WHERE event = ?`)
      .get(eventFilter).c
  } else {
    rows = db
      .prepare(
        `SELECT id, received_at, event, prospect_id, cnpj, ip, status_returned
         FROM events ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset)
    total = db.prepare(`SELECT COUNT(*) AS c FROM events`).get().c
  }
  res.json({ total, limit, offset, rows })
})

app.get('/events/:id', (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare(`SELECT * FROM events WHERE id = ?`).get(id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  try {
    row.headers = JSON.parse(row.headers_json || '{}')
    row.body = JSON.parse(row.body_json || '{}')
  } catch {
    /* keep raw */
  }
  res.json(row)
})

app.delete('/events', (_req, res) => {
  const info = db.prepare(`DELETE FROM events`).run()
  res.json({ deleted: info.changes })
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: err.message || 'Internal error' })
})

app.listen(PORT, () => {
  console.log(`geo-prospect-test-api listening on :${PORT}`)
  console.log(`DB: ${DB_PATH}`)
  if (FAIL_MODE) console.log(`FAIL_MODE=${FAIL_MODE}`)
  if (DELAY_MS) console.log(`DELAY_MS=${DELAY_MS}`)
})
