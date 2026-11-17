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
require(path.join(__dirname, 'server.js'));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const io = ioInstance;
  const a = io.connect('player-A');
  const b = io.connect('player-B');
  let roomResponse;
  a.clientEmit('room:create', { profile: { name: 'Tom', character: 'tom' }, roomType: 'garden' }, (response) => { roomResponse = response; });
  assert.equal(roomResponse?.ok, true, 'room creation');
  assert.equal(roomResponse?.roomType, 'garden', 'selected room type is saved and returned');
  let joinResponse;
  b.clientEmit('room:join', { roomId: roomResponse.roomId, profile: { name: 'Grace', character: 'grace' } }, (response) => { joinResponse = response; });
  assert.equal(joinResponse?.ok, true, 'second player joins');
  assert.equal(joinResponse.players.length, 2, 'both players are in the room');
  assert.deepEqual(joinResponse.musicQueue, [], 'new rooms start with an empty shared music queue');

  let firstMusicAdd;
  a.clientEmit('music:queue:add', { videoId: 'dQw4w9WgXcQ' }, (response) => { firstMusicAdd = response; });
  assert.equal(firstMusicAdd?.ok, true, 'first shared music track is accepted');
  assert.equal(firstMusicAdd.queue.queue.length, 1, 'first track is in the shared queue');
  assert.ok(a.received.some((event) => event.event === 'youtube:load' && event.payload.videoId === 'dQw4w9WgXcQ'), 'first track starts for the queue owner');
  assert.ok(b.received.some((event) => event.event === 'youtube:load' && event.payload.videoId === 'dQw4w9WgXcQ'), 'first track starts for every room member');
  assert.ok(b.received.some((event) => event.event === 'music:queue:update' && event.payload.queue.length === 1), 'queue update is broadcast room-wide');

  let secondMusicAdd;
  b.clientEmit('music:queue:add', { videoId: '9bZkp7q19f0' }, (response) => { secondMusicAdd = response; });
  assert.equal(secondMusicAdd?.ok, true, 'second player can append another video');
  assert.equal(secondMusicAdd.queue.queue.length, 2, 'adding a track appends to the shared queue');
  assert.equal(secondMusicAdd.queue.queue[1].videoId, '9bZkp7q19f0', 'new track is kept after the current track');

  let savedPlaylist;
  a.clientEmit('music:queue:replace', { videoIds: ['dQw4w9WgXcQ', '9bZkp7q19f0', 'M7lc1UVf-VE'] }, (response) => { savedPlaylist = response; });
  assert.equal(savedPlaylist?.ok, true, 'saved playlist can be shared with the room');
  assert.equal(savedPlaylist.queue.queue.length, 3, 'shared playlist replaces the room queue with all its tracks');
  assert.equal(savedPlaylist.queue.currentIndex, 0, 'shared playlist starts at its first track');
  assert.ok(b.received.some((event) => event.event === 'music:queue:update' && event.payload.queue.length === 3), 'full playlist is broadcast to every room member');

  const c = io.connect('player-C');
  let lateJoinResponse;
  c.clientEmit('room:join', { roomId: roomResponse.roomId, profile: { name: 'Alex', character: 'alex' } }, (response) => { lateJoinResponse = response; });
  assert.equal(lateJoinResponse?.ok, true, 'a third player can join after a playlist has been shared');
  assert.equal(lateJoinResponse.youtube?.videoId, 'dQw4w9WgXcQ', 'late joiner receives the first shared playlist track');
  assert.equal(lateJoinResponse.musicQueue.length, 3, 'late joiner receives the full shared playlist queue');
  assert.equal(lateJoinResponse.youtube?.isPlaying, false, 'a newly cued video is not reported as playing before a user starts it');
  let selectedMusic;
  a.clientEmit('music:play', { index: 1 }, (response) => { selectedMusic = response; });
  assert.equal(selectedMusic?.ok, true, 'players can select a track from the shared playlist');
  assert.ok(b.received.some((event) => event.event === 'youtube:load' && event.payload.videoId === '9bZkp7q19f0'), 'selected playlist track is synchronized to the room');
  let nextMusic;
  a.clientEmit('music:next', {}, (response) => { nextMusic = response; });
  assert.equal(nextMusic?.ok, true, 'next advances through the shared playlist');
  let invalidMusic;
  b.clientEmit('music:queue:add', { videoId: 'bad' }, (response) => { invalidMusic = response; });
  assert.equal(invalidMusic?.ok, false, 'invalid YouTube identifiers are rejected');
  let invalidPlaylist;
  b.clientEmit('music:queue:replace', { videoIds: ['bad'] }, (response) => { invalidPlaylist = response; });
  assert.equal(invalidPlaylist?.ok, false, 'invalid shared playlists are rejected');

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

  let wrongDistrictCar;
  a.clientEmit('vehicle:enter', { vehicleId: 'sunset-coupe' }, (response) => { wrongDistrictCar = response; });
  assert.equal(wrongDistrictCar?.ok, false, 'players cannot enter a penthouse car from the city');

  a.clientEmit('player:move', { x: 35, z: -1.55, rotationY: 0, moving: false });
  let cityCar;
  a.clientEmit('vehicle:enter', { vehicleId: 'city-sport' }, (response) => { cityCar = response; });
  assert.equal(cityCar?.ok, true, 'players can enter a nearby city car');
  a.clientEmit('vehicle:move', { vehicleId: 'city-sport', position: { x: 999, z: 99 }, rotationY: Math.PI / 2 });
  let cityCarExit;
  a.clientEmit('vehicle:exit', {}, (response) => { cityCarExit = response; });
  assert.equal(cityCarExit?.ok, true, 'players can exit a city car');
  assert.ok(cityCarExit.position.x <= 88 && cityCarExit.position.z <= 4.8, 'city car exit position stays inside city bounds');

  a.clientEmit('player:move', { x: 28.5, z: 0, rotationY: 0, moving: false });
  let elevatorBack;
  a.clientEmit('elevator:travel', {}, (response) => { elevatorBack = response; });
  assert.equal(elevatorBack?.zone, 'penthouse', 'elevator returns to the penthouse');

  console.log('PASS simulated two-player room create/join');
  console.log('PASS shared YouTube playlists, queue append/replace, late-join sync and validation');
  console.log('PASS room-wide chat and voice signaling');
  console.log('PASS bed proximity check, sleeping, wake-by-movement');
  console.log('PASS shared dance selection and animation state');
  console.log('PASS elevator travel and movement bounds');
  console.log('PASS city car district checks, driving bounds and exit');
})().catch((error) => { console.error(error); process.exitCode = 1; });
