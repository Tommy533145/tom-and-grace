// In-memory Socket.IO test doubles exercise the room handlers without external packages.
const assert = require('node:assert/strict');
const Module = require('node:module');
const http = require('node:http');
const path = require('node:path');
const originalLoad = Module._load;
let ioInstance;

function expressStub() {
  const app = function (_req, _res) {};
  app.use = () => app;
  app.get = () => app;
  return app;
}
expressStub.static = () => (_req, _res, next) => next?.();

class FakeIO {
  constructor() { this.handlers = {}; this.clients = new Map(); ioInstance = this; }
  on(event, fn) { this.handlers[event] = fn; }
  to(roomOrId) {
    return { emit: (event, payload) => {
      for (const client of this.clients.values()) {
        if (client.id === roomOrId || client.rooms.has(roomOrId)) client.received.push({ event, payload });
      }
    }};
  }
  connect(id) {
    const socket = {
      id, data: {}, handlers: {}, rooms: new Set(), received: [],
      on(event, fn) { this.handlers[event] = fn; },
      join(room) { this.rooms.add(room); },
      leave(room) { this.rooms.delete(room); },
      to(room) { return { emit: (event, payload) => {
        for (const client of ioInstance.clients.values()) {
          if (client.id !== id && client.rooms.has(room)) client.received.push({ event, payload });
        }
      }}; },
      clientEmit(event, ...args) { return this.handlers[event]?.(...args); }
    };
    this.clients.set(id, socket);
    this.handlers.connection(socket);
    return socket;
  }
}

Module._load = function(request, parent, isMain) {
  if (request === 'express') return expressStub;
  if (request === 'socket.io') return { Server: FakeIO };
  return originalLoad.call(this, request, parent, isMain);
};
http.createServer = () => ({ listen: () => ({}) });
require(path.join(__dirname, '..', 'server.js'));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const io = ioInstance;
  const a = io.connect('player-A');
  const b = io.connect('player-B');
  let roomResponse;
  a.clientEmit('room:create', { name: 'Tom', character: 'tom' }, (response) => { roomResponse = response; });
  assert.equal(roomResponse?.ok, true, 'room creation');
  let joinResponse;
  b.clientEmit('room:join', { roomId: roomResponse.roomId, profile: { name: 'Grace', character: 'grace' } }, (response) => { joinResponse = response; });
  assert.equal(joinResponse?.ok, true, 'second player joins');
  assert.equal(joinResponse.players.length, 2, 'both players are in the room');

  let chatResponse;
  b.clientEmit('chat:send', { text: 'Hello from Grace' }, (response) => { chatResponse = response; });
  assert.equal(chatResponse?.ok, true, 'room chat accepted');
  assert.ok(a.received.some((event) => event.event === 'chat:message' && event.payload.text === 'Hello from Grace'), 'chat broadcast reaches the other player');

  a.clientEmit('voice:status', { joined: true, muted: false });
  b.clientEmit('voice:status', { joined: true, muted: false });
  a.clientEmit('voice:signal', { targetId: 'player-B', signal: { description: { type: 'offer', sdp: 'mock-sdp' } } });
  assert.ok(b.received.some((event) => event.event === 'voice:signal' && event.payload.from === 'player-A'), 'voice signaling is room-scoped');

  let tooFar;
  a.clientEmit('player:action', { action: 'sleep' }, (response) => { tooFar = response; });
  assert.equal(tooFar?.ok, false, 'sleep is refused when too far from beds');

  let dance;
  a.clientEmit('player:action', { action: 'dance', danceStyle: 'disco' }, (response) => { dance = response; });
  assert.equal(dance?.ok, true, 'dance action accepted');
  assert.equal(dance.players.find((player) => player.id === 'player-A')?.danceStyle, 'disco', 'dance style saved');
  assert.ok(b.received.some((event) => event.event === 'room:players' && event.payload.some((player) => player.id === 'player-A' && player.action === 'dance' && player.danceStyle === 'disco')), 'dance is synchronized to the room');

  a.clientEmit('player:move', { x: -5.15, z: -5.2, rotationY: 0, moving: false });
  await wait(320);
  let sleep;
  a.clientEmit('player:action', { action: 'sleep' }, (response) => { sleep = response; });
  assert.equal(sleep?.ok, true, 'sleep accepted beside a bed');
  assert.equal(sleep.players.find((player) => player.id === 'player-A')?.action, 'sleep', 'sleep action saved');
  assert.ok(b.received.some((event) => event.event === 'room:players' && event.payload.some((player) => player.id === 'player-A' && player.action === 'sleep')), 'sleep is synchronized to the room');

  a.clientEmit('player:move', { x: -4.8, z: -5.2, rotationY: 0, moving: true });
  assert.ok(b.received.some((event) => event.event === 'room:players' && event.payload.some((player) => player.id === 'player-A' && player.action === 'none')), 'movement wakes the player and syncs it');

  a.clientEmit('player:move', { x: 19.2, z: -6.0, rotationY: 0, moving: false });
  let elevatorOut;
  a.clientEmit('elevator:travel', {}, (response) => { elevatorOut = response; });
  assert.equal(elevatorOut?.zone, 'city', 'elevator reaches the city');
  a.clientEmit('player:move', { x: 28.5, z: 0, rotationY: 0, moving: false });
  let elevatorBack;
  a.clientEmit('elevator:travel', {}, (response) => { elevatorBack = response; });
  assert.equal(elevatorBack?.zone, 'penthouse', 'elevator returns to the penthouse');

  console.log('PASS simulated two-player room create/join');
  console.log('PASS room-wide chat and voice signaling');
  console.log('PASS bed proximity check, sleeping, wake-by-movement');
  console.log('PASS shared dance selection and animation state');
  console.log('PASS elevator travel and movement bounds');
})().catch((error) => { console.error(error); process.exitCode = 1; });
