const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Preserve room membership and missed packets during short network drops.
  // The browser also has a fallback rejoin path when recovery is unavailable.
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true
  },
  maxHttpBufferSize: 1e5,
  pingInterval: 25000,
  pingTimeout: 20000
});

const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS_PER_ROOM = 8;
const MAX_MUSIC_QUEUE_ITEMS = 50;
const rooms = new Map();

const OUTFIT_COLORS = new Set(['cream', 'rose', 'midnight', 'sage', 'lavender', 'black', 'sky', 'cherry']);
const OUTFIT_STYLES = new Set(['cozy', 'streetwear', 'elegant', 'sporty']);
const ACCESSORIES = new Set(['none', 'beanie', 'cap', 'sunglasses']);
const ROOM_TYPES = new Set(['penthouse', 'music', 'cozy', 'game', 'garden', 'cinema']);
const DANCE_STYLES = new Set(['groove', 'disco', 'salsa', 'bounce', 'sway']);
const BED_SPOTS = { 'bed-one': { x: -5.15, z: -5.2 }, 'bed-two': { x: 4.05, z: -5.2 } };
const CHAIR_SPOTS = { 'up-lounge-chair': {x:-6.2,z:4.45,y:3.36,exitX:-7.25,exitZ:4.45}, 'up-office-chair': {x:5.2,z:4.55,y:3.36,exitX:6.35,exitZ:4.55}, 'up-game-chair': {x:-5.0,z:2.65,y:3.36,exitX:-6.1,exitZ:2.65}, 'up-guest-chair': {x:6.8,z:-2.1,y:3.36,exitX:7.85,exitZ:-2.1} };

app.use(express.static(path.join(__dirname, 'public')));
const REGION_ID = process.env.REGION_ID || 'global';
const REGION_NAME = process.env.REGION_NAME || 'Global server';
function getRegionDirectory(req) {
  let configured = [];
  try {
    const parsed = JSON.parse(process.env.REGION_DIRECTORY_JSON || '[]');
    if (Array.isArray(parsed)) configured = parsed;
  } catch (_error) {
    console.warn('Ignoring invalid REGION_DIRECTORY_JSON');
  }
  const protocol = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  const ownUrl = (process.env.PUBLIC_BASE_URL || `${protocol}://${req.get('host')}`).replace(/\/$/, '');
  const regions = configured
    .filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.url === 'string' && /^https:\/\//i.test(item.url))
    .map((item) => ({ id: item.id.slice(0, 24), name: item.name.slice(0, 60), url: item.url.replace(/\/$/, '') }));
  if (!regions.some((item) => item.id === REGION_ID)) regions.unshift({ id: REGION_ID, name: REGION_NAME, url: ownUrl });
  return regions;
}
app.get('/api/regions', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ currentRegion: REGION_ID, regions: getRegionDirectory(req) });
});
app.get('/health', (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, app: 'Tom&Grace', edition: 'Shared Music Room 1.5', region: REGION_ID, maxPlayersPerRoom: MAX_PLAYERS_PER_ROOM, features: ['room-chat', 'proximity-voice', 'elevator-city', 'expanded-city-retail', 'penthouse-mini-mart-shopping', 'selectable-room-themes', 'synchronized-movement', 'sleep', 'dance', 'shared-music-queue', 'spotify-personal-embed', 'regional-discovery'] });
});

function cleanText(value, fallback = '', max = 20) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
  return cleaned || fallback;
}

function normalizeOutfit(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  return {
    color: OUTFIT_COLORS.has(value.color) ? value.color : 'cream',
    style: OUTFIT_STYLES.has(value.style) ? value.style : 'cozy',
    accessory: ACCESSORIES.has(value.accessory) ? value.accessory : 'none'
  };
}

function makeRoomId() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function publicPlayers(room) {
  return Array.from(room.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    character: p.character,
    outfit: p.outfit,
    position: p.position,
    rotationY: p.rotationY || 0,
    moving: Boolean(p.moving),
    action: p.action || 'none',
    danceStyle: p.danceStyle || 'groove',
    bedId: p.bedId || null,
    vehicleId: p.vehicleId || null,
    zone: p.zone || 'penthouse',
    voiceJoined: Boolean(p.voiceJoined),
    voiceMuted: Boolean(p.voiceMuted)
  }));
}

function publicVehicles(room) {
  return Array.from(room.vehicles.values()).map((v) => ({id:v.id,zone:v.zone||'penthouse',bodyColor:v.bodyColor||null,position:v.position,rotationY:v.rotationY,driverId:v.driverId||null}));
}

function projectedYoutubeState(state) {
  const yt = { ...state };
  if (yt.videoId && yt.isPlaying) {
    yt.currentTime = Math.max(0, yt.currentTime + (Date.now() - yt.updatedAt) / 1000);
  }
  return yt;
}

function publicMusicQueue(room) {
  return { queue: room.musicQueue.map((item) => ({ ...item })), currentIndex: room.musicIndex };
}

function broadcastMusicQueue(roomId, room) {
  io.to(roomId).emit('music:queue:update', publicMusicQueue(room));
}

function playQueuedTrack(roomId, room, index) {
  const item = room.musicQueue[index];
  if (!item) return false;
  room.musicIndex = index;
  room.youtube = { videoId: item.videoId, isPlaying: false, currentTime: 0, updatedAt: Date.now() };
  io.to(roomId).emit('youtube:load', { videoId: item.videoId });
  broadcastMusicQueue(roomId, room);
  return true;
}

function createVehicles() {
  return new Map([
    ['sunset-coupe',{id:'sunset-coupe',zone:'penthouse',bodyColor:0xb96f5d,position:{x:13.3,z:4.8},rotationY:0,driverId:null}],
    ['midnight-suv',{id:'midnight-suv',zone:'penthouse',bodyColor:0x283847,position:{x:18.2,z:-3.6},rotationY:Math.PI,driverId:null}],
    ['city-sport',{id:'city-sport',zone:'city',bodyColor:0x376f9b,position:{x:39,z:-1.55},rotationY:Math.PI/2,driverId:null}],
    ['city-sedan',{id:'city-sedan',zone:'city',bodyColor:0x9a9b9e,position:{x:59,z:1.55},rotationY:-Math.PI/2,driverId:null}],
    ['city-suv',{id:'city-suv',zone:'city',bodyColor:0x647d5e,position:{x:79,z:-1.55},rotationY:Math.PI/2,driverId:null}]
  ]);
}

const disconnectCleanupTimers = new Map();

function removePlayerFromRoom(roomId, playerId, notice = 'left the penthouse.') {
  const room = getRoom(roomId);
  if (!room) return;
  const player = room.players.get(playerId);
  if (!player) return;
  if (player.vehicleId) {
    const vehicle = room.vehicles.get(player.vehicleId);
    if (vehicle?.driverId === playerId) vehicle.driverId = null;
  }
  room.players.delete(playerId);
  if (room.players.size === 0) {
    rooms.delete(roomId);
  } else {
    io.to(roomId).emit('room:players', publicPlayers(room));
    io.to(roomId).emit('room:vehicles', publicVehicles(room));
    io.to(roomId).emit('system:notice', { text: `${player.name || 'A player'} ${notice}` });
  }
}

function leaveCurrentRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const timer = disconnectCleanupTimers.get(socket.id);
  if (timer) clearTimeout(timer);
  disconnectCleanupTimers.delete(socket.id);
  socket.leave(roomId);
  socket.data.roomId = null;
  removePlayerFromRoom(roomId, socket.id);
}

function scheduleDisconnectedRoomCleanup(socket) {
  const roomId = socket.data.roomId;
  const room = roomId && getRoom(roomId);
  const player = room?.players.get(socket.id);
  if (!roomId || !player) return;
  const previous = disconnectCleanupTimers.get(socket.id);
  if (previous) clearTimeout(previous);
  // Keep the authoritative player state alive long enough for Socket.IO recovery
  // or a fresh browser socket to reclaim it using the stable per-tab clientId.
  const timer = setTimeout(() => {
    disconnectCleanupTimers.delete(socket.id);
    const currentRoom = getRoom(roomId);
    if (currentRoom?.players.get(socket.id) !== player) return;
    removePlayerFromRoom(roomId, socket.id, 'disconnected.');
  }, 150 * 1000);
  timer.unref?.();
  disconnectCleanupTimers.set(socket.id, timer);
}

const SPAWN_POINTS = [
  { x: -0.65, z: 6.15 }, { x: 0.65, z: 6.15 }, { x: -1.35, z: 5.3 }, { x: 1.35, z: 5.3 },
  { x: -0.65, z: 4.65 }, { x: 0.65, z: 4.65 }, { x: -1.65, z: 6.8 }, { x: 1.65, z: 6.8 }
];

function joinRoom(socket, roomId, profile, callback) {
  roomId = String(roomId || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (!roomId || roomId.length < 4) {
    return callback?.({ ok: false, error: 'That penthouse link or room code is not valid.' });
  }

  leaveCurrentRoom(socket);
  const clientId = typeof profile?.clientId === 'string'
    ? profile.clientId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
    : '';
  let room = getRoom(roomId);
  if (!room) {
    room = {
      players: new Map(),
      vehicles: createVehicles(),
      chat: [],
      youtube: { videoId: '', isPlaying: false, currentTime: 0, updatedAt: Date.now() },
      musicQueue: [],
      musicIndex: -1,
      roomType: 'penthouse'
    };
    rooms.set(roomId, room);
  }

  room.roomType = 'penthouse';

  // A reconnect that could not use Socket.IO's session recovery gets a new
  // socket.id. Reclaim the previous player by its stable per-tab clientId.
  let resumedPlayer = null;
  if (clientId) {
    for (const [oldSocketId, oldPlayer] of room.players.entries()) {
      if (oldSocketId !== socket.id && oldPlayer.clientId === clientId) {
        const timer = disconnectCleanupTimers.get(oldSocketId);
        if (timer) clearTimeout(timer);
        disconnectCleanupTimers.delete(oldSocketId);
        room.players.delete(oldSocketId);
        if (oldPlayer.vehicleId) {
          const vehicle = room.vehicles.get(oldPlayer.vehicleId);
          if (vehicle?.driverId === oldSocketId) vehicle.driverId = socket.id;
        }
        resumedPlayer = oldPlayer;
        break;
      }
    }
  }

  if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
    return callback?.({ ok: false, error: `This penthouse is full (${MAX_PLAYERS_PER_ROOM} players maximum).` });
  }

  const character = ['tom', 'grace', 'alex', 'riley'].includes(profile?.character)
    ? profile.character
    : (resumedPlayer?.character || (room.players.size === 0 ? 'tom' : 'grace'));
  const defaultName = character.charAt(0).toUpperCase() + character.slice(1);
  const spawn = SPAWN_POINTS[room.players.size] || { x: 0, z: 5.8 };
  const player = {
    ...(resumedPlayer || {}),
    id: socket.id,
    clientId: clientId || resumedPlayer?.clientId || '',
    name: cleanText(profile?.name, resumedPlayer?.name || defaultName, 18),
    character,
    outfit: profile?.outfit ? normalizeOutfit(profile.outfit) : (resumedPlayer?.outfit || normalizeOutfit()),
    position: resumedPlayer?.position ? { ...resumedPlayer.position } : { ...spawn },
    rotationY: resumedPlayer?.rotationY || 0,
    moving: false,
    action: resumedPlayer?.action || 'none',
    danceStyle: resumedPlayer?.danceStyle || 'groove',
    bedId: resumedPlayer?.bedId || null,
    vehicleId: resumedPlayer?.vehicleId || null,
    zone: resumedPlayer?.zone || 'penthouse',
    voiceJoined: false,
    voiceMuted: true
  };

  room.players.set(socket.id, player);
  socket.join(roomId);
  socket.data.roomId = roomId;
  socket.data.lastChatAt = 0;

  callback?.({
    ok: true,
    roomId,
    selfId: socket.id,
    players: publicPlayers(room),
    vehicles: publicVehicles(room),
    chat: room.chat.slice(-50),
    youtube: projectedYoutubeState(room.youtube),
    musicQueue: room.musicQueue.map((item) => ({ ...item })),
    musicIndex: room.musicIndex,
    roomType: room.roomType || 'penthouse'
  });
  io.to(roomId).emit('room:players', publicPlayers(room));
  io.to(roomId).emit('system:notice', { text: `${player.name} arrived at the penthouse.` });
}

io.on('connection', (socket) => {
  if (socket.recovered) {
    const timer = disconnectCleanupTimers.get(socket.id);
    if (timer) clearTimeout(timer);
    disconnectCleanupTimers.delete(socket.id);
  }

  socket.on('room:create', (payload = {}, callback) => {
    let roomId;
    do { roomId = makeRoomId(); } while (rooms.has(roomId));
    const profile = { ...(payload.profile || {}), roomType: payload.roomType };
    joinRoom(socket, roomId, profile, callback);
  });

  socket.on('room:join', ({ roomId, profile } = {}, callback) => {
    joinRoom(socket, roomId, profile, callback);
  });

  socket.on('room:leave', () => leaveCurrentRoom(socket));

  socket.on('player:move', (position) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.vehicleId || !position) return;
    const x = Number(position.x);
    const z = Number(position.z);
    const rotationY = Number(position.rotationY);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const bounds = player.zone === 'city'
      ? { minX: 27.2, maxX: 92.0, minZ: -26.2, maxZ: 26.2 }
      : { minX: -8.55, maxX: 21.2, minZ: -8.2, maxZ: 8.2 };
    player.position = {
      x: Math.max(bounds.minX, Math.min(bounds.maxX, x)),
      y: player.zone === 'city' ? 0 : (Number(position.y) >= 1.5 ? 3.36 : 0),
      z: Math.max(bounds.minZ, Math.min(bounds.maxZ, z))
    };
    player.rotationY = Number.isFinite(rotationY) ? Math.max(-Math.PI * 8, Math.min(Math.PI * 8, rotationY)) : (player.rotationY || 0);
    player.moving = Boolean(position.moving);
    const activityWasActive = player.action && player.action !== 'none';
    player.action = 'none';
    player.bedId = null;
    player.chairId = null;
    socket.to(roomId).emit('player:move', {
      id: socket.id,
      position: player.position,
      rotationY: player.rotationY,
      moving: player.moving,
      action: player.action,
      zone: player.zone
    });
    if (activityWasActive) io.to(roomId).emit('room:players', publicPlayers(room));
  });

  socket.on('player:outfit', ({ outfit } = {}, callback) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    const player = room?.players.get(socket.id);
    if (!player) return callback?.({ ok: false, error: 'Join a penthouse first.' });
    player.outfit = normalizeOutfit(outfit);
    io.to(roomId).emit('room:players', publicPlayers(room));
    callback?.({ ok: true, outfit: player.outfit });
  });

  socket.on('player:action', ({ action, danceStyle } = {}, callback) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    const player = room?.players.get(socket.id);
    if (!room || !player) return callback?.({ ok: false, error: 'Join a penthouse first.' });
    const now = Date.now();
    if (now - (socket.data.lastActionAt || 0) < 300) return callback?.({ ok: false, error: 'Please wait a moment before changing activities.' });
    const nextAction = ['none', 'sleep', 'dance', 'sit'].includes(action) ? action : '';
    if (!nextAction) return callback?.({ ok: false, error: 'That activity is not available.' });
    if (player.vehicleId) return callback?.({ ok: false, error: 'Exit the car before changing activities.' });

    let nearestBed = null;
    let nearestChair = null;
    if (nextAction === 'sleep') {
      if (player.zone !== 'penthouse' || (Number(player.position.y) || 0) > 1.5) return callback?.({ ok: false, error: 'Sleeping is available in the downstairs bedrooms.' });
      nearestBed = Object.entries(BED_SPOTS)
        .map(([id, spot]) => ({ id, ...spot, distance: Math.hypot(player.position.x - spot.x, player.position.z - spot.z) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (!nearestBed || nearestBed.distance > 3.5) return callback?.({ ok: false, error: 'Walk closer to a bedroom bed first.' });
    }
    if (nextAction === 'sit') {
      if (player.zone !== 'penthouse' || (Number(player.position.y) || 0) < 1.5) return callback?.({ ok: false, error: 'The interactive chairs are upstairs.' });
      nearestChair = Object.entries(CHAIR_SPOTS)
        .map(([id, spot]) => ({ id, ...spot, distance: Math.hypot(player.position.x - spot.x, player.position.z - spot.z) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (!nearestChair || nearestChair.distance > 2.3) return callback?.({ ok: false, error: 'Walk closer to an upstairs chair first.' });
    }
    const previousAction = player.action;
    const previousBed = player.bedId ? BED_SPOTS[player.bedId] : null;
    const previousChair = player.chairId ? CHAIR_SPOTS[player.chairId] : null;
    player.action = nextAction;
    player.moving = false;
    player.bedId = null;
    player.chairId = null;
    if (nextAction === 'sit' && nearestChair) {
      player.chairId = nearestChair.id;
      player.position = { x: nearestChair.x, y: nearestChair.y, z: nearestChair.z };
      player.rotationY = Math.PI;
    } else if (previousAction === 'sit' && nextAction === 'none' && previousChair) {
      player.position = { x: previousChair.exitX, y: previousChair.y, z: previousChair.exitZ };
      player.rotationY = Math.PI / 2;
    } else if (nextAction === 'sleep' && nearestBed) {
      player.bedId = nearestBed.id;
      player.position = { x: nearestBed.x, y: 0, z: nearestBed.z };
      player.rotationY = 0;
    } else if (previousAction === 'sleep' && nextAction === 'none' && previousBed) {
      player.position = { x: previousBed.x, y: 0, z: previousBed.z + 2.25 };
      player.rotationY = Math.PI;
    } else if (nextAction === 'dance') {
      player.danceStyle = DANCE_STYLES.has(danceStyle) ? danceStyle : 'groove';
    }
    if (nextAction === 'none') player.danceStyle = 'groove';
    socket.data.lastActionAt = now;
    io.to(roomId).emit('room:players', publicPlayers(room));
    callback?.({ ok: true, action: player.action, danceStyle: player.danceStyle, position: player.position, players: publicPlayers(room) });
  });

  socket.on('floor:travel', (_payload = {}, callback) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    const player = room?.players.get(socket.id);
    if (!room || !player) return callback?.({ ok: false, error: 'Join a penthouse first.' });
    if (player.zone !== 'penthouse' || player.vehicleId) return callback?.({ ok: false, error: 'The upstairs staircase is inside the penthouse.' });
    if (Math.hypot(player.position.x, player.position.z - 1.0) > 4.2) return callback?.({ ok: false, error: 'Walk to the central staircase first.' });
    player.position = { x: 0, y: (Number(player.position.y) || 0) > 1.5 ? 0 : 3.36, z: 1.0 };
    player.action = 'none';
    player.bedId = null;
    player.chairId = null;
    player.moving = false;
    io.to(roomId).emit('room:players', publicPlayers(room));
    callback?.({ ok: true, position: player.position, players: publicPlayers(room) });
  });

  socket.on('chat:send', ({ text } = {}, callback) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    const player = room?.players.get(socket.id);
    if (!room || !player) return callback?.({ ok: false, error: 'Join a penthouse before chatting.' });
    const now = Date.now();
    if (now - (socket.data.lastChatAt || 0) < 450) return callback?.({ ok: false, error: 'You are sending messages too quickly.' });
    const messageText = cleanText(text, '', 400);
    if (!messageText) return callback?.({ ok: false, error: 'Write a message first.' });
    socket.data.lastChatAt = now;
    const message = {
      id: crypto.randomBytes(8).toString('hex'),
      playerId: socket.id,
      name: player.name,
      character: player.character,
      text: messageText,
      timestamp: now
    };
    room.chat.push(message);
    if (room.chat.length > 80) room.chat.splice(0, room.chat.length - 80);
    io.to(roomId).emit('chat:message', message);
    callback?.({ ok: true });
  });


  socket.on('elevator:travel', (_payload, callback) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    const player = room?.players.get(socket.id);
    if (!room || !player) return callback?.({ ok: false, error: 'Join a penthouse first.' });
    if (player.vehicleId) return callback?.({ ok: false, error: 'Exit your car before using the elevator.' });
    const station = player.zone === 'city' ? { x: 28.5, z: 0 } : { x: 19.2, z: -6.0 };
    const distance = Math.hypot(player.position.x - station.x, player.position.z - station.z);
    if (distance > 3.8) return callback?.({ ok: false, error: 'Walk to the glowing elevator doors first.' });

    if (player.zone === 'city') {
      player.zone = 'penthouse';
      player.position = { x: 17.1, z: -6.0 };
      player.rotationY = Math.PI;
    } else {
      player.zone = 'city';
      player.position = { x: 30.5, z: 0 };
      player.rotationY = Math.PI / 2;
    }
    player.moving = false;
    player.action = 'none';
    player.bedId = null;
    io.to(roomId).emit('room:players', publicPlayers(room));
    io.to(roomId).emit('system:notice', { text: `${player.name} took the elevator to the ${player.zone === 'city' ? 'city promenade' : 'penthouse'}.` });
    callback?.({ ok: true, zone: player.zone, position: player.position, players: publicPlayers(room) });
  });

  socket.on('voice:status', ({ joined, muted } = {}) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    const player = room?.players.get(socket.id);
    if (!room || !player) return;
    player.voiceJoined = Boolean(joined);
    player.voiceMuted = player.voiceJoined ? Boolean(muted) : true;
    if (!player.voiceJoined) player.voiceMuted = true;
    io.to(roomId).emit('room:players', publicPlayers(room));
  });

  socket.on('voice:signal', ({ targetId, signal } = {}) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    const sender = room?.players.get(socket.id);
    const recipient = room?.players.get(String(targetId || ''));
    if (!sender?.voiceJoined || !recipient?.voiceJoined || !signal || typeof signal !== 'object') return;
    // Relay WebRTC descriptions and ICE candidates only within the same private room.
    io.to(recipient.id).emit('voice:signal', { from: socket.id, signal });
  });

  socket.on('vehicle:enter', ({ vehicleId } = {}, callback) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    const player = room?.players.get(socket.id);
    const vehicle = room?.vehicles.get(String(vehicleId || ''));
    if (!room || !player) return callback?.({ ok: false, error: 'Join a penthouse first.' });
    if (!vehicle) return callback?.({ ok: false, error: 'That car is not available.' });
    if((vehicle.zone||'penthouse')!==(player.zone||'penthouse'))return callback?.({ok:false,error:'That car is in the other district.'});
    if (player.vehicleId) return callback?.({ ok: false, error: 'You are already driving.' });
    if (vehicle.driverId && vehicle.driverId !== socket.id) return callback?.({ ok: false, error: 'Someone is already driving this car.' });
    const distance = Math.hypot(player.position.x - vehicle.position.x, player.position.z - vehicle.position.z);
    if (distance > 4.8) return callback?.({ ok: false, error: 'Walk closer to the car first.' });
    player.vehicleId = vehicle.id;
    player.moving = false;
    player.action = 'none';
    player.bedId = null;
    vehicle.driverId = socket.id;
    io.to(roomId).emit('room:players', publicPlayers(room));
    io.to(roomId).emit('room:vehicles', publicVehicles(room));
    io.to(roomId).emit('system:notice', { text: `${player.name} got into a car.` });
    callback?.({ ok: true, vehicleId: vehicle.id });
  });

  socket.on('vehicle:exit', (_payload, callback) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    const player = room?.players.get(socket.id);
    const vehicle = player?.vehicleId ? room?.vehicles.get(player.vehicleId) : null;
    if (!room || !player || !vehicle) return callback?.({ ok: false, error: 'You are not in a car.' });
    const yaw = vehicle.rotationY || 0;
    player.position = vehicle.zone === 'city' ? {x:Math.max(29,Math.min(88,vehicle.position.x+Math.cos(yaw)*1.9)),z:Math.max(-4.8,Math.min(4.8,vehicle.position.z+Math.sin(yaw)*1.9))} : {x:Math.max(9.7,Math.min(20.8,vehicle.position.x+Math.cos(yaw)*1.9)),z:Math.max(-7.8,Math.min(7.8,vehicle.position.z+Math.sin(yaw)*1.9))};
    player.rotationY = yaw;
    player.vehicleId = null;
    player.moving = false;
    player.action = 'none';
    player.bedId = null;
    vehicle.driverId = null;
    io.to(roomId).emit('room:players', publicPlayers(room));
    io.to(roomId).emit('room:vehicles', publicVehicles(room));
    callback?.({ ok: true, position: player.position, rotationY: player.rotationY });
  });

  socket.on('vehicle:move', ({ vehicleId, position, rotationY } = {}) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    const player = room?.players.get(socket.id);
    const vehicle = room?.vehicles.get(String(vehicleId || ''));
    if (!room || !player || !vehicle || player.vehicleId !== vehicle.id || vehicle.driverId !== socket.id || !position) return;
    const x = Number(position.x);
    const z = Number(position.z);
    const yaw = Number(rotationY);
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return;
    vehicle.position = vehicle.zone === 'city' ? {x:Math.max(30,Math.min(87,x)),z:Math.max(-2.55,Math.min(2.55,z))} : {x:Math.max(10.05,Math.min(21.0,x)),z:Math.max(-7.7,Math.min(7.7,z))};
    vehicle.rotationY = Math.max(-Math.PI * 8, Math.min(Math.PI * 8, yaw));
    socket.to(roomId).emit('vehicle:move', {
      vehicleId: vehicle.id,
      position: vehicle.position,
      rotationY: vehicle.rotationY,
      driverId: socket.id
    });
  });

  socket.on('music:queue:add', ({ videoId } = {}, callback) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    const player = room?.players.get(socket.id);
    if (!room || !player) return callback?.({ ok: false, error: 'Join a room before adding music.' });
    if (typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return callback?.({ ok: false, error: 'Paste a valid YouTube video link or ID.' });
    }
    if (room.musicQueue.length >= MAX_MUSIC_QUEUE_ITEMS) {
      return callback?.({ ok: false, error: `The shared queue is full (${MAX_MUSIC_QUEUE_ITEMS} tracks maximum).` });
    }
    const wasEmpty = room.musicQueue.length === 0;
    room.musicQueue.push({ id: crypto.randomBytes(5).toString('hex'), videoId, addedBy: player.name });
    if (wasEmpty) playQueuedTrack(roomId, room, 0);
    else broadcastMusicQueue(roomId, room);
    callback?.({ ok: true, queue: publicMusicQueue(room) });
  });

  socket.on('music:queue:replace', ({ videoIds } = {}, callback) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    const player = room?.players.get(socket.id);
    if (!room || !player) return callback?.({ ok: false, error: 'Join a room before sharing a playlist.' });
    if (!Array.isArray(videoIds) || videoIds.length < 1 || videoIds.length > MAX_MUSIC_QUEUE_ITEMS ||
        videoIds.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(id))) {
      return callback?.({ ok: false, error: 'Playlist must contain 1 to 50 valid YouTube video IDs.' });
    }
    room.musicQueue = videoIds.map((videoId) => ({
      id: crypto.randomBytes(5).toString('hex'), videoId, addedBy: player.name
    }));
    room.musicIndex = 0;
    playQueuedTrack(roomId, room, 0);
    callback?.({ ok: true, queue: publicMusicQueue(room) });
  });

  socket.on('music:play', ({ index } = {}, callback) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    if (!room) return callback?.({ ok: false, error: 'Join a room first.' });
    const target = Number(index);
    if (!Number.isInteger(target) || target < 0 || target >= room.musicQueue.length) {
      return callback?.({ ok: false, error: 'That track is no longer in the queue.' });
    }
    playQueuedTrack(roomId, room, target);
    callback?.({ ok: true });
  });

  socket.on('music:next', (_payload, callback) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    if (!room) return callback?.({ ok: false, error: 'Join a room first.' });
    const nextIndex = room.musicIndex + 1;
    if (!playQueuedTrack(roomId, room, nextIndex)) {
      return callback?.({ ok: false, error: 'There are no more tracks in the shared queue.' });
    }
    callback?.({ ok: true });
  });

  socket.on('youtube:load', ({ videoId } = {}) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    if (!room || typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return;
    room.youtube = { videoId, isPlaying: false, currentTime: 0, updatedAt: Date.now() };
    socket.to(roomId).emit('youtube:load', { videoId });
  });

  socket.on('youtube:playback', ({ isPlaying, currentTime } = {}) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    if (!room || !room.youtube.videoId) return;
    room.youtube.isPlaying = Boolean(isPlaying);
    const time = Number(currentTime);
    if (Number.isFinite(time)) room.youtube.currentTime = Math.max(0, Math.min(time, 24 * 60 * 60));
    room.youtube.updatedAt = Date.now();
    socket.to(roomId).emit('youtube:playback', {
      isPlaying: room.youtube.isPlaying,
      currentTime: room.youtube.currentTime,
      updatedAt: room.youtube.updatedAt
    });
  });

  socket.on('room:sync', (_payload, callback) => {
    const roomId = socket.data.roomId;
    const room = roomId && getRoom(roomId);
    if (!room || !room.players.has(socket.id)) {
      return callback?.({ ok: false, error: 'Your room session has expired. Rejoin using your invite link.' });
    }
    const player = room.players.get(socket.id);
    player.voiceJoined = false;
    player.voiceMuted = true;
    callback?.({
      ok: true,
      roomId,
      selfId: socket.id,
      players: publicPlayers(room),
      vehicles: publicVehicles(room),
      chat: room.chat.slice(-50),
      youtube: projectedYoutubeState(room.youtube),
      musicQueue: room.musicQueue.map((item) => ({ ...item })),
      musicIndex: room.musicIndex,
      roomType: room.roomType || 'penthouse'
    });
    io.to(roomId).emit('room:players', publicPlayers(room));
  });

  socket.on('disconnect', () => scheduleDisconnectedRoomCleanup(socket));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Tom&Grace is running at http://localhost:${PORT}`);
});
