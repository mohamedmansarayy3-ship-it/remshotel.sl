const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { randomBytes } = require('crypto');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'bookings.db');

function ensureDataDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDataDir();

const db = new sqlite3.Database(DB_PATH);

function runSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}
function allSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}
function getSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

// Migrate / create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    number TEXT,
    night_price REAL DEFAULT 0,
    hour_price REAL DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    room_id TEXT,
    room_number TEXT,
    type TEXT,
    start TEXT,
    end TEXT,
    duration INTEGER,
    status TEXT,
    total_amount REAL,
    customer_name TEXT,
    email TEXT,
    phone TEXT,
    created_at TEXT
  )`);
  // seed basic rooms if empty
  db.get('SELECT COUNT(1) as cnt FROM rooms', (err, row) => {
    if (!err && row && row.cnt === 0) {
      const rooms = [
        { id: 'room_001', name: 'Standard Room', number: 'Room 001', night_price: 20, hour_price: 1 },
        { id: 'room_002', name: 'Deluxe Room', number: 'Room 002', night_price: 35, hour_price: 3 },
        { id: 'room_003', name: 'Executive Suite', number: 'Room 003', night_price: 55, hour_price: 5 }
      ];
      const stmt = db.prepare('INSERT INTO rooms(id,name,number,night_price,hour_price) VALUES (?,?,?,?,?)');
      rooms.forEach(r => stmt.run(r.id, r.name, r.number, r.night_price, r.hour_price));
      stmt.finalize();
      console.log('Seeded rooms');
    }
  });
});

const app = express();
app.use(cors());
app.use(bodyParser.json());

// health
app.get('/api/health', (req, res) => res.json({ ok: true, env: process.env.NODE_ENV || 'dev' }));

// list rooms
app.get('/api/rooms', async (req, res) => {
  try {
    const rows = await allSql('SELECT id,name,number,night_price,hour_price FROM rooms');
    res.json({ rooms: rows });
  } catch (err) {
    console.error('rooms err', err);
    res.status(500).json({ error: 'internal' });
  }
});

// availability check
// GET /api/bookings/availability?room=Room%20001&type=night&start=2026-01-01&end=2026-01-03
app.get('/api/bookings/availability', async (req, res) => {
  try {
    const { room, type, start, end, duration } = req.query;
    if (!room || !type) return res.status(400).json({ error: 'missing room or type' });

    // find confirmed bookings for the same room that overlap
    if (type === 'night') {
      if (!start || !end) return res.status(400).json({ error: 'missing start or end for night' });
      const rows = await allSql(
        `SELECT * FROM bookings WHERE (room_number = ? OR room_id = ?) AND status = 'confirmed' AND
         NOT (date(end) < date(?) OR date(start) > date(?))`,
        [room, room, start, end]
      );
      const available = rows.length === 0;
      return res.json({ available, conflicts: rows });
    } else {
      // hour bookings: treat bookings on same day and overlapping duration as conflict
      const d = Number(duration) || 1;
      // a simple check: any confirmed hour booking for the same room with same day considered conflict
      const rows = await allSql(
        `SELECT * FROM bookings WHERE (room_number = ? OR room_id = ?) AND status = 'confirmed' AND type = 'hour'`,
        [room, room]
      );
      // no robust slot management here — return available if no confirmed hour bookings exist
      const available = rows.length === 0;
      return res.json({ available, conflicts: rows });
    }
  } catch (err) {
    console.error('availability err', err);
    res.status(500).json({ error: 'internal' });
  }
});

// create provisional booking (server computes amount and reserves provisional)
app.post('/api/bookings/provisional', async (req, res) => {
  try {
    const body = req.body || {};
    const room = body.room || body.roomNumber || body.room_number;
    const roomId = body.roomId || body.room_id || null;
    const type = body.type || 'night';
    const duration = Number(body.duration) || 1;
    const start = body.start || body.checkin || null;
    const end = body.end || body.checkout || null;

    if (!room) return res.status(400).json({ error: 'room required' });

    // fetch room pricing if roomId exists
    let roomRow = null;
    if (roomId) {
      roomRow = await getSql('SELECT * FROM rooms WHERE id = ?', [roomId]);
    } else {
      roomRow = await getSql('SELECT * FROM rooms WHERE number = ? OR name = ?', [room, room]);
    }

    // compute amount
    const night_price = (roomRow && roomRow.night_price) ? roomRow.night_price : Number(body.nightPrice || 0);
    const hour_price = (roomRow && roomRow.hour_price) ? roomRow.hour_price : Number(body.hourPrice || 0);
    const base = (type === 'night') ? night_price : hour_price;
    const amount = +(base * duration);

    // basic availability check against confirmed bookings
    // reuse availability query logic
    let available = true;
    if (type === 'night' && start && end) {
      const conflicts = await allSql(
        `SELECT * FROM bookings WHERE (room_number = ? OR room_id = ?) AND status = 'confirmed' AND
         NOT (date(end) < date(?) OR date(start) > date(?))`,
        [room, roomId || room, start, end]
      );
      available = conflicts.length === 0;
      if (!available) return res.status(409).json({ available: false, conflict: conflicts[0] });
    } else {
      // simple hour availability check
      const conflicts = await allSql(
        `SELECT * FROM bookings WHERE (room_number = ? OR room_id = ?) AND status = 'confirmed' AND type = 'hour'`,
        [room, roomId || room]
      );
      available = conflicts.length === 0;
      if (!available) return res.status(409).json({ available: false, conflict: conflicts[0] });
    }

    // create provisional booking
    const id = 'bk_' + randomBytes(10).toString('hex');
    const now = new Date().toISOString();
    await runSql(
      `INSERT INTO bookings(id, room_id, room_number, type, start, end, duration, status, total_amount, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [id, roomRow ? roomRow.id : roomId, room, type, start, end, duration, 'provisional', amount, now]
    );

    return res.json({ provisionalId: id, amount, room: roomRow ? roomRow.name : room, roomId: roomRow ? roomRow.id : roomId });
  } catch (err) {
    console.error('provisional err', err);
    res.status(500).json({ error: 'internal' });
  }
});

// confirm provisional booking (id) -> mark confirmed
app.post('/api/bookings/confirm', async (req, res) => {
  try {
    const { provisionalId } = req.body || {};
    if (!provisionalId) return res.status(400).json({ error: 'provisionalId required' });

    const row = await getSql('SELECT * FROM bookings WHERE id = ? AND status = ?', [provisionalId, 'provisional']);
    if (!row) return res.status(404).json({ error: 'provisional not found' });

    // double-check there is no conflicting confirmed booking (race protection)
    if (row.type === 'night' && row.start && row.end) {
      const conflicts = await allSql(
        `SELECT * FROM bookings WHERE (room_number = ? OR room_id = ?) AND status = 'confirmed' AND
         NOT (date(end) < date(?) OR date(start) > date(?))`,
        [row.room_number, row.room_id || row.room_number, row.start, row.end]
      );
      if (conflicts.length) return res.status(409).json({ error: 'conflict', conflict: conflicts[0] });
    } else {
      const conflicts = await allSql(
        `SELECT * FROM bookings WHERE (room_number = ? OR room_id = ?) AND status = 'confirmed' AND type = 'hour'`,
        [row.room_number, row.room_id || row.room_number]
      );
      if (conflicts.length) return res.status(409).json({ error: 'conflict', conflict: conflicts[0] });
    }

    await runSql('UPDATE bookings SET status = ? WHERE id = ?', ['confirmed', provisionalId]);
    return res.json({ ok: true, bookingId: provisionalId });
  } catch (err) {
    console.error('confirm err', err);
    res.status(500).json({ error: 'internal' });
  }
});

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT} — DB: ${DB_PATH}`);
});
