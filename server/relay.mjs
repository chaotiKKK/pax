// LAN relay for Pax Aeterna.
//
// The host player's browser stays authoritative: it runs the simulation and
// broadcasts snapshots. This process only pairs devices on the local network
// and forwards messages, so it has no game rules and no dependencies.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const DEFAULT_PORT = 7777;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** @type {Map<string, {host: any, peers: Set<any>}>} */
const rooms = new Map();
/** @type {Set<any>} */
const sockets = new Set();

function roomCode() {
  const alphabet = 'ACDEFGHJKLMNPQRTUVWXY34679';
  let out = '';
  for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return rooms.has(out) ? roomCode() : out;
}

function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2);
    head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeUInt32BE(0, 2);
    head.writeUInt32BE(len, 6);
  }
  head[0] = 0x81;
  return Buffer.concat([head, payload]);
}

function send(conn, obj) {
  if (!conn || conn.socket.destroyed) return;
  try {
    conn.socket.write(encodeFrame(JSON.stringify(obj)));
  } catch {
    /* peer vanished mid-write */
  }
}

function broadcastRoom(room, obj, exceptId) {
  for (const peer of room.peers) {
    if (peer.id === exceptId) continue;
    send(peer, obj);
  }
}

function leave(conn) {
  const code = conn.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  room.peers.delete(conn);
  if (room.host === conn) {
    broadcastRoom(room, { t: 'host-left' }, null);
    rooms.delete(code);
    return;
  }
  broadcastRoom(room, { t: 'peer-left', peerId: conn.id }, null);
}

function handleMessage(conn, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  switch (msg.t) {
    case 'create': {
      const code = roomCode();
      const room = { host: conn, peers: new Set([conn]) };
      rooms.set(code, room);
      conn.roomCode = code;
      send(conn, { t: 'created', code, peerId: conn.id });
      break;
    }
    case 'join': {
      const room = rooms.get(String(msg.code ?? '').toUpperCase());
      if (!room) {
        send(conn, { t: 'error', msg: 'Kein Raum mit diesem Code.' });
        return;
      }
      if (room.peers.size >= 8) {
        send(conn, { t: 'error', msg: 'Dieser Raum ist voll (max. 8).' });
        return;
      }
      room.peers.add(conn);
      conn.roomCode = room.peers.values().next().value.roomCode;
      send(conn, { t: 'joined', peerId: conn.id, hostId: room.host.id });
      send(room.host, { t: 'peer-joined', peerId: conn.id, name: msg.name ?? 'Gast' });
      break;
    }
    case 'relay': {
      const room = rooms.get(conn.roomCode);
      if (!room) return;
      const target = [...room.peers].find((p) => p.id === msg.to);
      if (target) send(target, { t: 'relay', from: conn.id, payload: msg.payload });
      break;
    }
    case 'broadcast': {
      const room = rooms.get(conn.roomCode);
      if (!room) return;
      broadcastRoom(room, { t: 'relay', from: conn.id, payload: msg.payload }, conn.id);
      break;
    }
    case 'ping':
      send(conn, { t: 'pong' });
      break;
    default:
      break;
  }
}

function onUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const conn = {
    socket,
    id: Math.random().toString(36).slice(2, 10),
    roomCode: null,
    buffer: Buffer.alloc(0),
  };
  sockets.add(conn);

  socket.on('data', (chunk) => {
    conn.buffer = Buffer.concat([conn.buffer, chunk]);
    for (;;) {
      const frame = readFrame(conn.buffer);
      if (!frame) break;
      conn.buffer = conn.buffer.subarray(frame.size);
      if (frame.opcode === 8) {
        leave(conn);
        sockets.delete(conn);
        socket.end();
        return;
      }
      if (frame.opcode === 9) {
        const pong = Buffer.from([0x8a, 0]);
        socket.write(pong);
        continue;
      }
      if (frame.opcode === 1 || frame.opcode === 0) {
        conn.fragments = (conn.fragments ?? '') + frame.payload.toString('utf8');
        if (frame.fin) {
          handleMessage(conn, conn.fragments);
          conn.fragments = '';
        }
      }
    }
  });

  socket.on('error', () => {
    leave(conn);
    sockets.delete(conn);
  });
  socket.on('close', () => {
    leave(conn);
    sockets.delete(conn);
  });
}

function readFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + len) return null;
  let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
  if (masked) {
    const mask = buf.subarray(offset, offset + 4);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  }
  return { fin, opcode, payload, size: offset + maskLen + len };
}

function lanAddresses() {
  const out = [];
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

export function startRelay({ port = DEFAULT_PORT, staticDir = null } = {}) {
  const root = staticDir ? resolve(staticDir) : null;
  const server = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    if (!root) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('PAX AETERNA relay\n');
      return;
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let path = normalize(decodeURIComponent(url.pathname));
      if (path === '/' || path === '\\') path = '/index.html';
      const file = join(root, path);
      if (!file.startsWith(root) || !existsSync(file)) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) {
        res.writeHead(404);
        res.end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
      });
      res.end(body);
    } catch {
      res.writeHead(500);
      res.end('error');
    }
  });

  server.on('upgrade', onUpgrade);
  server.listen(port, '0.0.0.0', () => {
    const addresses = lanAddresses();
    console.log(`PAX AETERNA · LAN-Relay läuft auf Port ${port}`);
    for (const addr of addresses) console.log(`  http://${addr}:${port}`);
    if (root) console.log(`  Spieldateien: ${root}`);
  });
  return server;
}

const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const args = process.argv.slice(2);
  const portArg = args.find((a) => a.startsWith('--port='));
  const dirArg = args.find((a) => a.startsWith('--dir='));
  startRelay({
    port: portArg ? Number(portArg.split('=')[1]) : DEFAULT_PORT,
    staticDir: dirArg ? dirArg.split('=')[1] : existsSync('dist') ? 'dist' : null,
  });
  process.on('SIGINT', () => {
    for (const conn of sockets) conn.socket.destroy();
    process.exit(0);
  });
}
