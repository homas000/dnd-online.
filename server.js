const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.static('public'));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Комнаты: имя → { state, clients }
const rooms = new Map();

function getRoom(name) {
  if (!rooms.has(name)) {
    rooms.set(name, {
      state: { bg: null, tokens: [], monsters: [] },
      clients: new Set()
    });
  }
  return rooms.get(name);
}

function broadcast(room, msg, except = null) {
  const data = JSON.stringify(msg);
  room.clients.forEach(c => {
    if (c.readyState === 1 && c !== except) c.send(data);
  });
}

wss.on('connection', (ws, req) => {
  // Имя комнаты берём из URL подключения: ws://host/?room=имя
  const url = new URL(req.url, 'http://' + req.headers.host);
  const roomName = (url.searchParams.get('room') || 'main')
    .toLowerCase().replace(/[^a-zа-яё0-9_-]/gi, '').slice(0, 30) || 'main';

  const room = getRoom(roomName);
  room.clients.add(ws);
  ws.roomName = roomName;

  // Новому игроку — текущее состояние комнаты и число игроков
  ws.send(JSON.stringify({ type: 'state', room: roomName, state: room.state }));
  broadcast(room, { type: 'players', count: room.clients.size });

  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const state = room.state;

    switch (msg.type) {
      case 'setBg': state.bg = msg.bg; broadcast(room, msg); break;
      case 'addToken': state.tokens.push(msg.token); broadcast(room, msg); break;
      case 'moveToken': {
        const t = state.tokens.find(t => t.id === msg.id);
        if (t) { t.x = msg.x; t.y = msg.y; }
        broadcast(room, msg, ws); break;
      }
      case 'removeToken':
        state.tokens = state.tokens.filter(t => t.id !== msg.id);
        broadcast(room, msg); break;
      case 'roll': broadcast(room, msg); break;
      case 'monster':
        state.monsters.unshift(msg.monster);
        state.monsters = state.monsters.slice(0, 20);
        broadcast(room, msg); break;
      case 'clearRoom':
        room.state = { bg: null, tokens: [], monsters: [] };
        broadcast(room, { type: 'state', room: roomName, state: room.state });
        break;
    }
  });

  ws.on('close', () => {
    room.clients.delete(ws);
    broadcast(room, { type: 'players', count: room.clients.size });
    // Пустую комнату удаляем через 2 часа
    if (room.clients.size === 0) {
      setTimeout(() => {
        const r = rooms.get(roomName);
        if (r && r.clients.size === 0) rooms.delete(roomName);
      }, 2 * 60 * 60 * 1000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('DnD-сервер с комнатами запущен на порту ' + PORT));
