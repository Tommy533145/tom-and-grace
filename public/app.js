import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

const $ = (id) => document.getElementById(id);
const socket = window.io();

const REGION_STORAGE_KEY = 'tg-server-region';
let regionOptions = [];
let regionRedirectPending = false;

async function pingRegion(region) {
  const start = performance.now();
  try {
    const response = await fetch(`${region.url}/health?ping=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('health check failed');
    const data = await response.json();
    if (!data.ok) throw new Error('server not ready');
    return { ...region, ping: Math.round(performance.now() - start), online: true };
  } catch (_error) {
    return { ...region, ping: null, online: false };
  }
}

function switchRegion(region) {
  if (!region?.url || regionRedirectPending) return;
  const destination = new URL(region.url);
  const current = new URL(window.location.href);
  if (destination.origin === current.origin) return;
  destination.pathname = current.pathname;
  destination.search = current.search;
  destination.hash = current.hash;
  regionRedirectPending = true;
  window.location.assign(destination.toString());
}

async function setupRegionPicker() {
  const picker = $('regionSelect');
  const status = $('regionStatus');
  if (!picker || !status) return;
  try {
    const response = await fetch('/api/regions', { cache: 'no-store' });
    if (!response.ok) throw new Error('region directory unavailable');
    const directory = await response.json();
    regionOptions = (directory.regions || []).filter((item) => item && item.id && item.name && item.url);
    picker.innerHTML = '<option value="auto">Automatic (recommended)</option>';
    for (const region of regionOptions) {
      const option = document.createElement('option');
      option.value = region.id;
      option.textContent = region.name;
      picker.appendChild(option);
    }
    const currentRegion = regionOptions.find((item) => item.id === directory.currentRegion);
    if (invitedRoom) {
      picker.value = currentRegion?.id || 'auto';
      picker.disabled = true;
      status.textContent = 'Friend invite server';
      return;
    }
    const saved = localStorage.getItem(REGION_STORAGE_KEY) || 'auto';
    picker.value = saved === 'auto' || regionOptions.some((item) => item.id === saved) ? saved : 'auto';
    const selected = picker.value === 'auto'
      ? (await Promise.all(regionOptions.map(pingRegion))).filter((item) => item.online).sort((a, b) => a.ping - b.ping)[0]
      : await pingRegion(regionOptions.find((item) => item.id === picker.value) || {});
    if (selected?.online) {
      status.textContent = `${selected.name} · ${selected.ping} ms`;
      if (picker.value === 'auto') switchRegion(selected);
    } else {
      status.textContent = 'Using available server';
    }
  } catch (_error) {
    status.textContent = 'Global server';
  }
  picker.addEventListener('change', async () => {
    const value = picker.value;
    localStorage.setItem(REGION_STORAGE_KEY, value);
    if (value === 'auto') {
      status.textContent = 'Finding best connection…';
      const results = await Promise.all(regionOptions.map(pingRegion));
      const best = results.filter((item) => item.online).sort((a, b) => a.ping - b.ping)[0];
      if (best) switchRegion(best);
      else status.textContent = 'No server responded';
      return;
    }
    const region = regionOptions.find((item) => item.id === value);
    if (!region) return;
    status.textContent = 'Checking server…';
    const result = await pingRegion(region);
    if (result.online) switchRegion(region);
    else status.textContent = 'Server unavailable';
  });
}

const params = new URLSearchParams(window.location.search);
const invitedRoom = (params.get('room') || '').toUpperCase();
let selectedCharacter = 'tom';
const ROOM_TYPES = {
  penthouse: { name: 'Penthouse', subtitle: 'City views · Rooftop · Garage · Mini Mart', greeting: 'Welcome to the penthouse' }
};
let selectedRoomType = 'penthouse';
let activeRoomType = 'penthouse';
let activeRoomId = '';
let activeProfile = null;
let isRejoiningRoom = false;
let selfId = '';
let players = [];
let vehicles = [];
let activeVehicleId = '';
let world = null;
let toastTimer = null;
let youtube = null;
let youtubeReady = false;
let youtubeSyncGuard = false;
let pendingYoutubeState = null;
let lastYoutubeSyncAt = 0;
let musicQueue = [];
let musicIndex = -1;
let moveKeys = new Set();
const MOBILE_DEVICE = navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches ||
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

let lastMoveSentAt = 0;
let lastSentPosition = { x: 0, z: 0 };
let lastVehicleSentAt = 0;
let lastVehicleSentPosition = { x: 0, z: 0 };
let currentOutfit = { color: 'sky', style: 'cozy', accessory: 'none' };
let currentZone = 'penthouse';
let activeWeatherKind=(()=>{try{return localStorage.getItem('tg-player-weather')||'clear';}catch(_error){return 'clear';}})();
let cityMission={active:false,collected:0,pickups:[]};
let voiceJoined = false;
let voiceMuted = true;
let localVoiceStream = null;
const voicePeers = new Map();
const remoteAudioElements = new Map();

const OUTFIT_COLORS = {
  cream: 0xe6d5c2, rose: 0xc77e8c, midnight: 0x293d60, sage: 0x718d78,
  lavender: 0x9b88b8, black: 0x292b33, sky: 0x5f9bb6, cherry: 0xa33f50
};
const OUTFIT_LABELS = { cream: 'Cream', rose: 'Rose', midnight: 'Midnight', sage: 'Sage', lavender: 'Lavender', black: 'Black', sky: 'Sky blue', cherry: 'Cherry' };
const DEFAULT_OUTFIT_COLORS = { tom: 'sky', grace: 'rose', alex: 'sage', riley: 'lavender' };

const CHARACTER_INFO = {

  tom: { label: 'Tom', color: 0x648fa5, hair: 0x30232b, skin: 0xe7b895, accent: 0xd3a58d },
  grace: { label: 'Grace', color: 0xc17e8c, hair: 0x59342f, skin: 0xeec4a7, accent: 0xe0b0a9 },
  alex: { label: 'Alex', color: 0x668c78, hair: 0x262126, skin: 0xd9a77f, accent: 0x9bb6a5 },
  riley: { label: 'Riley', color: 0x8f7ba9, hair: 0x9d5e43, skin: 0xf0c29f, accent: 0xc8b1d5 }
};

function showToast(message) {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function getProfile() {
  const defaultName = CHARACTER_INFO[selectedCharacter]?.label || 'Friend';
  const name = $('playerName').value.trim().slice(0, 18) || defaultName;
  const outfit = { ...currentOutfit, color: currentOutfit.color || DEFAULT_OUTFIT_COLORS[selectedCharacter] };
  return { name, character: selectedCharacter, outfit };
}

function setLobbyMode() {
  $('inviteNotice').classList.toggle('hidden', !invitedRoom);
  $('enterButtonText').textContent = invitedRoom ? 'Join the shared room' : 'Create ' + ROOM_TYPES[selectedRoomType].name;
  $('topStatus').textContent = invitedRoom ? 'You have a penthouse invitation' : 'Your little world awaits';
}

function selectCharacter(character) {
  if (!CHARACTER_INFO[character]) return;
  selectedCharacter = character;
  currentOutfit = { ...currentOutfit, color: DEFAULT_OUTFIT_COLORS[character] || 'cream' };
  document.querySelectorAll('.character-option').forEach((button) => {
    button.classList.toggle('selected', button.dataset.character === character);
  });
}

document.querySelectorAll('.character-option').forEach((button) => {
  button.addEventListener('click', () => selectCharacter(button.dataset.character));
});
setLobbyMode();
setupRegionPicker();

function extractRoomCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return (url.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  } catch (_error) {
    return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }
}

function enterRoom(response) {
  if (!response?.ok) {
    showToast(response?.error || 'Could not enter this house. Try again.');
    return;
  }
  activeRoomId = response.roomId;
  activeRoomType = 'penthouse';
  selfId = response.selfId || socket.id;
  players = response.players || [];
  vehicles = response.vehicles || [];
  activeVehicleId = players.find((player) => player.id === selfId)?.vehicleId || '';
  currentZone = players.find((player) => player.id === selfId)?.zone || 'penthouse';
  $('lobby').classList.add('hidden');
  $('game').classList.remove('hidden');

  $('topStatus').textContent = 'You are home';
  $('activeRoomName').textContent = ROOM_TYPES[activeRoomType].name;
  $('roomSubtitle').textContent = `${players.length} / 8 · ${ROOM_TYPES[activeRoomType].subtitle}`;
  const url = new URL(window.location.href);
  url.searchParams.set('room', activeRoomId);
  history.replaceState({}, '', url.toString());
  updateResidentAvatars();
  // Avoid duplicate mobile-control listeners when restoring an existing scene.
  if (!world) {
    setupMobileControls();
    initializeWorld();
  }
  updatePlayers(players);
  updateVehicles(vehicles);
  renderChatHistory(response.chat || []);
  syncVoicePeers(players);
  renderVoiceControls();
  const myProfile = players.find((player) => player.id === selfId);
  if (myProfile?.outfit) syncWardrobeControls(myProfile.outfit);
  updateActivityControls(players);
  if (response.youtube?.videoId) applyInitialYoutubeState(response.youtube);
  renderMusicQueue({ queue: response.musicQueue || [], currentIndex: response.musicIndex ?? -1 });
  showToast(players.length >= 2 ? 'Welcome to ' + ROOM_TYPES[activeRoomType].name + '. Your people are here.' : ROOM_TYPES[activeRoomType].name + ' is ready. Share the invite link.');
}

function createHouse() {
  activeProfile = getProfile();
  socket.emit('room:create', { profile: activeProfile, roomType: 'penthouse' }, (response) => enterRoom(response));
}

function joinHouse(roomId) {
  if (!roomId) {
    showToast('Paste a house invite link or room code first.');
    return;
  }
  activeProfile = getProfile();
  socket.emit('room:join', { roomId, profile: activeProfile }, (response) => enterRoom(response));
}

$('enterButton').addEventListener('click', () => {
  if (invitedRoom) joinHouse(invitedRoom);
  else createHouse();
});
$('joinButton').addEventListener('click', () => joinHouse(extractRoomCode($('roomCodeInput').value)));
$('roomCodeInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') joinHouse(extractRoomCode($('roomCodeInput').value));
});
$('inviteButton').addEventListener('click', copyInviteLink);
$('leaveButton').addEventListener('click', () => {
  leaveVoiceChat(true);
  socket.emit('room:leave');
  if (world) {
    window.removeEventListener('resize', world.resizeHandler);
    world.renderer.dispose();
    world.renderer.domElement.remove();
    world = null;
  }
  activeRoomId = '';
  activeProfile = null;
  isRejoiningRoom = false;
  activeRoomType = 'penthouse';
  selfId = '';
  players = [];
  vehicles = [];
  activeVehicleId = '';
  currentZone = 'penthouse';
  $('game').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  history.replaceState({}, '', url.toString());
  setLobbyMode();
});

async function copyInviteLink() {
  const url = new URL(window.location.href);
  url.searchParams.set('room', activeRoomId);
  try {
    await navigator.clipboard.writeText(url.toString());
    showToast('Invite link copied. Share it with your friends ♡');
  } catch (_error) {
    window.prompt('Copy your house invite link:', url.toString());
  }
}

// ---------------------------- Multiplayer ----------------------------
socket.on('room:players', (nextPlayers) => {
  if (!activeRoomId) return;
  const previousCount = players.length;
  players = nextPlayers || [];
  updatePlayers(players);
  $('roomSubtitle').textContent = `${players.length} / 8 · ${ROOM_TYPES[activeRoomType]?.subtitle || ROOM_TYPES.penthouse.subtitle}`;
  currentZone = players.find((player) => player.id === selfId)?.zone || currentZone;
  syncVoicePeers(players);
  if (players.length > previousCount && previousCount > 0) showToast('Someone just arrived at the penthouse ♡');
});

socket.on('player:move', ({ id, position, rotationY, moving, zone } = {}) => {
  if (!id || !position || !world) return;
  const object = world.playerObjects.get(id);
  if (object) {
    object.userData.targetPosition.set(position.x, 0, position.z);
    if (Number.isFinite(Number(rotationY))) object.userData.targetRotationY = Number(rotationY);
    object.userData.networkMoving = Boolean(moving);
    object.userData.action = 'none';
    object.rotation.x = 0;
    object.rotation.z = 0;
    if (zone) object.userData.zone = zone;
  }
});

socket.on('room:vehicles', (nextVehicles) => updateVehicles(nextVehicles || []));

socket.on('vehicle:move', ({ vehicleId, position, rotationY, driverId } = {}) => {
  if (!world || !vehicleId || !position) return;
  const vehicle = world.vehicleObjects.get(vehicleId);
  if (!vehicle) return;
  const localState = vehicles.find((item) => item.id === vehicleId);
  if (localState) { localState.position = { x: position.x, z: position.z }; localState.rotationY = Number(rotationY) || 0; localState.driverId = driverId || null; }
  vehicle.userData.targetPosition.set(position.x, 0, position.z);
  if (Number.isFinite(Number(rotationY))) vehicle.userData.targetRotationY = Number(rotationY);
  vehicle.userData.driverId = driverId || null;
});

socket.on('chat:message', (message) => appendChatMessage(message));
socket.on('system:notice', ({ text } = {}) => {
  if (text) appendChatMessage({ system: true, text, timestamp: Date.now() });
});

socket.on('voice:signal', async ({ from, signal } = {}) => {
  if (!from || !signal || !voiceJoined) return;
  const peer = ensureVoicePeer(from);
  if (!peer) return;
  try {
    if (signal.description) {
      const description = signal.description;
      const readyForOffer = !peer.makingOffer && (peer.pc.signalingState === 'stable' || peer.isSettingRemoteAnswerPending);
      const offerCollision = description.type === 'offer' && !readyForOffer;
      peer.ignoreOffer = !peer.polite && offerCollision;
      if (peer.ignoreOffer) return;
      peer.isSettingRemoteAnswerPending = description.type === 'answer';
      await peer.pc.setRemoteDescription(description);
      peer.isSettingRemoteAnswerPending = false;
      while (peer.pendingCandidates.length) {
        const candidate = peer.pendingCandidates.shift();
        await peer.pc.addIceCandidate(candidate);
      }
      if (description.type === 'offer') {
        await peer.pc.setLocalDescription();
        socket.emit('voice:signal', { targetId: from, signal: { description: peer.pc.localDescription } });
      }
    } else if (signal.candidate) {
      if (peer.ignoreOffer) return;
      if (!peer.pc.remoteDescription) peer.pendingCandidates.push(signal.candidate);
      else {
        try { await peer.pc.addIceCandidate(signal.candidate); }
        catch (error) { if (!peer.ignoreOffer) throw error; }
      }
    }
  } catch (error) {
    console.warn('Voice negotiation failed:', error);
    $('voiceProximity').textContent = 'Voice connection interrupted. Try leaving and rejoining voice.';
  }
});

socket.on('music:queue:update', (state) => renderMusicQueue(state));
socket.on('youtube:load', ({ videoId } = {}) => {
  if (!videoId) return;
  loadYoutubeVideo(videoId, true);
});

socket.on('youtube:playback', (state) => {
  if (!state || !youtubeReady || !youtube || !youtube.getVideoUrl?.()) return;
  const localTime = youtube.getCurrentTime?.() || 0;
  const targetTime = Number(state.currentTime) || 0;
  const localPlaying = youtube.getPlayerState?.() === 1;
  const drift = Math.abs(localTime - targetTime);
  if (drift > 3 || localPlaying !== Boolean(state.isPlaying)) {
    applyRemoteYoutubePlayback(Boolean(state.isPlaying), targetTime);
  }
});

socket.on('disconnect', (reason) => {
  if (!activeRoomId) return;
  // Preserve the latest appearance when the fallback path creates a fresh socket session.
  const currentPlayer = players.find((player) => player.id === selfId);
  if (currentPlayer) {
    activeProfile = {
      name: currentPlayer.name,
      character: currentPlayer.character,
      outfit: { ...(currentPlayer.outfit || {}) }
    };
  }
  // Do not leave the room intentionally; Socket.IO may recover the same session.
  leaveVoiceChat(true);
  $('topStatus').textContent = 'Connection lost · reconnecting…';
  console.warn('Tom&Grace multiplayer connection lost:', reason);
});

socket.on('connect', () => {
  if (!activeRoomId || isRejoiningRoom) return;
  if (socket.recovered) {
    $('topStatus').textContent = 'Connection restored';
    showToast('Connection restored. You are back in your room ♡');
    return;
  }

  // If Socket.IO could not recover the old session, rejoin the same invite room.
  isRejoiningRoom = true;
  const roomId = activeRoomId;
  const profile = activeProfile || getProfile();
  socket.emit('room:join', { roomId, profile }, (response) => {
    isRejoiningRoom = false;
    if (!response?.ok) {
      $('topStatus').textContent = 'Reconnect failed';
      showToast(response?.error || 'Could not restore your room. Please reload and rejoin.');
      return;
    }
    activeProfile = profile;
    enterRoom(response);
    $('topStatus').textContent = 'You are home';
    showToast('Connection restored. Your room is ready again ♡');
  });
});

// ---------------------------- Proximity voice chat ----------------------------
function renderVoiceControls() {
  const status = $('voiceStatus');
  const join = $('voiceJoinButton');
  const mute = $('voiceMuteButton');
  if (!status || !join || !mute) return;
  status.textContent = voiceJoined ? (voiceMuted ? 'MUTED' : 'VOICE ON') : 'OFF';
  status.classList.toggle('voice-live', voiceJoined && !voiceMuted);
  join.textContent = voiceJoined ? 'Leave voice' : 'Join voice';
  join.classList.toggle('leave', voiceJoined);
  mute.disabled = !voiceJoined;
  mute.textContent = voiceMuted ? 'Unmute mic' : 'Mute mic';
  mute.classList.toggle('muted', voiceMuted);
}

function voiceIceServers() {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }];
  const config = window.TG_CONFIG || {};
  if (config.VOICE_TURN_URL && config.VOICE_TURN_USERNAME && config.VOICE_TURN_CREDENTIAL) {
    servers.push({
      urls: config.VOICE_TURN_URL,
      username: config.VOICE_TURN_USERNAME,
      credential: config.VOICE_TURN_CREDENTIAL
    });
  }
  return servers;
}

function ensureVoicePeer(peerId) {
  if (!voiceJoined || !peerId || peerId === selfId) return null;
  if (voicePeers.has(peerId)) return voicePeers.get(peerId);
  const pc = new RTCPeerConnection({ iceServers: voiceIceServers() });
  const state = {
    pc,
    polite: String(selfId).localeCompare(String(peerId)) > 0,
    makingOffer: false,
    ignoreOffer: false,
    isSettingRemoteAnswerPending: false,
    pendingCandidates: [],
    restartRequested: false
  };
  voicePeers.set(peerId, state);
  if (localVoiceStream) {
    localVoiceStream.getTracks().forEach((track) => pc.addTrack(track, localVoiceStream));
  }
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('voice:signal', { targetId: peerId, signal: { candidate } });
  };
  pc.onnegotiationneeded = async () => {
    try {
      state.makingOffer = true;
      await pc.setLocalDescription();
      socket.emit('voice:signal', { targetId: peerId, signal: { description: pc.localDescription } });
    } catch (error) {
      console.warn('Could not start voice negotiation:', error);
    } finally {
      state.makingOffer = false;
    }
  };
  pc.ontrack = (event) => {
    let audio = remoteAudioElements.get(peerId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audio.setAttribute('autoplay', '');
      audio.setAttribute('playsinline', '');
      audio.volume = 0;
      audio.muted = false;
      audio.setAttribute('aria-label', 'Nearby player voice');
      $('voiceAudioContainer').appendChild(audio);
      remoteAudioElements.set(peerId, audio);
    }
    const stream = event.streams?.[0] || new MediaStream([event.track]);
    if (audio.srcObject !== stream) audio.srcObject = stream;
    audio.play().catch((error) => {
      console.warn('Remote voice playback was blocked:', error);
      $('voiceProximity').textContent = 'Tap Join voice again or allow sound playback to hear other players.';
    });
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed' && !state.restartRequested) {
      state.restartRequested = true;
      try {
        pc.restartIce();
        $('voiceProximity').textContent = 'Reconnecting voice…';
      } catch (error) {
        console.warn('Voice ICE restart failed:', error);
      }
    }
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      state.restartRequested = false;
      $('voiceProximity').textContent = 'Voice connected. Audio fades with distance.';
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') {
      $('voiceProximity').textContent = 'Voice network connection failed. Check your network and microphone permissions, then rejoin voice.';
      if (!state.restartRequested) {
        state.restartRequested = true;
        try { pc.restartIce(); } catch (error) { console.warn('Voice connection restart failed:', error); }
      }
    } else if (pc.connectionState === 'connected') {
      state.restartRequested = false;
    } else if (pc.connectionState === 'closed') {
      closeVoicePeer(peerId);
    }
  };
  return state;
}

function closeVoicePeer(peerId) {
  const state = voicePeers.get(peerId);
  if (state) {
    state.pc.ontrack = null;
    state.pc.onicecandidate = null;
    state.pc.onnegotiationneeded = null;
    state.pc.close();
    voicePeers.delete(peerId);
  }
  const audio = remoteAudioElements.get(peerId);
  if (audio) {
    audio.pause();
    audio.srcObject = null;
    audio.remove();
    remoteAudioElements.delete(peerId);
  }
}

function syncVoicePeers(nextPlayers) {
  if (!activeRoomId) return;
  const eligible = new Set((nextPlayers || []).filter((player) => player.id !== selfId && player.voiceJoined).map((player) => player.id));
  [...voicePeers.keys()].forEach((peerId) => { if (!eligible.has(peerId)) closeVoicePeer(peerId); });
  if (voiceJoined) eligible.forEach((peerId) => ensureVoicePeer(peerId));
  updateVoiceAudioVolumes();
}

async function joinVoiceChat() {
  if (!activeRoomId) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    showToast('Voice chat needs a browser with microphone support on HTTPS or localhost.');
    return;
  }
  try {
    if (!localVoiceStream || !localVoiceStream.getAudioTracks().some((track) => track.readyState === 'live')) {
      if (localVoiceStream) localVoiceStream.getTracks().forEach((track) => track.stop());
      localVoiceStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          channelCount: { ideal: 1 }
        },
        video: false
      });
    }
    const microphoneTrack = localVoiceStream.getAudioTracks()[0];
    if (!microphoneTrack || microphoneTrack.readyState !== 'live') {
      throw new Error('No active microphone track was found. Check your input device.');
    }
    voiceJoined = true;
    voiceMuted = false;
    localVoiceStream.getAudioTracks().forEach((track) => { track.enabled = true; });
    players.filter((player) => player.id !== selfId && player.voiceJoined).forEach((player) => {
      const peer = ensureVoicePeer(player.id);
      if (peer && peer.pc.getSenders().length === 0) localVoiceStream.getTracks().forEach((track) => peer.pc.addTrack(track, localVoiceStream));
    });
    socket.emit('voice:status', { joined: true, muted: false });
    renderVoiceControls();
    $('voiceProximity').textContent = 'Voice is on. Audio fades as players move farther away.';
    showToast('Nearby voice chat is on. Say hello!');
  } catch (error) {
    const messages = {
      NotAllowedError: 'Microphone permission is blocked. Allow microphone access in your browser or phone settings.',
      NotFoundError: 'No microphone was found. Connect or enable a microphone and try again.',
      NotReadableError: 'Your microphone is busy in another app. Close other apps using it and retry.',
      OverconstrainedError: 'The selected microphone cannot use the requested audio settings. Try another input device.',
      SecurityError: 'Microphone access requires HTTPS. Open Tom&Grace using its secure website address.'
    };
    console.warn('Could not join Tom&Grace voice:', error);
    showToast(messages[error?.name] || 'Could not start voice chat. Check your microphone and browser permissions.');
    $('voiceProximity').textContent = messages[error?.name] || error?.message || 'Microphone access was unavailable.';
    if (localVoiceStream && !localVoiceStream.getAudioTracks().some((track) => track.readyState === 'live')) {
      localVoiceStream.getTracks().forEach((track) => track.stop());
      localVoiceStream = null;
    }
  }
}

function muteVoiceMic(nextMuted = !voiceMuted) {
  if (!voiceJoined || !localVoiceStream) return;
  voiceMuted = Boolean(nextMuted);
  const tracks = localVoiceStream.getAudioTracks().filter((track) => track.readyState === 'live');
  tracks.forEach((track) => { track.enabled = !voiceMuted; });
  if (!tracks.length && !voiceMuted) {
    showToast('Your microphone is disconnected. Leave voice and join again after checking your mic.');
    return;
  }
  socket.emit('voice:status', { joined: true, muted: voiceMuted });
  renderVoiceControls();
  $('voiceProximity').textContent = voiceMuted ? 'Your microphone is muted. You can still hear nearby players.' : 'Your microphone is live. Audio is proximity-based.';
}

function leaveVoiceChat(silent = false) {
  if (activeRoomId && voiceJoined) socket.emit('voice:status', { joined: false, muted: true });
  voiceJoined = false;
  voiceMuted = true;
  if (localVoiceStream) {
    localVoiceStream.getTracks().forEach((track) => track.stop());
    localVoiceStream = null;
  }
  [...voicePeers.keys()].forEach(closeVoicePeer);
  remoteAudioElements.forEach((audio) => { audio.pause(); audio.srcObject = null; audio.remove(); });
  remoteAudioElements.clear();
  renderVoiceControls();
  if ($('voiceProximity')) $('voiceProximity').textContent = 'Voice is optional. Your microphone only turns on when you join.';
  if (!silent && activeRoomId) showToast('You left nearby voice chat.');
}

function updateVoiceAudioVolumes() {
  if (!world || !voiceJoined) return;
  const localCharacter = world.playerObjects.get(selfId);
  if (!localCharacter) return;
  const localProfile = players.find((player) => player.id === selfId);
  const local = localProfile?.vehicleId ? (world.vehicleObjects.get(localProfile.vehicleId) || localCharacter) : localCharacter;
  let nearby = 0;
  remoteAudioElements.forEach((audio, peerId) => {
    const remoteCharacter = world.playerObjects.get(peerId);
    const remoteProfile = players.find((player) => player.id === peerId);
    const remote = remoteProfile?.vehicleId ? (world.vehicleObjects.get(remoteProfile.vehicleId) || remoteCharacter) : remoteCharacter;
    if (!remote || (remoteCharacter?.userData.zone || 'penthouse') !== (localCharacter.userData.zone || currentZone)) {
      audio.volume = 0;
      return;
    }
    const distance = Math.hypot(local.position.x - remote.position.x, local.position.z - remote.position.z);
    const volume = THREE.MathUtils.clamp(1 - distance / 12, 0, 1);
    audio.volume = volume;
    if (volume > .02) nearby++;
  });
  $('voiceProximity').textContent = nearby
    ? `${nearby} player${nearby === 1 ? '' : 's'} close enough to hear. Walk away to fade out.`
    : 'No one nearby right now. Voice fades with distance and between the city and penthouse.';
}

$('voiceJoinButton').addEventListener('click', () => {
  if (voiceJoined) leaveVoiceChat();
  else joinVoiceChat();
});
$('voiceMuteButton').addEventListener('click', () => muteVoiceMic());

// ---------------------------- 3D house ----------------------------
function material(color, roughness = 0.8, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function addBox(scene, name, size, position, color, options = {}) {
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const mesh = new THREE.Mesh(geometry, options.material || material(color, options.roughness ?? 0.8, options.metalness ?? 0));
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = true;
  if (options.rotation) mesh.rotation.set(...options.rotation);
  scene.add(mesh);
  return mesh;
}

function addCylinder(scene, name, radiusTop, radiusBottom, height, position, color, radialSegments = 16) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments), material(color));
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function addSphere(parent, name, radius, position, color, scale = [1, 1, 1]) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 16), material(color));
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeNameSprite(label) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(22,20,25,.76)';
  roundRect(ctx, 20, 10, 216, 58, 25);
  ctx.fill();
  ctx.font = '600 29px DM Sans, sans-serif';
  ctx.fillStyle = '#fff3ed';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.slice(0, 18), 128, 40);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(1.05, 0.33, 1);
  sprite.position.set(0, 2.48, 0);
  return sprite;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function createCharacter(player) {
  const info = CHARACTER_INFO[player.character] || CHARACTER_INFO.tom;
  const outfit = player.outfit || { color: DEFAULT_OUTFIT_COLORS[player.character] || 'cream', style: 'cozy', accessory: 'none' };
  const garmentColor = OUTFIT_COLORS[outfit.color] || info.color;
  const root = new THREE.Group();
  root.position.set(player.position?.x || 0, 0, player.position?.z || 0);
  root.userData.playerId = player.id;
  root.userData.phase = Math.random() * Math.PI * 2;
  root.userData.outfitSignature = JSON.stringify(player.outfit || {});
  root.userData.action = player.action || 'none';
  root.userData.danceStyle = player.danceStyle || 'groove';
  root.userData.bedId = player.bedId || null;
  const clothingMat = material(garmentColor, outfit.style === 'elegant' ? .42 : .78);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(outfit.style === 'sporty' ? .25 : .27, .45, 5, 10), clothingMat);
  torso.position.y = .82;
  torso.castShadow = true;
  root.add(torso);
  if (outfit.style === 'streetwear') {
    addBoxToGroup(root, [.38, .16, .17], [0, .94, .18], garmentColor);
    addSphere(root, 'hood', .2, [0, 1.22, -.16], garmentColor, [1, .7, .72]);
  } else if (outfit.style === 'elegant') {
    addBoxToGroup(root, [.23, .2, .08], [0, 1.08, .17], 0xf1e8df);
    addBoxToGroup(root, [.055, .3, .055], [0, .82, .25], 0xb78b69);
  } else if (outfit.style === 'sporty') {
    addBoxToGroup(root, [.38, .06, .07], [0, .62, .23], 0xf4eee8);
    addBoxToGroup(root, [.08, .3, .05], [0, .83, .25], 0xf4eee8);
  } else {
    addBoxToGroup(root, [.36, .08, .06], [0, .65, .23], garmentColor);
  }
  const neck = addCylinderToGroup(root, 0.08, 0.08, 0.13, [0, 1.17, 0], info.skin);
  const head = addSphere(root, 'head', 0.235, [0, 1.48, 0], info.skin, [0.9, 1.05, 0.86]);
  const hair = addSphere(root, 'hair', 0.24, [0, 1.59, -0.025], info.hair, [1.02, 0.68, 0.9]);
  hair.rotation.z = player.character === 'grace' ? -0.1 : 0.04;
  if (player.character === 'grace' || player.character === 'riley') {
    const sideHair = addSphere(root, 'sidehair', 0.13, [0.17, 1.43, -0.005], info.hair, [0.6, 1.4, 0.75]);
    sideHair.rotation.z = -0.1;
  }
  const eyeMat = material(0x30232a, 0.5);
  [-0.075, 0.075].forEach((x) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), eyeMat);
    eye.position.set(x, 1.5, 0.194);
    root.add(eye);
  });
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 5, 12, Math.PI), material(0x9c5e59));
  smile.position.set(0, 1.423, 0.197);
  smile.rotation.z = Math.PI;
  root.add(smile);
  if (outfit.accessory === 'beanie') {
    addSphere(root, 'beanie', .235, [0, 1.72, -.005], garmentColor, [1.02, .48, .9]);
    addSphere(root, 'beanie-pom', .055, [0, 1.84, -.01], 0xf2e7de);
  } else if (outfit.accessory === 'cap') {
    addSphere(root, 'cap-crown', .21, [0, 1.69, -.02], garmentColor, [1.1, .36, .92]);
    addBoxToGroup(root, [.36, .035, .25], [0, 1.61, .18], garmentColor);
  } else if (outfit.accessory === 'sunglasses') {
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x171d25, metalness: .35, roughness: .22 });
    [-.075, .075].forEach((x) => {
      const lens = new THREE.Mesh(new THREE.BoxGeometry(.105, .065, .035), lensMat);
      lens.position.set(x, 1.51, .205);
      root.add(lens);
    });
    addBoxToGroup(root, [.07, .018, .025], [0, 1.51, .205], 0x26232c);
  }
  const armMat = material(garmentColor);
  const limbPivots = { leftArm: null, rightArm: null, leftLeg: null, rightLeg: null };
  [-1, 1].forEach((side) => {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.3, 1.06, 0);
    root.add(armPivot);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.3, 4, 8), armMat);
    arm.position.set(0, -0.17, 0);
    arm.rotation.z = side * -0.18;
    arm.castShadow = true;
    armPivot.add(arm);
    addSphere(armPivot, 'hand', 0.075, [0, -0.37, 0.01], info.skin);

    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.12, 0.49, 0);
    root.add(legPivot);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.075, 0.42, 12), material(0x403b43));
    leg.position.y = -0.21;
    leg.castShadow = true;
    legPivot.add(leg);
    limbPivots[side < 0 ? 'leftArm' : 'rightArm'] = armPivot;
    limbPivots[side < 0 ? 'leftLeg' : 'rightLeg'] = legPivot;
  });
  const shoeColor = outfit.style === 'elegant' ? 0x342f38 : 0xede0d4;
  const shoes = addBoxToGroup(root, [0.16, 0.09, 0.25], [-0.12, 0.07, 0.045], shoeColor);
  addBoxToGroup(root, [0.16, 0.09, 0.25], [0.12, 0.07, 0.045], shoeColor);
  root.add(makeNameSprite(player.name || info.label));
  root.userData.torso = torso;
  root.userData.head = head;
  root.userData.hair = hair;
  root.userData.shoes = shoes;
  root.userData.limbs = limbPivots;
  root.userData.zone = player.zone || 'penthouse';
  return root;
}

function addCylinderToGroup(parent, radiusTop, radiusBottom, height, position, color) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 12), material(color));
  mesh.position.set(...position);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
function addBoxToGroup(parent, size, position, color) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color));
  mesh.position.set(...position);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function createCarMesh(vehicle) {
  const root = new THREE.Group();
  root.name = `vehicle-${vehicle.id}`;
  root.position.set(vehicle.position.x, 0, vehicle.position.z);
  root.rotation.y = vehicle.rotationY || 0;
  const isCoupe = vehicle.id === 'sunset-coupe';
  const bodyColor = vehicle.bodyColor || (isCoupe ? 0xb96f5d : 0x283847);
  const trim = 0x171c23;
  const carWidth = isCoupe ? 1.55 : 1.72;
  const carLength = isCoupe ? 3.05 : 3.32;
  const cabinHeight = isCoupe ? .55 : .68;
  addBoxToGroup(root, [carWidth, isCoupe ? .5 : .62, carLength], [0, isCoupe ? .58 : .64, 0], bodyColor);
  addBoxToGroup(root, [carWidth * .92, .23, isCoupe ? .86 : 1.02], [0, isCoupe ? .91 : 1.04, isCoupe ? 1.03 : 1.05], isCoupe ? 0xc17b65 : 0x354b5f);
  addBoxToGroup(root, [carWidth * .82, cabinHeight, isCoupe ? 1.42 : 1.62], [0, isCoupe ? 1.02 : 1.18, isCoupe ? -.18 : -.16], trim);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x8eb7c5, metalness: .18, roughness: .12, transparent: true, opacity: .68, transmission: .12 });
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.22, .42, .06), glass);
  windshield.position.set(0, isCoupe ? 1.13 : 1.28, .51);
  windshield.rotation.x = -.25;
  root.add(windshield);
  const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(1.18, .38, .06), glass);
  rearGlass.position.set(0, isCoupe ? 1.13 : 1.28, -.86);
  rearGlass.rotation.x = .25;
  root.add(rearGlass);
  addBoxToGroup(root, [.04, isCoupe ? .42 : .5, 1.22], [-.69, isCoupe ? 1.1 : 1.25, -.18], 0x202934);
  addBoxToGroup(root, [.04, isCoupe ? .42 : .5, 1.22], [.69, isCoupe ? 1.1 : 1.25, -.18], 0x202934);
  if (!isCoupe) {
    addBoxToGroup(root, [.06, .07, 1.28], [-.57, 1.58, -.12], 0x9aa5ad);
    addBoxToGroup(root, [.06, .07, 1.28], [.57, 1.58, -.12], 0x9aa5ad);
  }
  addBoxToGroup(root, [.38, .12, .08], [-.48, .66, 1.55], 0xf5e4bd);
  addBoxToGroup(root, [.38, .12, .08], [.48, .66, 1.55], 0xf5e4bd);
  addBoxToGroup(root, [.32, .1, .06], [-.5, .67, -1.55], 0x9a3e43);
  addBoxToGroup(root, [.32, .1, .06], [.5, .67, -1.55], 0x9a3e43);
  const wheels = [];
  [isCoupe ? -.82 : -.9, isCoupe ? .82 : .9].forEach((x) => [isCoupe ? -1.02 : -1.12, isCoupe ? 1.02 : 1.12].forEach((z) => {
    const tireRadius = isCoupe ? .34 : .38;
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(tireRadius, tireRadius, .19, 18), material(0x17191e, .94));
    tire.rotation.z = Math.PI / 2;
    tire.position.set(x, .36, z);
    tire.castShadow = true;
    root.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(isCoupe ? .17 : .19, isCoupe ? .17 : .19, .2, 16), material(0xb7b8b5, .32, .72));
    hub.rotation.z = Math.PI / 2;
    hub.position.set(x, .36, z);
    root.add(hub);
    wheels.push(tire, hub);
  }));
  addBoxToGroup(root, [.76, .08, .12], [0, .32, -.45], 0x171b20);
  root.userData.wheels = wheels;
  root.userData.targetPosition = new THREE.Vector3(vehicle.position.x, 0, vehicle.position.z);
  root.userData.targetRotationY = Number(vehicle.rotationY) || 0;
  root.userData.driverId = vehicle.driverId || null;
  return root;
}

function updateVehicles(nextVehicles) {
  vehicles = nextVehicles || [];
  if (!world) return;
  const incomingIds = new Set(vehicles.map((v) => v.id));
  world.vehicleObjects.forEach((object, id) => {
    if (!incomingIds.has(id)) {
      disposeSceneObject(object, world.scene);
      world.vehicleObjects.delete(id);
    }
  });
  vehicles.forEach((vehicle) => {
    let object = world.vehicleObjects.get(vehicle.id);
    if (!object) {
      object = createCarMesh(vehicle);
      world.scene.add(object);
      world.vehicleObjects.set(vehicle.id, object);
    }
    object.userData.targetPosition.set(vehicle.position.x, 0, vehicle.position.z);
    object.userData.targetRotationY = Number(vehicle.rotationY) || 0;
    object.userData.driverId = vehicle.driverId || null;
  });
}

function addRoomSign(scene, title, position, accent = '#e8b8ae') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(25,22,27,.78)';
  roundRect(ctx, 12, 12, 488, 104, 28);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.lineWidth = 3;
  roundRect(ctx, 12, 12, 488, 104, 28);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.font = '700 37px DM Sans, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title.toUpperCase(), 256, 65);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sign.position.set(...position);
  sign.scale.set(2.35, .59, 1);
  scene.add(sign);
  return sign;
}

function addHouseWall(scene, colliders, name, size, position, color = 0x735b56) {
  addBox(scene, name, size, position, color);
  colliders.push({
    minX: position[0] - size[0] / 2,
    maxX: position[0] + size[0] / 2,
    minZ: position[2] - size[2] / 2,
    maxZ: position[2] + size[2] / 2
  });
}

function createHouseScene(scene, colliders) {
  scene.background = new THREE.Color(0x9bb1c4);
  scene.fog = new THREE.Fog(0x9bb1c4, 52, 142);

  // Luxury tower podium and rooftop deck: the penthouse is a cutaway so the whole floor plan is playable.
  addBox(scene, 'tower-podium', [36, 3.6, 31], [5.5, -1.95, 0], 0x293441, { roughness: .65 });
  const roofDeck = new THREE.Mesh(new THREE.PlaneGeometry(32.5, 18.8), material(0x777b82, .45));
  roofDeck.rotation.x = -Math.PI / 2;
  roofDeck.position.set(5.0, -.09, 0);
  roofDeck.receiveShadow = true;
  scene.add(roofDeck);
  // A pale stone house plinth keeps the interior subtly raised above the terrace.
  addBox(scene, 'penthouse-plinth', [18.45, .18, 16.35], [0, -.21, 0], 0xd7c7b8, { roughness: .5 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(18, .16, 16), material(0x9b7a6b));
  floor.position.set(0, -.05, 0);
  floor.receiveShadow = true;
  scene.add(floor);

  // Warm room flooring and rugs make each space distinct without separating the house.
  addBox(scene, 'living-room-floor', [7.35, .025, 7.45], [-5.1, .045, 3.95], 0xa98577, { castShadow: false });
  addBox(scene, 'kitchen-floor', [7.35, .025, 7.45], [5.1, .045, 3.95], 0xb39a83, { castShadow: false });
  addBox(scene, 'bedroom-one-floor', [7.35, .025, 7.45], [-5.1, .045, -3.95], 0x927b75, { castShadow: false });
  addBox(scene, 'bedroom-two-floor', [7.35, .025, 7.45], [5.1, .045, -3.95], 0x8c8791, { castShadow: false });
  addBox(scene, 'bathroom-floor', [2.45, .035, 6.35], [7.55, .065, -4.55], 0x9db0b0, { castShadow: false });

  const wallHeight = 2.65;
  const wallY = wallHeight / 2;
  const wall = (name, size, position, color) => addHouseWall(scene, colliders, name, size, position, color);
  const vertical = (name, x, z1, z2, color = 0x735b56) => {
    const length = Math.abs(z2 - z1);
    wall(name, [.18, wallHeight, length], [x, wallY, (z1 + z2) / 2], color);
  };
  const horizontal = (name, x1, x2, z, color = 0x735b56) => {
    const length = Math.abs(x2 - x1);
    wall(name, [length, wallHeight, .18], [(x1 + x2) / 2, wallY, z], color);
  };

  // Outer shell. The front entrance and the interior door gaps stay open for walking.
  horizontal('back-exterior-wall', -9, 9, -8, 0x664f4c);
  vertical('left-exterior-wall', -9, -8, 8, 0x664f4c);
  vertical('right-exterior-wall-back', 9, -8, -1.2, 0x664f4c);
  vertical('right-exterior-wall-front', 9, 1.2, 8, 0x664f4c);
  addBox(scene, 'terrace-door-left', [.13, 2.3, .16], [9.0, 1.15, -1.15], 0x4b4146);
  addBox(scene, 'terrace-door-right', [.13, 2.3, .16], [9.0, 1.15, 1.15], 0x4b4146);
  addBox(scene, 'terrace-door-header', [.14, .14, 2.35], [9.0, 2.3, 0], 0x4b4146);
  horizontal('front-left-wall', -9, -1.25, 8, 0x664f4c);
  horizontal('front-right-wall', 1.25, 9, 8, 0x664f4c);
  // A central hallway connects the living room, kitchen and both bedrooms.
  [-1.25, 1.25].forEach((x, side) => {
    const sideName = side === 0 ? 'west' : 'east';
    // Open the west side into one large lounge/garden in these two room layouts.
    if (side === 0 && ['music', 'garden', 'cinema'].includes(activeRoomType)) return;
    // Game Night gets an open arcade/game wing.
    if (side === 1 && activeRoomType === 'game') return;
    vertical(`${sideName}-hall-wall-front`, x, 4.9, 7.9);
    if (side === 1) {
      vertical(`${sideName}-hall-wall-middle-a`, x, -4.05, -1.2);
      vertical(`${sideName}-hall-wall-middle-b`, x, 1.2, 3.05);
    } else {
      vertical(`${sideName}-hall-wall-middle`, x, -4.05, 3.05);
    }
    vertical(`${sideName}-hall-wall-back`, x, -7.9, -5.05);
  });
  // Each selected room has a different walkable floor plan, not only a color filter.
  // Music Lounge and Garden Villa open the west wing into a larger shared space.
  if (!['music', 'garden'].includes(activeRoomType)) {
    horizontal('west-room-divider-a', -8.9, -6.05, 0, 0x806760);
    horizontal('west-room-divider-b', -4.05, -1.25, 0, 0x806760);
  }
  // Game Night opens the east wing into a dedicated games room.
  if (activeRoomType !== 'game') {
    horizontal('east-room-divider-a', 1.25, 4.05, 0, 0x806760);
    horizontal('east-room-divider-b', 6.05, 8.9, 0, 0x806760);
  }
  // Compact ensuite bathroom in the back-east corner, entered from bedroom two.
  vertical('bathroom-divider-front', 6.25, -7.9, -4.55, 0x718987);
  vertical('bathroom-divider-back', 6.25, -2.75, -1.35, 0x718987);
  horizontal('bathroom-end-wall', 6.25, 8.9, -1.35, 0x718987);

  // Door frames and warm trim around the central entrance.
  addBox(scene, 'entry-left-post', [.18, 2.45, .2], [-1.18, 1.23, 7.8], 0x4d3938);
  addBox(scene, 'entry-right-post', [.18, 2.45, .2], [1.18, 1.23, 7.8], 0x4d3938);
  addBox(scene, 'entry-header', [2.55, .18, .2], [0, 2.48, 7.8], 0x4d3938);
  addBox(scene, 'entry-mat', [2.1, .045, 1.0], [0, .07, 7.15], 0x80635a, { castShadow: false });

  // Window panes, frames and ledges on the rear wall.
  [-5.4, 5.0].forEach((x) => {
    addBox(scene, 'rear-window-frame', [1.8, 1.25, .12], [x, 1.85, -7.87], 0x493638);
    addBox(scene, 'rear-window-glass', [1.6, 1.06, .035], [x, 1.85, -7.79], 0xaebdc0, { material: new THREE.MeshStandardMaterial({ color: 0xaec6c8, emissive: 0x506b75, emissiveIntensity: .28, roughness: .3 }) });
    addBox(scene, 'rear-window-cross', [.045, 1.1, .04], [x, 1.85, -7.75], 0x5a4141);
    addBox(scene, 'rear-window-sill', [1.95, .1, .28], [x, 1.16, -7.66], 0x594242);
  });

  // ---------------- Living room ----------------
  addRoomSign(scene, 'Living room', [-5.0, 2.25, 1.45], '#f0c7b7');
  addBox(scene, 'living-rug', [4.5, .045, 3.5], [-5.15, .09, 4.45], 0x765c60, { castShadow: false });
  addBox(scene, 'living-rug-inner', [4.22, .025, 3.22], [-5.15, .125, 4.45], 0xb58a80, { castShadow: false });
  // Sofa faces the TV across the rug.
  addBox(scene, 'sofa-base', [2.9, .48, .95], [-5.2, .43, 6.15], 0x986c70);
  addBox(scene, 'sofa-back', [2.9, .92, .28], [-5.2, 1.0, 6.53], 0xa77c7d);
  addBox(scene, 'sofa-arm-left', [.3, .68, .95], [-6.65, .72, 6.15], 0x93676b);
  addBox(scene, 'sofa-arm-right', [.3, .68, .95], [-3.75, .72, 6.15], 0x93676b);
  [-6.0, -5.2, -4.4].forEach((x, i) => addBox(scene, 'sofa-cushion', [.72, .17, .68], [x, .72, 6.06], i === 1 ? 0xd3a39a : 0xb68b85));
  addBox(scene, 'sofa-pillow-one', [.48, .48, .18], [-6.05, 1.17, 6.32], 0xe3c5ad, { rotation: [0, 0, -.18] });
  addBox(scene, 'sofa-pillow-two', [.48, .48, .18], [-4.35, 1.17, 6.32], 0x89998b, { rotation: [0, 0, .15] });
  addBox(scene, 'tv-console', [3.25, .55, .62], [-5.15, .38, .75], 0x4d3938);
  addBox(scene, 'tv-console-front', [2.95, .25, .06], [-5.15, .36, 1.08], 0x84615a);
  addBox(scene, 'living-tv-body', [2.45, 1.48, .18], [-5.15, 1.62, .67], 0x15171d, { metalness: .2, roughness: .3 });
  addBox(scene, 'living-tv-screen', [2.28, 1.31, .025], [-5.15, 1.63, .565], 0x1b222c, { material: new THREE.MeshStandardMaterial({ color: 0x1b222c, emissive: 0x344552, emissiveIntensity: .2, roughness: .2, metalness: .08 }) });
  addBox(scene, 'living-tv-stand', [.8, .12, .38], [-5.15, .89, .66], 0x26252a);
  addBox(scene, 'coffee-table', [1.85, .13, 1.05], [-5.0, .69, 3.95], 0x8c6553);
  [[-5.75,3.55],[-4.25,3.55],[-5.75,4.35],[-4.25,4.35]].forEach(([x,z]) => addBox(scene, 'coffee-table-leg', [.09,.63,.09], [x,.36,z], 0x543e39));
  addCylinder(scene, 'living-vase', .13, .17, .31, [-5.3, .91, 3.94], 0xb1a39b);
  addSphere(scene, 'living-flower', .15, [-5.3, 1.12, 3.94], 0xd7a0a2, [1, .7, .35]);
  addBox(scene, 'living-bookcase', [.48, 2.0, 1.9], [-8.35, 1.0, 3.35], 0x493a3a);
  [0.45, 1.05, 1.65].forEach((y) => addBox(scene, 'living-bookcase-shelf', [.54, .075, 1.82], [-8.05, y, 3.35], 0xa47d6b));
  const bookColors = [0x8f6669, 0x788b80, 0xd1ab8b, 0x707f99, 0xb88a7d];
  for (let row = 0; row < 3; row++) for (let j = 0; j < 6; j++) {
    addBox(scene, 'living-book', [.09 + (j % 2) * .025, .31 + (j % 3) * .04, .17], [-8.34 + j * .095, .68 + row * .57, 2.62], bookColors[(j + row) % bookColors.length]);
  }
  addCylinder(scene, 'living-plant-pot', .28, .34, .4, [-8.0, .25, 6.85], 0x8d5d50, 18);
  for (let i = 0; i < 6; i++) addSphere(scene, 'living-plant-leaf', .23, [-8 + Math.sin(i * 1.1) * .25, .68 + (i % 3) * .15, 6.85 + Math.cos(i * 1.1) * .2], 0x5f8a6c, [.45, 1.25, .4]);

  // ---------------- Kitchen and dining nook ----------------
  addRoomSign(scene, 'Kitchen & dining', [5.0, 2.25, 1.55], '#e9d2a9');
  addBox(scene, 'kitchen-run-base', [1.0, .78, 5.9], [8.25, .43, 4.45], 0x65504b);
  addBox(scene, 'kitchen-countertop', [1.18, .14, 6.05], [8.18, .9, 4.45], 0xd0bda6);
  addBox(scene, 'kitchen-upper-cabinets', [.62, .82, 5.65], [8.35, 1.95, 4.45], 0x81645a);
  addBox(scene, 'kitchen-island-base', [2.35, .83, 1.15], [4.75, .48, 4.3], 0x776057);
  addBox(scene, 'kitchen-island-top', [2.55, .13, 1.3], [4.75, .97, 4.3], 0xd5c1aa);
  addBox(scene, 'kitchen-fridge', [.98, 2.05, 1.08], [2.15, 1.04, 2.15], 0xb6bdc0, { metalness: .28, roughness: .3 });
  addBox(scene, 'fridge-freezer-line', [.99, .035, 1.1], [2.15, 1.28, 2.15], 0x77858b);
  addBox(scene, 'fridge-handle', [.045, .5, .045], [2.55, 1.22, 2.45], 0x657176, { metalness: .7 });
  addBox(scene, 'stove-top', [.95, .08, 1.0], [8.05, 1.02, 2.55], 0x282a2d, { metalness: .2 });
  [[7.78,2.28],[8.28,2.28],[7.78,2.75],[8.28,2.75]].forEach(([x,z]) => addCylinder(scene, 'stove-burner', .13, .13, .035, [x,1.08,z], 0x151619, 18));
  addBox(scene, 'kitchen-sink', [.75, .055, 1.05], [8.0, 1.0, 5.55], 0x77878a, { metalness: .48, roughness: .24 });
  addCylinder(scene, 'kitchen-faucet', .045, .045, .46, [8.0, 1.24, 5.45], 0x9ca9ac, 12);
  addBox(scene, 'kitchen-dining-table', [2.65, .14, 1.45], [4.8, .83, 6.55], 0x8b6652);
  [[3.75,6.0],[5.85,6.0],[3.75,7.05],[5.85,7.05]].forEach(([x,z]) => {
    addBox(scene, 'dining-chair-seat', [.62,.12,.62], [x,.49,z], 0x9d7770);
    addBox(scene, 'dining-chair-back', [.62,.72,.12], [x,.87,z + (z < 6.5 ? -.24 : .24)], 0x9d7770);
  });
  addBox(scene, 'kitchen-pendant-wire', [.035, .75, .035], [4.8, 2.35, 4.3], 0x594847);
  const pendant = new THREE.Mesh(new THREE.ConeGeometry(.34, .42, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xd8b99c, side: THREE.DoubleSide }));
  pendant.position.set(4.8, 1.95, 4.3); scene.add(pendant);
  const kitchenLight = new THREE.PointLight(0xffd7a2, 1.0, 7); kitchenLight.position.set(4.8, 2.1, 4.3); scene.add(kitchenLight);

  // ---------------- Bedroom one ----------------
  addRoomSign(scene, 'Bedroom one', [-5.0, 2.25, -2.0], '#e8c7c2');
  addBox(scene, 'bed-one-rug', [4.0, .04, 4.25], [-5.1, .09, -5.1], 0x79666c, { castShadow: false });
  addBox(scene, 'bed-one-frame', [2.8, .48, 3.55], [-5.15, .35, -5.2], 0x644b4c);
  addBox(scene, 'bed-one-mattress', [2.67, .3, 3.38], [-5.15, .68, -5.18], 0xe7d9d0);
  addBox(scene, 'bed-one-duvet', [2.69, .18, 2.45], [-5.15, .87, -4.73], 0xc58b91);
  addBox(scene, 'bed-one-headboard', [2.94, 1.23, .18], [-5.15, 1.0, -6.95], 0x604647);
  [-5.75, -4.55].forEach((x) => addBox(scene, 'bed-one-pillow', [.92,.2,.56], [x,.96,-6.12], 0xf3e9df));
  addBox(scene, 'bed-one-nightstand-left', [.68,.78,.68], [-7.05,.4,-6.15], 0x7c5b50);
  addBox(scene, 'bed-one-nightstand-right', [.68,.78,.68], [-3.25,.4,-6.15], 0x7c5b50);
  addCylinder(scene, 'bed-one-lamp-left-base', .17, .17, .1, [-7.05,.84,-6.15], 0xb28d77);
  addCylinder(scene, 'bed-one-lamp-left-stem', .035, .035, .35, [-7.05,1.05,-6.15], 0x554446);
  addBox(scene, 'bed-one-wardrobe', [.72,2.12,2.1], [-8.15,1.06,-3.15], 0x74594f);
  addBox(scene, 'bed-one-wardrobe-door', [.04,1.92,1.0], [-7.76,1.08,-3.15], 0x9a766a);

  // ---------------- Bedroom two ----------------
  addRoomSign(scene, 'Bedroom two', [4.55, 2.25, -2.0], '#c8c5e2');
  addBox(scene, 'bed-two-rug', [3.95, .04, 4.2], [4.25, .09, -5.1], 0x696982, { castShadow: false });
  addBox(scene, 'bed-two-frame', [2.55, .48, 3.4], [4.05, .35, -5.2], 0x4f4c62);
  addBox(scene, 'bed-two-mattress', [2.43, .3, 3.24], [4.05, .68, -5.18], 0xe0dce8);
  addBox(scene, 'bed-two-duvet', [2.45, .18, 2.35], [4.05, .87, -4.72], 0x8580a7);
  addBox(scene, 'bed-two-headboard', [2.72, 1.18, .18], [4.05, 1.0, -6.92], 0x514e65);
  [3.55,4.55].forEach((x) => addBox(scene, 'bed-two-pillow', [.82,.2,.52], [x,.96,-6.1], 0xf2e9e6));
  addBox(scene, 'bed-two-nightstand', [.65,.72,.65], [2.45,.38,-6.0], 0x71627a);
  addBox(scene, 'bed-two-wardrobe', [.55,2.0,1.8], [2.0,1.0,-2.4], 0x62566c);
  addBox(scene, 'bed-two-wardrobe-door', [.04,1.82,.8], [2.31,1.02,-2.4], 0x92859c);

  // ---------------- Bathroom ----------------
  addRoomSign(scene, 'Bathroom', [7.55, 2.22, -2.0], '#d2e5e1');
  addBox(scene, 'bath-tub', [1.55, .52, 2.3], [7.65, .36, -6.45], 0xe4e8e6);
  addBox(scene, 'bath-tub-inner', [1.26, .12, 1.98], [7.65, .64, -6.45], 0x9dbfc2);
  addBox(scene, 'bath-shower-glass', [.045, 1.9, 1.9], [8.42, 1.25, -6.45], 0x9ec1c4, { material: new THREE.MeshPhysicalMaterial({ color: 0xafd1d2, transparent: true, opacity: .34, roughness: .08, transmission: .3 }) });
  addBox(scene, 'bath-vanity', [.74, .88, 1.2], [6.75,.46,-2.25], 0x78908c);
  addBox(scene, 'bath-sink', [.82,.12,.7], [6.75,.96,-2.25], 0xf0ece6);
  addCylinder(scene, 'bath-faucet', .035,.035,.33,[6.75,1.16,-2.05],0x9ca9ac,12);
  addCylinder(scene, 'toilet-base', .34,.34,.45,[8.0,.25,-3.9],0xe5e6e2,20);
  addSphere(scene, 'toilet-bowl', .39,[8.0,.5,-3.9],0xf1f0eb,[1,.42,1.15]);
  addBox(scene, 'toilet-tank', [.72,.8,.32], [8.0,.62,-4.3], 0xe5e6e2);

  // Hallway runner, ceiling lights and plants tie the spaces together.
  addBox(scene, 'hall-runner', [1.72, .035, 13.8], [0, .08, 0], 0x80666a, { castShadow: false });
  [-6.4,-2.0,2.2,6.4].forEach((z) => {
    const light = new THREE.PointLight(0xffd8b8, .34, 5);
    light.position.set(0, 2.35, z);
    scene.add(light);
    addBox(scene, 'hall-ceiling-light', [.55,.06,.75], [0,2.48,z], 0xe1c4a5, { castShadow: false });
  });
  addCylinder(scene, 'kitchen-plant-pot', .25, .31, .35, [2.1,.2,7.15], 0x8d5d50, 18);
  for (let i = 0; i < 5; i++) addSphere(scene, 'kitchen-plant-leaf', .2, [2.1 + Math.sin(i * 1.2) * .22,.58 + (i % 2) * .15,7.15 + Math.cos(i * 1.2) * .18], 0x668c6e, [.45,1.3,.4]);

  // Large furniture also blocks walking, so characters naturally use the clear paths.
  colliders.push(
    ...(activeRoomType === 'penthouse' || activeRoomType === 'music' || activeRoomType === 'garden' || activeRoomType === 'cinema' ? [] : [
      { minX: -6.75, maxX: -3.65, minZ: 5.62, maxZ: 6.72 }, // living sofa
      { minX: -6.85, maxX: -3.45, minZ: .30, maxZ: 1.12 }, // TV console
      { minX: -6.0, maxX: -4.0, minZ: 3.38, maxZ: 4.52 }, // coffee table
      { minX: -8.65, maxX: -8.0, minZ: 2.35, maxZ: 4.35 } // bookcase
    ]),
    { minX: 1.62, maxX: 2.7, minZ: 1.55, maxZ: 2.75 }, // fridge
    { minX: 3.48, maxX: 6.02, minZ: 3.62, maxZ: 4.98 }, // kitchen island
    { minX: 3.42, maxX: 6.18, minZ: 5.78, maxZ: 7.34 }, // dining table
    { minX: -6.62, maxX: -3.68, minZ: -6.98, maxZ: -3.38 }, // bedroom one bed
    { minX: -8.62, maxX: -7.68, minZ: -4.25, maxZ: -2.05 }, // bedroom one wardrobe
    ...(activeRoomType === 'game' ? [] : [
      { minX: 2.72, maxX: 5.42, minZ: -6.95, maxZ: -3.35 }, // bedroom two bed
      { minX: 1.68, maxX: 2.35, minZ: -3.35, maxZ: -1.45 } // bedroom two wardrobe
    ]),
    { minX: 6.82, maxX: 8.5, minZ: -7.72, maxZ: -5.15 }, // bathtub
    { minX: 6.25, maxX: 7.25, minZ: -2.95, maxZ: -1.5 }, // bathroom vanity
    { minX: 7.55, maxX: 8.45, minZ: -4.5, maxZ: -3.35 } // toilet
  );

  // The Penthouse Mini Mart is an actual walk-in shop inside the living-room wing.
  if (activeRoomType === 'penthouse') {
    const martGlass = new THREE.MeshPhysicalMaterial({ color: 0xa8d9d8, transparent: true, opacity: .34, roughness: .12, metalness: .12, transmission: .2 });
    ['sofa-base','sofa-back','sofa-arm-left','sofa-arm-right','sofa-cushion','sofa-pillow','tv-console','living-tv-body','living-tv-screen','living-tv-stand','coffee-table','coffee-table-leg','living-vase','living-flower','living-bookcase','living-bookcase-shelf','living-book'].forEach((prefix) => {
      scene.children.filter((o) => o.name.startsWith(prefix)).forEach((o) => { o.visible = false; });
    });
    addBox(scene, 'penthouse-mart-floor', [6.0, .08, 5.9], [-5.2, .08, 4.15], 0xc6b9a7, { roughness: .72 });
    addBox(scene, 'penthouse-mart-back-wall', [6.1, 2.8, .18], [-5.2, 1.48, 7.12], 0x6b5550);
    addBox(scene, 'penthouse-mart-left-wall', [.18, 2.8, 5.9], [-8.25, 1.48, 4.15], 0x6b5550);
    addBox(scene, 'penthouse-mart-right-wall', [.18, 2.8, 5.9], [-2.15, 1.48, 4.15], 0x6b5550);
    addBox(scene, 'penthouse-mart-front-left', [2.1, 2.8, .18], [-7.2, 1.48, 1.2], 0x6b5550);
    addBox(scene, 'penthouse-mart-front-right', [2.1, 2.8, .18], [-3.2, 1.48, 1.2], 0x6b5550);
    addBox(scene, 'penthouse-mart-glass-left', [.06, 1.85, .95], [-6.12, 1.62, 1.2], 0xa8d9d8, { material: martGlass });
    addBox(scene, 'penthouse-mart-glass-right', [.06, 1.85, .95], [-4.28, 1.62, 1.2], 0xa8d9d8, { material: martGlass });
    addBox(scene, 'penthouse-mart-sign-board', [4.0, .58, .12], [-5.2, 3.0, 1.15], 0x344d4c);
    addRoomSign(scene, 'PENTHOUSE MINI MART', [-5.2, 3.05, 1.05], '#d8f1cb');
    [-7.25, -3.15].forEach((x, side) => {
      addBox(scene, 'penthouse-mart-shelf', [.62, 1.65, 3.7], [x, .88, 4.15], 0x806a5b);
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
        addBox(scene, 'penthouse-mart-grocery', [.42, .34, .38], [x, .48 + row * .48, 2.8 + col * 1.05], [0xc98b66, 0x8da98b, 0xd6c08b, 0x9aabc2, 0xb88c98][(row + col + side) % 5]);
      }
    });
    addBox(scene, 'penthouse-mart-counter', [1.7, .95, .58], [-5.2, .48, 6.45], 0x715347);
    addBox(scene, 'penthouse-mart-counter-top', [1.85, .12, .68], [-5.2, 1.0, 6.45], 0xd5c0a5);
    addBox(scene, 'penthouse-mart-checkout-screen', [.28, .24, .12], [-5.2, 1.2, 6.25], 0x26353a);
    colliders.push(
      { minX: -8.4, maxX: -8.1, minZ: 1.1, maxZ: 7.2 },
      { minX: -2.3, maxX: -2.0, minZ: 1.1, maxZ: 7.2 },
      { minX: -8.25, maxX: -6.15, minZ: 1.05, maxZ: 1.35 },
      { minX: -4.25, maxX: -2.15, minZ: 1.05, maxZ: 1.35 },
      { minX: -7.55, maxX: -6.95, minZ: 2.2, maxZ: 6.1 },
      { minX: -3.45, maxX: -2.85, minZ: 2.2, maxZ: 6.1 },
      { minX: -6.1, maxX: -4.3, minZ: 6.15, maxZ: 6.8 }
    );
  }

  // ---------------- Luxury rooftop terrace & private garage ----------------
  addRoomSign(scene, 'Rooftop terrace', [14.9, 2.55, -6.95], '#d7e8ec');
  addRoomSign(scene, 'Private garage', [15.3, 2.55, 1.0], '#f3c7a9');
  addBox(scene, 'terrace-inlay', [12.3, .035, 16.1], [15.45, .035, 0], 0x8d9497, { castShadow: false });
  // Parking bays and polished concrete guide the two cars.
  [-.0, 3.0, 6.0, 9.0].forEach((offset) => addBox(scene, 'parking-line', [.045, .025, 3.15], [10.2 + offset, .07, 3.6], 0xe4d9c9, { castShadow: false }));
  addBox(scene, 'parking-end-line', [9.0, .025, .05], [14.7, .07, 5.2], 0xe4d9c9, { castShadow: false });
  // Glass safety rails keep the open rooftop readable while framing the skyline.
  const railMat = new THREE.MeshPhysicalMaterial({ color: 0xb8d7df, transparent: true, opacity: .34, roughness: .12, metalness: .14 });
  const rail = (size, pos) => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(...size), railMat);
    r.position.set(...pos); r.castShadow = false; r.receiveShadow = true; scene.add(r);
  };
  rail([.12, 1.1, 17.2], [21.65, .62, 0]);
  rail([12.4, 1.1, .12], [15.45, .62, -8.35]);
  rail([12.4, 1.1, .12], [15.45, .62, 8.35]);
  [-7.8, -4.0, -.2, 3.6, 7.4].forEach((z) => addBox(scene, 'glass-rail-post', [.12, 1.25, .12], [21.65, .62, z], 0x9dabb4));
  // Infinity plunge pool and sun loungers.
  addBox(scene, 'terrace-pool-frame', [3.7, .35, 2.5], [11.45, .2, -5.65], 0xb5b5b0);
  addBox(scene, 'terrace-pool-water', [3.42, .1, 2.22], [11.45, .41, -5.65], 0x6ba9b5, { material: new THREE.MeshPhysicalMaterial({ color: 0x72b7c7, roughness: .12, metalness: .12, transparent: true, opacity: .86 }) });
  [-.8, .8].forEach((dx) => {
    addBox(scene, 'sun-lounger-base', [.85, .14, 2.05], [16.5 + dx, .25, 6.2], 0xe7d6c4);
    addBox(scene, 'sun-lounger-cushion', [.8, .09, 1.85], [16.5 + dx, .36, 6.2], 0xb7c1c2);
  });
  addBox(scene, 'terrace-sofa-base', [2.5, .35, .82], [12.05, .25, 6.65], 0x8b6865);
  addBox(scene, 'terrace-sofa-back', [2.5, .72, .2], [12.05, .77, 7.0], 0xa97c78);
  addCylinder(scene, 'terrace-table', .56, .56, .12, [14.55, .6, 6.55], 0xd8c3ad, 32);
  addCylinder(scene, 'terrace-table-pedestal', .11, .16, .52, [14.55, .31, 6.55], 0x625a5a, 18);
  // Tall planters, palms and warm architectural lights.
  [10.0, 20.3].forEach((x) => {
    addBox(scene, 'terrace-planter', [1.05, .55, 1.15], [x, .25, -7.15], 0x555f56);
    addCylinder(scene, 'terrace-plant-stem', .06, .09, 1.2, [x, .95, -7.15], 0x6b795b);
    for (let i = 0; i < 6; i++) addSphere(scene, 'terrace-palm-leaf', .35, [x + Math.sin(i * 1.05) * .48, 1.55 + (i % 2) * .12, -7.15 + Math.cos(i * 1.05) * .42], 0x5e806b, [.48, .3, 1.25]);
  });
  [-5.5, 0, 5.5].forEach((z) => {
    const lamp = new THREE.PointLight(0xffd5a5, .42, 5);
    lamp.position.set(20.8, 2.2, z); scene.add(lamp);
    addBox(scene, 'terrace-wall-sconce', [.18, .38, .18], [21.35, 2.1, z], 0xd5b99a);
  });

  // Distant high-rise silhouettes with glowing windows establish a real rooftop skyline.
  const skylinePositions = [
    [-18, -3, -20, 6, 19, 6], [-11, 2, -23, 7, 25, 7], [-2, -1, -24, 8, 20, 7],
    [8, 1, -26, 7, 25, 7], [18, -2, -22, 8, 19, 8], [60, 3, -16, 7, 28, 7],
    [-20, 1, 6, 6, 23, 6], [59, -2, 7, 8, 22, 7]
  ];
  skylinePositions.forEach(([x, y, z, w, h, d], index) => {
    addBox(scene, `city-tower-${index}`, [w, h, d], [x, y + h / 2 - 1.7, z], index % 2 ? 0x536575 : 0x46596a, { roughness: .72 });
    const windowMat = new THREE.MeshStandardMaterial({ color: 0xeacb91, emissive: 0xd7a76a, emissiveIntensity: .45, roughness: .4 });
    for (let row = 0; row < Math.min(7, Math.floor(h / 3)); row++) {
      for (let col = 0; col < Math.min(4, Math.floor(w / 1.5)); col++) {
        if ((row + col + index) % 3 !== 0) continue;
        const win = new THREE.Mesh(new THREE.BoxGeometry(.42, .56, .035), windowMat);
        win.position.set(x - w / 2 + .9 + col * 1.25, y + row * 2.3 + .8, z + d / 2 + .025);
        scene.add(win);
      }
    }
  });

  // Room-specific architecture and furniture: each choice changes the actual playable layout.
  if (activeRoomType === 'music') {
    ['sofa-base','sofa-back','sofa-arm-left','sofa-arm-right','tv-console','living-tv-body','living-tv-screen','coffee-table','living-bookcase'].forEach((prefix) => {
      scene.children.filter((o) => o.name.startsWith(prefix)).forEach((o) => { o.visible = false; });
    });
    addBox(scene, 'music-lounge-dance-floor', [6.8, .12, 6.2], [-5.15, .16, 4.2], 0x26233b);
    for (let i = 0; i < 8; i++) addBox(scene, 'music-lounge-floor-tile', [.72, .035, .72], [-8.0 + (i % 4) * 1.85, .24, 2.1 + Math.floor(i / 4) * 3.7], i % 2 ? 0x7854a5 : 0x3e8e9b);
    addBox(scene, 'music-lounge-stage', [3.2, .48, 1.35], [-5.1, .34, 7.0], 0x30273d);
    addBox(scene, 'music-lounge-speaker-left', [.65, 1.65, .55], [-7.65, .88, 6.9], 0x171a22);
    addBox(scene, 'music-lounge-speaker-right', [.65, 1.65, .55], [-2.55, .88, 6.9], 0x171a22);
    addRoomSign(scene, 'MUSIC LOUNGE · DANCE FLOOR', [-5.1, 2.55, 1.4], '#e5c7ff');
  } else if (activeRoomType === 'cinema') {
    ['sofa-base','sofa-back','sofa-arm-left','sofa-arm-right','tv-console','living-tv-body','living-tv-screen','coffee-table'].forEach((prefix) => {
      scene.children.filter((o) => o.name.startsWith(prefix)).forEach((o) => { o.visible = false; });
    });
    addBox(scene, 'cinema-feature-wall', [7.0, 3.1, .35], [-5.15, 1.55, .55], 0x171927);
    addBox(scene, 'cinema-big-screen', [5.5, 2.45, .06], [-5.15, 1.8, .34], 0x101c2b, { material: new THREE.MeshStandardMaterial({ color: 0x182b40, emissive: 0x17395b, emissiveIntensity: .6, roughness: .18 }) });
    for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
      const x = -7.25 + col * 2.1, z = 3.0 + row * 1.8;
      addBox(scene, 'cinema-seat-base', [1.45, .55, .95], [x, .38, z], 0x693b4d);
      addBox(scene, 'cinema-seat-back', [1.45, .95, .22], [x, .9, z + .38], 0x87495b);
      colliders.push({ minX: x - .74, maxX: x + .74, minZ: z - .5, maxZ: z + .55 });
    }
    addRoomSign(scene, 'PRIVATE CINEMA', [-5.15, 2.55, 1.4], '#f0d4a5');
  } else if (activeRoomType === 'garden') {
    ['sofa-base','sofa-back','sofa-arm-left','sofa-arm-right','tv-console','living-tv-body','living-tv-screen','coffee-table','living-bookcase'].forEach((prefix) => {
      scene.children.filter((o) => o.name.startsWith(prefix)).forEach((o) => { o.visible = false; });
    });
    addBox(scene, 'garden-villa-path', [1.45, .06, 7.1], [-5.15, .17, 4.15], 0xc4b998);
    for (let i = 0; i < 4; i++) {
      const x = -8.1 + i * 2.0;
      addBox(scene, 'garden-raised-planter', [1.45, .55, 1.5], [x, .36, 2.25], 0x69584a);
      addBox(scene, 'garden-planter-soil', [1.3, .12, 1.35], [x, .69, 2.25], 0x4c3e32);
      for (let leaf = 0; leaf < 4; leaf++) addSphere(scene, 'garden-villa-shrub', .35, [x + (leaf % 2) * .38 - .18, 1.0 + (leaf % 2) * .12, 2.0 + Math.floor(leaf / 2) * .45], leaf % 2 ? 0x67936b : 0x82a979, [.8, 1.15, .8]);
    }
    addBox(scene, 'garden-pergola-roof', [6.9, .18, 1.4], [-5.15, 2.75, 6.7], 0x6b5d4c);
    [-8.3,-2.0].forEach((x) => addBox(scene, 'garden-pergola-post', [.16,2.7,.16], [x,1.35,6.7], 0x735f4b));
    addRoomSign(scene, 'GARDEN VILLA · ATRIUM', [-5.15, 2.5, 1.4], '#d8f1cb');
  } else if (activeRoomType === 'game') {
    ['bed-two-frame','bed-two-mattress','bed-two-duvet','bed-two-headboard','bed-two-pillow','bed-two-nightstand','bed-two-wardrobe','bed-two-wardrobe-door'].forEach((prefix) => {
      scene.children.filter((o) => o.name.startsWith(prefix)).forEach((o) => { o.visible = false; });
    });
    addBox(scene, 'game-room-floor', [7.1, .06, 7.2], [5.1, .16, -3.95], 0x343a50);
    addBox(scene, 'game-room-pool-table', [3.2, .82, 1.8], [5.0, .48, -4.3], 0x28634e);
    addBox(scene, 'game-room-pool-table-top', [3.0, .08, 1.6], [5.0, .93, -4.3], 0x237b59);
    for (let i = 0; i < 3; i++) {
      const x = 2.15 + i * 2.65;
      addBox(scene, 'game-room-arcade-cabinet', [.9, 1.85, .75], [x, .94, -1.45], 0x292b40);
      addBox(scene, 'game-room-arcade-screen', [.68, .58, .055], [x, 1.35, -1.84], 0x64b7c7, { material: new THREE.MeshStandardMaterial({ color: 0x64b7c7, emissive: 0x327a99, emissiveIntensity: .7 }) });
      colliders.push({ minX: x - .48, maxX: x + .48, minZ: -1.95, maxZ: -.95 });
    }
    addRoomSign(scene, 'GAME ROOM · ARCADE & POOL', [5.0, 2.55, -1.0], '#d8d2ff');
  } else if (activeRoomType === 'cozy') {
    addHouseWall(scene, colliders, 'cozy-reading-nook-divider', [.16, 2.25, 2.3], [-2.25, 1.12, 5.15], 0x80655b);
    addBox(scene, 'cozy-retreat-fireplace', [2.2, 1.75, .42], [-8.0, .9, 1.0], 0x6a4b43);
    addBox(scene, 'cozy-retreat-fireplace-opening', [1.05, .95, .08], [-8.0, .88, .75], 0x171b20);
    addBox(scene, 'cozy-retreat-fire-glow', [.72, .5, .06], [-8.0, .62, .69], 0xf18a4c, { material: new THREE.MeshStandardMaterial({ color: 0xf18a4c, emissive: 0xd95d25, emissiveIntensity: 1.2 }) });
    addBox(scene, 'cozy-reading-nook-rug', [3.4, .06, 3.1], [-4.0, .17, 3.4], 0x98736d);
    addBox(scene, 'cozy-reading-chair', [1.25, .85, 1.2], [-3.9, .48, 4.1], 0x9b6e68);
    addBox(scene, 'cozy-reading-lamp', [.12, 1.9, .12], [-2.65, .98, 3.4], 0x665046);
    addRoomSign(scene, 'COZY RETREAT · FIREPLACE', [-5.0, 2.5, 1.4], '#ffdfc1');
  }

  // ---------------- Elevator stations and explorable city promenade ----------------
  function addElevatorStation(position, label) {
    const [x, y, z] = position;
    const frameMat = material(0xc7b8ad, .34, .32);
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x9bd4d1, transparent: true, opacity: .34, roughness: .1, metalness: .18, transmission: .28 });
    addBox(scene, `${label}-elevator-base`, [2.5, .14, 2.45], [x, y + .07, z], 0x625d63);
    addBox(scene, `${label}-elevator-left-post`, [.16, 2.7, .16], [x - 1.06, y + 1.42, z], 0xc4b8ad, { material: frameMat });
    addBox(scene, `${label}-elevator-right-post`, [.16, 2.7, .16], [x + 1.06, y + 1.42, z], 0xc4b8ad, { material: frameMat });
    addBox(scene, `${label}-elevator-header`, [2.28, .16, .16], [x, y + 2.76, z], 0xc4b8ad, { material: frameMat });
    addBox(scene, `${label}-elevator-glass-left`, [.78, 2.28, .045], [x - .4, y + 1.28, z + .04], 0x9bd4d1, { material: glassMat });
    addBox(scene, `${label}-elevator-glass-right`, [.78, 2.28, .045], [x + .4, y + 1.28, z + .04], 0x9bd4d1, { material: glassMat });
    addBox(scene, `${label}-elevator-call-panel`, [.16, .42, .08], [x + 1.27, y + 1.22, z + .42], 0x2a3037);
    addSphere(scene, `${label}-elevator-call-light`, .065, [x + 1.27, y + 1.38, z + .37], 0x8fe0cf);
    const glow = new THREE.PointLight(0x86d3c5, .48, 4);
    glow.position.set(x, y + 2.0, z + .7);
    scene.add(glow);
    addRoomSign(scene, label === 'penthouse' ? 'Elevator · City' : 'Elevator · Home', [x, y + 3.15, z - 1.05], '#b9e1da');
  }
  addElevatorStation([19.2, 0, -6.0], 'penthouse');



  // A larger, walkable city district with room for a second block of streets.
  addBox(scene, 'city-district-foundation', [67.5, .18, 53.5], [60.25, -.18, 0], 0x46515d, { roughness: .9, castShadow: false });
  addBox(scene, 'city-promenade-road', [63.5, .035, 6.2], [59.0, -.075, 0], 0x252d37, { roughness: .95, castShadow: false });
  addBox(scene, 'city-sidewalk-north', [61.0, .06, 3.2], [58.0, -.045, -5.0], 0x9c9a94, { castShadow: false });
  addBox(scene, 'city-sidewalk-south', [61.0, .06, 3.2], [58.0, -.045, 5.0], 0x9c9a94, { castShadow: false });
  [-1.7, 1.7].forEach((z) => {
    addBox(scene, 'city-road-line', [61.5, .025, .055], [58.5, -.035, z], 0xe6d4a9, { castShadow: false });
  });
  // Mid-rise facades with lit windows, awnings and street-level storefronts.
  const cityBuildings = [
    { x: 33.0, z: -13.0, w: 4.7, d: 5.3, h: 8.0, c: 0x657889 },
    { x: 40.0, z: -13.0, w: 5.2, d: 5.3, h: 11.0, c: 0x766f7e },
    { x: 47.1, z: -13.0, w: 5.0, d: 5.3, h: 9.0, c: 0x6b7d7a },
    { x: 35.5, z: 13.0, w: 5.4, d: 5.1, h: 10.0, c: 0x776c71 },
    { x: 43.0, z: 13.0, w: 5.2, d: 5.1, h: 12.5, c: 0x657587 },
    { x: 50.3, z: 13.0, w: 4.3, d: 5.1, h: 8.3, c: 0x82766d }
  ];
  cityBuildings.forEach((b, index) => {
    addBox(scene, `city-building-${index}`, [b.w, b.h, b.d], [b.x, b.h / 2 - .12, b.z], b.c, { roughness: .72 });
    const frontZ = b.z < 0 ? b.z + b.d / 2 + .035 : b.z - b.d / 2 - .035;
    const windowMaterial = new THREE.MeshStandardMaterial({ color: 0xf4dcae, emissive: 0xb88752, emissiveIntensity: .5, roughness: .35 });
    for (let row = 0; row < Math.floor((b.h - 2) / 1.7); row++) {
      for (let col = 0; col < Math.floor((b.w - .8) / 1.0); col++) {
        if ((row + col + index) % 4 === 0) continue;
        addBox(scene, `city-window-${index}-${row}-${col}`, [.48, .68, .04], [b.x - b.w / 2 + .62 + col * 1.0, 1.15 + row * 1.7, frontZ], 0xf0d4a7, { material: windowMaterial, castShadow: false });
      }
    }
    addBox(scene, `city-storefront-${index}`, [b.w * .62, 1.5, .1], [b.x, .83, frontZ + (b.z < 0 ? .035 : -.035)], 0x8fb2b8, { material: new THREE.MeshPhysicalMaterial({ color: 0x9ec7ca, transparent: true, opacity: .44, roughness: .15, metalness: .12 }) });
    colliders.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 });
  });
  // A plaza fountain, benches, planters and trees make the district feel lived in.
  addCylinder(scene, 'city-fountain-basin', 1.55, 1.55, .35, [41.0, .12, 0], 0x9ca8ac, 32);
  addCylinder(scene, 'city-fountain-water', 1.33, 1.33, .055, [41.0, .32, 0], 0x71b4c1, 32);
  addCylinder(scene, 'city-fountain-spout', .12, .16, .8, [41.0, .68, 0], 0xd6d1ca, 20);
  const fountainLight = new THREE.PointLight(0x86cbd8, .5, 6);
  fountainLight.position.set(41.0, 1.15, 0); scene.add(fountainLight);
  [-1, 1].forEach((side) => {
    addBox(scene, 'city-bench-seat', [2.0, .13, .48], [37.0, .45, side * 7.0], 0x78574e);
    addBox(scene, 'city-bench-back', [2.0, .72, .12], [37.0, .84, side * 7.23], 0x8a6960);
    addBox(scene, 'city-planter', [1.8, .45, 1.3], [46.3, .2, side * 7.0], 0x596a5b);
    addCylinder(scene, 'city-tree-trunk', .13, .18, 1.6, [46.3, 1.0, side * 7.0], 0x745849);
    addSphere(scene, 'city-tree-crown', .85, [46.3, 2.05, side * 7.0], 0x5f816e, [1, 1.05, .95]);
    const streetLamp = new THREE.PointLight(0xffd4a0, .55, 7);
    streetLamp.position.set(34.0, 3.0, side * 7.0); scene.add(streetLamp);
    addCylinder(scene, 'city-lamp-post', .045, .06, 3.0, [34.0, 1.5, side * 7.0], 0x343b43);
    addSphere(scene, 'city-lamp-globe', .19, [34.0, 3.05, side * 7.0], 0xf2d7a8);
  });
  // New city blocks: apartment towers, hotel, office, shopping arcade and parking.
  const outerBlocks=[{x:57,z:-20.8,w:5.6,d:6,h:15.5,c:0x536b7c,kind:'RESIDENCES'},{x:65,z:-20.8,w:6.2,d:6,h:20,c:0x6d687a,kind:'CITY HOTEL'},{x:74,z:-20.8,w:6.4,d:6,h:17,c:0x687d79,kind:'OFFICES'},{x:83,z:-20.8,w:6,d:6,h:13.5,c:0x827267,kind:'SHOPPING ARCADE'},{x:58,z:20.8,w:6,d:6,h:12.5,c:0x776a72,kind:'APARTMENTS'},{x:67,z:20.8,w:6.5,d:6,h:18.5,c:0x5f7188,kind:'BUSINESS TOWER'},{x:76,z:20.8,w:6.4,d:6,h:15,c:0x7c7c70,kind:'CITY MARKET'},{x:85,z:20.8,w:5.8,d:6,h:11.5,c:0x657b78,kind:'PARKING'}];
  outerBlocks.forEach((b,index)=>{
    addBox(scene,`outer-city-building-${index}`,[b.w,b.h,b.d],[b.x,b.h/2-.12,b.z],b.c,{roughness:.62,metalness:.12});
    const frontZ=b.z<0?b.z+b.d/2+.045:b.z-b.d/2-.045;
    const glass=new THREE.MeshStandardMaterial({color:0xb9d7df,emissive:0x526f80,emissiveIntensity:.28,metalness:.28,roughness:.22});
    const floors=Math.floor((b.h-1.8)/2),windows=Math.max(3,Math.floor((b.w-.8)/1.05));
    for(let row=0;row<floors;row++)for(let col=0;col<windows;col++){if((row*3+col+index)%5===0)continue;addBox(scene,`outer-city-window-${index}-${row}-${col}`,[.62,.92,.045],[b.x-b.w/2+.62+col*1.05,1.15+row*2,frontZ],0x9fc8d2,{material:glass,castShadow:false});}
    addBox(scene,`outer-city-entry-${index}`,[b.w*.62,1.7,.11],[b.x,.86,frontZ+(b.z<0?.05:-.05)],0x8eb4bc,{material:new THREE.MeshPhysicalMaterial({color:0x9ecbd1,transparent:true,opacity:.5,roughness:.12,metalness:.18})});
    addRoomSign(scene,b.kind,[b.x,Math.min(3.2,b.h-.8),frontZ+(b.z<0?.12:-.12)],'#e6d6b8');
    colliders.push({minX:b.x-b.w/2,maxX:b.x+b.w/2,minZ:b.z-b.d/2,maxZ:b.z+b.d/2});
  });
  for(let i=0;i<8;i++){const x=55+i*4.6,z=i%2?7.2:-7.2;addBox(scene,'outer-city-planter',[1.45,.5,1.25],[x,.2,z],0x53675a);addCylinder(scene,'outer-city-tree-trunk',.12,.16,1.55,[x,1,z],0x765743);addSphere(scene,'outer-city-tree-crown',.82,[x,2,z],0x5f876d,[1.05,1.1,.95]);const lamp=new THREE.PointLight(0xffd2a0,.34,6);lamp.position.set(x+1.4,2.7,z*1.18);scene.add(lamp);}
  addBox(scene,'city-cross-street',[7.5,.04,34],[89,-.06,0],0x252d37,{roughness:.95,castShadow:false});addBox(scene,'city-cross-street-marking',[.06,.025,28],[89,-.025,0],0xe6d4a9,{castShadow:false});addBox(scene,'city-parking-plaza',[5.4,.08,10],[88,-.02,-10],0x777d82,{castShadow:false});for(let i=0;i<5;i++)addBox(scene,'city-parking-bay',[.06,.025,3.4],[86+(i%3)*1.35,.035,-13.1+Math.floor(i/3)*5.8],0xe9dfc9,{castShadow:false});
  // The city has open retail storefronts and public plazas; the playable mart is inside the penthouse.
  addElevatorStation([28.5, 0, 0], 'city');
  // Raised edge rails frame the walkable skywalk without enclosing the promenade.
  addBox(scene, 'city-edge-north', [65.5, .8, .12], [59.2, .4, -27], 0x8b9da4);
  addBox(scene, 'city-edge-south', [65.5, .8, .12], [59.2, .4, 27], 0x8b9da4);
  colliders.push(
    { minX: 30.45, maxX: 35.5, minZ: -16.0, maxZ: -10.0 },
    { minX: 37.35, maxX: 42.7, minZ: -16.0, maxZ: -10.0 },
    { minX: 44.6, maxX: 49.6, minZ: -16.0, maxZ: -10.0 },
    { minX: 32.7, maxX: 38.3, minZ: 10.3, maxZ: 15.7 },
    { minX: 40.4, maxX: 45.6, minZ: 10.3, maxZ: 15.7 },
    { minX: 48.1, maxX: 52.5, minZ: 10.3, maxZ: 15.7 },
    { minX: 39.1, maxX: 42.9, minZ: -1.9, maxZ: 1.9 }
  );

  // Guardrail collision volumes and the side-door corridor prevent players leaving the rooftop.
  colliders.push(
    { minX: 21.45, maxX: 21.9, minZ: -8.5, maxZ: 8.5 },
    { minX: 9.25, maxX: 21.4, minZ: -8.65, maxZ: -8.25 },
    { minX: 9.25, maxX: 21.4, minZ: 8.25, maxZ: 8.65 }
  );
}

const WEATHER_PRESETS={clear:{sky:0x8db9d5,fog:0xb8d0dc,near:90,far:190,sun:0xffe4bf,power:2.4,hemi:1.55,exposure:1.18,n:0},sunset:{sky:0xd68f78,fog:0xe4b09b,near:65,far:165,sun:0xffa36e,power:1.55,hemi:1.05,exposure:1.28,n:0},night:{sky:0x101a30,fog:0x26334b,near:48,far:135,sun:0x8da9e8,power:.32,hemi:.42,exposure:.82,n:0},rain:{sky:0x526477,fog:0x71808c,near:30,far:105,sun:0x9aacc2,power:.48,hemi:.7,exposure:.9,n:520},storm:{sky:0x303b50,fog:0x4b5668,near:24,far:90,sun:0x7c8ba7,power:.22,hemi:.38,exposure:.78,n:720},snow:{sky:0xa8bdca,fog:0xd0dce1,near:38,far:125,sun:0xd7e8f5,power:.82,hemi:1.05,exposure:1.02,n:380},fog:{sky:0x89949b,fog:0xc0c7c9,near:12,far:62,sun:0xc5cbd0,power:.58,hemi:.8,exposure:.92,n:0}};
function clearWeatherParticles(){if(!world?.weather)return;world.scene.remove(world.weather.points);world.weather.points.geometry.dispose();world.weather.points.material.dispose();world.weather=null;}
function applyWeather(kind,announce=false){const p=WEATHER_PRESETS[kind]||WEATHER_PRESETS.clear;activeWeatherKind=kind;try{localStorage.setItem('tg-player-weather',kind);}catch(_error){}const select=$('weatherSelect');if(select&&select.value!==kind)select.value=kind;if(!world)return;clearWeatherParticles();world.weatherKind=kind;world.scene.background=new THREE.Color(p.sky);if(world.scene.fog){world.scene.fog.color.setHex(p.fog);world.scene.fog.near=p.near;world.scene.fog.far=p.far;}else world.scene.fog=new THREE.Fog(p.fog,p.near,p.far);world.renderer.toneMappingExposure=p.exposure;world.sunLight.color.setHex(p.sun);world.sunLight.intensity=p.power;world.hemiLight.intensity=p.hemi;world.backGlow.intensity=kind==='night'?1:kind==='storm'?.35:.8;world.frontGlow.intensity=kind==='night'?.72:.5;world.container.dataset.weather=kind;
if(p.n){const count=p.n,positions=new Float32Array(count*3),velocities=new Float32Array(count*3);for(let i=0;i<count;i++){positions[i*3]=(Math.random()-.5)*75;positions[i*3+1]=Math.random()*28;positions[i*3+2]=(Math.random()-.5)*65;velocities[i*3]=(Math.random()-.5)*(kind==='snow'?.65:.22);velocities[i*3+1]=kind==='snow'?.8+Math.random()*1.2:13+Math.random()*8;velocities[i*3+2]=(Math.random()-.5)*(kind==='snow'?.65:.22);}const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));const material=new THREE.PointsMaterial({color:kind==='snow'?0xf4f8ff:0xc8d9e8,size:kind==='snow'?.13:.055,transparent:true,opacity:kind==='snow'?.88:.62,depthWrite:false});const points=new THREE.Points(geometry,material);points.frustumCulled=false;world.scene.add(points);world.weather={points,positions,velocities,count,kind};}
if(announce){const names={clear:'Clear day',sunset:'Golden sunset',night:'Night',rain:'Rain',storm:'Thunderstorm',snow:'Snow',fog:'Fog'};showToast('Weather changed: '+names[kind]);}}
function updateWeather(delta,now){const w=world?.weather;if(!w)return;const center=world.cameraTarget;for(let i=0;i<w.count;i++){const j=i*3;w.positions[j]+=w.velocities[j]*delta;w.positions[j+1]-=w.velocities[j+1]*delta;w.positions[j+2]+=w.velocities[j+2]*delta;if(w.positions[j+1]<0){w.positions[j]=center.x+(Math.random()-.5)*70;w.positions[j+1]=18+Math.random()*12;w.positions[j+2]=center.z+(Math.random()-.5)*60;}if(w.kind==='snow')w.positions[j]+=Math.sin(now*.0005+i)*delta*.18;}w.points.geometry.attributes.position.needsUpdate=true;if(w.kind==='storm'&&Math.random()<.0015){world.sunLight.intensity=2.2;world.lightningUntil=now+100;}if(world.lightningUntil&&now>world.lightningUntil){world.sunLight.intensity=WEATHER_PRESETS.storm.power;world.lightningUntil=0;}}


function createCityPedestrian(scene,index,x,z,direction){
 const npc=new THREE.Group();npc.position.set(x,0,z);npc.rotation.y=direction>0?Math.PI/2:-Math.PI/2;
 const skin=new THREE.MeshStandardMaterial({color:[0xc58f70,0xe0b493,0x9c6d55,0xd7a27e][index%4],roughness:.82});
 const clothes=new THREE.MeshStandardMaterial({color:[0x496c88,0x8a5862,0x657b62,0x76678f][index%4],roughness:.75});
 const body=new THREE.Mesh(new THREE.CapsuleGeometry(.22,.48,4,8),clothes);body.position.y=.78;body.castShadow=true;npc.add(body);
 const head=new THREE.Mesh(new THREE.SphereGeometry(.17,12,10),skin);head.position.y=1.25;head.castShadow=true;npc.add(head);
 const legs=[];for(const side of [-1,1]){const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.075,.36,3,6),new THREE.MeshStandardMaterial({color:0x303744}));leg.position.set(side*.11,.3,0);npc.add(leg);legs.push(leg);}
 npc.userData={phase:index*1.7,direction,speed:.55+(index%3)*.12,legs};scene.add(npc);return npc;
}
function createCityTraffic(scene){
 const cars=[];for(let i=0;i<4;i++){const speed=i%2?-(3.1+i*.18):(3+i*.16);const root=createCarMesh({id:'traffic-'+i,position:{x:34+i*14,z:i%2?-1.55:1.55},rotationY:speed>0?Math.PI/2:-Math.PI/2,bodyColor:[0x376f9b,0x9a9b9e,0x647d5e,0x9b6658][i]});root.userData.trafficSpeed=speed;root.userData.trafficMin=30;root.userData.trafficMax=87;root.userData.trafficLane=i%2?-1.55:1.55;root.position.z=root.userData.trafficLane;scene.add(root);cars.push(root);}return cars;
}
function createCityMissionPickups(scene){
 return [[42,-5.5],[62,5.5],[81,-5.5]].map(([x,z],i)=>{const group=new THREE.Group();group.position.set(x,0,z);const crate=new THREE.Mesh(new THREE.BoxGeometry(.72,.58,.72),new THREE.MeshStandardMaterial({color:0xd6a35e,roughness:.7}));crate.position.y=.32;crate.castShadow=true;group.add(crate);const ring=new THREE.Mesh(new THREE.TorusGeometry(.62,.045,8,24),new THREE.MeshBasicMaterial({color:0xffd98a}));ring.rotation.x=Math.PI/2;ring.position.y=.12;group.add(ring);const light=new THREE.PointLight(0xffc76b,.55,3);light.position.y=1.1;group.add(light);group.userData.pickupIndex=i;group.visible=false;scene.add(group);return group;});
}
function startCityMission(){if(currentZone!=='city')return showToast('Take the elevator to the city to start a delivery mission.');cityMission.active=true;cityMission.collected=0;cityMission.pickups=world?.cityMissionPickups||[];cityMission.pickups.forEach(p=>{p.visible=true;p.position.y=0;});updateCityMissionHud();showToast('City delivery started: collect all 3 glowing packages.');}
function updateCityMissionHud(){const button=$('cityMissionButton'),status=$('cityMissionStatus');if(button)button.textContent=cityMission.active?'Mission in progress':'Start city delivery';if(status)status.textContent=cityMission.active?cityMission.collected+'/3 packages':(cityMission.collected===3?'Completed':'3 packages · City');}
function updateCityMission(){if(!cityMission.active||currentZone!=='city'||!world)return;const local=world.playerObjects.get(selfId);if(!local)return;cityMission.pickups.forEach(p=>{if(!p.visible)return;p.rotation.y+=.018;p.position.y=.12+Math.sin(performance.now()*.003+p.userData.pickupIndex)*.08;if(Math.hypot(local.position.x-p.position.x,local.position.z-p.position.z)<1.55){p.visible=false;cityMission.collected++;updateCityMissionHud();if(cityMission.collected>=3){cityMission.active=false;showToast('Delivery complete! You collected all 3 packages.');}else showToast('Package collected · '+cityMission.collected+'/3');}});}
function updateCityAmbient(delta,now){if(!world||currentZone!=='city')return;world.trafficCars?.forEach(car=>{car.position.x+=car.userData.trafficSpeed*delta;if(car.position.x>car.userData.trafficMax)car.position.x=car.userData.trafficMin;if(car.position.x<car.userData.trafficMin)car.position.x=car.userData.trafficMax;car.userData.wheels?.forEach(w=>{w.rotation.x+=Math.sign(car.userData.trafficSpeed)*delta*5;});});world.cityPedestrians?.forEach(npc=>{npc.position.x+=npc.userData.direction*npc.userData.speed*delta;if(npc.position.x>86)npc.userData.direction=-1;if(npc.position.x<34)npc.userData.direction=1;npc.rotation.y=npc.userData.direction>0?Math.PI/2:-Math.PI/2;npc.userData.legs.forEach((leg,i)=>{leg.rotation.x=Math.sin(now*.006+npc.userData.phase+i*Math.PI)*.45;});npc.position.y=Math.abs(Math.sin(now*.006+npc.userData.phase))*.035;});}

function initializeWorld() {
  const container = $('worldCanvas');
  if (world) return;
  const width = container.clientWidth || 900;
  const height = container.clientHeight || 600;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(39, width / height, .1, 240);
  camera.position.set(5.0, 24.5, 29.5);
  camera.lookAt(5.2, 0.55, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  container.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xffe5d1, 0x473a42, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffddc2, 2.1);
  sun.position.set(-3, 7, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -12; sun.shadow.camera.right = 12; sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
  scene.add(sun);
  const backGlow = new THREE.PointLight(0xd98d91, .8, 9);
  backGlow.position.set(-1, 3.2, -2.2); scene.add(backGlow);
  const frontGlow = new THREE.PointLight(0xf1c6a5, .5, 8);
  frontGlow.position.set(0, 3.8, 4); scene.add(frontGlow);
  const colliders = [];
  createHouseScene(scene, colliders);
  const roomAmbience = {
    penthouse: { sky: 0x9bb1c4, glow: 0xd98d91, sun: 0xffddc2 },
    music: { sky: 0x7189a8, glow: 0x9b79d1, sun: 0xb7c8ff },
    cozy: { sky: 0xb9a49b, glow: 0xe4a28f, sun: 0xffd7b8 },
    game: { sky: 0x778fa4, glow: 0x7ec6bd, sun: 0xc1e4ff },
    garden: { sky: 0x8eae9a, glow: 0x7ab98b, sun: 0xffe3b1 },
    cinema: { sky: 0x34364e, glow: 0x9474c9, sun: 0x9a9bc4 }
  }[activeRoomType] || null;
  if (roomAmbience) {
    scene.background.setHex(roomAmbience.sky);
    scene.fog.color.setHex(roomAmbience.sky);
    backGlow.color.setHex(roomAmbience.glow);
    sun.color.setHex(roomAmbience.sun);
  }

  const playerObjects = new Map();
  const vehicleObjects = new Map();
  const cameraTarget = new THREE.Vector3(5.2, .55, 0);
  const cameraSpherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(cameraTarget));
  world = { scene, camera, renderer, playerObjects, vehicleObjects, container, colliders, cameraTarget, cameraSpherical, sunLight: sun, hemiLight: hemi, backGlow, frontGlow, lastFrame: performance.now(), localMoving: false, weather: null, weatherKind: 'clear', trafficCars: [], cityPedestrians: [], cityMissionPickups: [] };
  world.trafficCars=createCityTraffic(scene);
  world.cityPedestrians=Array.from({length:9},(_,i)=>createCityPedestrian(scene,i,37+i*5.8,i%2?-5.5:5.5,i%2?1:-1));
  world.cityMissionPickups=createCityMissionPickups(scene);
  $('cityMissionButton')?.addEventListener('click',startCityMission);
  updateCityMissionHud();
  const weatherSelect=$('weatherSelect');
  if(weatherSelect){weatherSelect.value=activeWeatherKind;weatherSelect.onchange=()=>{try{applyWeather(weatherSelect.value,true);}catch(error){console.error('Weather change failed',error);showToast('Weather could not load. Please try another setting.');}};}
  applyWeather(activeWeatherKind);
  let orbitPointer = null;
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    orbitPointer = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    renderer.domElement.setPointerCapture?.(event.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (!orbitPointer || orbitPointer.pointerId !== event.pointerId || !world) return;
    const dx = event.clientX - orbitPointer.x;
    const dy = event.clientY - orbitPointer.y;
    orbitPointer.x = event.clientX;
    orbitPointer.y = event.clientY;
    world.cameraSpherical.theta -= dx * .006;
    world.cameraSpherical.phi = THREE.MathUtils.clamp(world.cameraSpherical.phi + dy * .004, .35, 1.38);
    world.camera.position.copy(world.cameraTarget).add(new THREE.Vector3().setFromSpherical(world.cameraSpherical));
    world.camera.lookAt(world.cameraTarget);
  });
  const stopOrbit = () => { orbitPointer = null; };
  renderer.domElement.addEventListener('pointerup', stopOrbit);
  renderer.domElement.addEventListener('pointercancel', stopOrbit);
  renderer.domElement.addEventListener('wheel', (event) => {
    if (!world) return;
    event.preventDefault();
    world.cameraSpherical.radius = THREE.MathUtils.clamp(world.cameraSpherical.radius + event.deltaY * .018, 22, 76);
    world.camera.position.copy(world.cameraTarget).add(new THREE.Vector3().setFromSpherical(world.cameraSpherical));
    world.camera.lookAt(world.cameraTarget);
  }, { passive: false });
  const resize = () => {
    if (!world) return;
    const w = container.clientWidth || 900;
    const h = container.clientHeight || 600;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  world.resizeHandler = resize;
  window.addEventListener('resize', resize);
  updatePlayers(players);
  updateVehicles(vehicles);
  animateWorld();
  setTimeout(() => $('worldLoading').classList.add('fade'), 500);
}

function disposeSceneObject(object, scene) {
  scene.remove(object);
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
      else child.material.dispose?.();
    }
  });
}

function updatePlayers(nextPlayers) {
  if (!world) return;
  const incomingIds = new Set((nextPlayers || []).map((player) => player.id));
  world.playerObjects.forEach((object, id) => {
    if (!incomingIds.has(id)) {
      disposeSceneObject(object, world.scene);
      world.playerObjects.delete(id);
    }
  });
  (nextPlayers || []).forEach((player) => {
    const outfitSignature = JSON.stringify(player.outfit || {});
    let object = world.playerObjects.get(player.id);
    if (object && object.userData.outfitSignature !== outfitSignature) {
      disposeSceneObject(object, world.scene);
      world.playerObjects.delete(player.id);
      object = null;
    }
    if (!object) {
      object = createCharacter(player);
      world.scene.add(object);
      world.playerObjects.set(player.id, object);
    }
    if (player.position) {
      object.position.set(player.position.x, 0, player.position.z);
      object.userData.targetPosition = new THREE.Vector3(player.position.x, 0, player.position.z);
    }
    object.rotation.y = Number(player.rotationY) || 0;
    object.userData.targetRotationY = Number(player.rotationY) || 0;
    object.userData.networkMoving = Boolean(player.moving);
    object.userData.action = player.action || 'none';
    object.userData.danceStyle = player.danceStyle || 'groove';
    object.userData.bedId = player.bedId || null;
    object.userData.zone = player.zone || 'penthouse';
    if (player.id === selfId) currentZone = player.zone || currentZone;
    object.visible = !player.vehicleId;
  });
  const me = (nextPlayers || []).find((player) => player.id === selfId);
  activeVehicleId = me?.vehicleId || '';
  if ($('driveButton')) $('driveButton').textContent = activeVehicleId ? 'Exit car (E)' : 'Enter car (E)';
  if ($('chatOnlineCount')) $('chatOnlineCount').textContent = `${(nextPlayers || []).length} HERE`;
  updateResidentAvatars();
  updateActivityControls(nextPlayers || []);
}

function updateResidentAvatars() {
  const holder = $('residentAvatars');
  if (!holder) return;
  holder.innerHTML = '';
  (players || []).slice(0, 8).forEach((player) => {
    const item = document.createElement('span');
    item.className = 'resident';
    item.textContent = player.character === 'grace' ? 'G' : player.character === 'tom' ? 'T' : player.character === 'alex' ? 'A' : 'R';
    item.title = `${player.name} · ${player.character}${player.voiceJoined ? (player.voiceMuted ? ' · voice joined, mic muted' : ' · voice active') : ''}`;
    item.classList.toggle('voice-active', Boolean(player.voiceJoined && !player.voiceMuted));
    holder.appendChild(item);
  });
  if ((players || []).length < 8) {
    const empty = document.createElement('span');
    empty.className = 'resident empty';
    empty.textContent = '+';
    empty.title = 'Room has space for more friends';
    holder.appendChild(empty);
  }
}

function formatChatTime(timestamp) {
  try {
    return new Date(timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_error) {
    return '';
  }
}

function appendChatMessage(message) {
  const holder = $('chatMessages');
  if (!holder || !message) return;
  holder.querySelector('.chat-empty')?.remove();
  const item = document.createElement('article');
  item.className = `chat-message${message.system ? ' chat-system' : message.playerId === selfId ? ' chat-self' : ''}`;
  if (message.system) {
    const note = document.createElement('span');
    note.textContent = message.text || '';
    item.appendChild(note);
  } else {
    const header = document.createElement('div');
    header.className = 'chat-message-header';
    const name = document.createElement('strong');
    name.textContent = message.name || 'Player';
    const time = document.createElement('time');
    time.textContent = formatChatTime(message.timestamp);
    header.append(name, time);
    const body = document.createElement('p');
    body.textContent = message.text || '';
    item.append(header, body);
  }
  holder.appendChild(item);
  while (holder.children.length > 85) holder.firstElementChild.remove();
  holder.scrollTop = holder.scrollHeight;
}

function renderChatHistory(messages) {
  const holder = $('chatMessages');
  if (!holder) return;
  holder.innerHTML = '';
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = 'Your conversation starts here. Say hello ♡';
    holder.appendChild(empty);
    return;
  }
  messages.forEach(appendChatMessage);
}

$('chatForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text || !activeRoomId) return;
  socket.emit('chat:send', { text }, (response) => {
    if (!response?.ok) return showToast(response?.error || 'Message could not be sent.');
    input.value = '';
    input.focus();
  });
});

function isHouseWallBlocked(x, z, colliders, radius = .27) {
  return colliders.some((wall) =>
    x + radius > wall.minX && x - radius < wall.maxX &&
    z + radius > wall.minZ && z - radius < wall.maxZ
  );
}

function animateWorld() {
  if (!world) return;
  requestAnimationFrame(animateWorld);
  const now = performance.now();
  const delta = Math.min((now - world.lastFrame) / 1000, .05);
  world.lastFrame = now;
  const local = world.playerObjects.get(selfId);
  let localMoving = false;

  if (activeVehicleId) {
    const car = world.vehicleObjects.get(activeVehicleId);
    if (car) {
      let throttle = 0;
      if (moveKeys.has('KeyW') || moveKeys.has('ArrowUp')) throttle += 1;
      if (moveKeys.has('KeyS') || moveKeys.has('ArrowDown')) throttle -= 1;
      let steering = 0;
      if (moveKeys.has('KeyA') || moveKeys.has('ArrowLeft')) steering += 1;
      if (moveKeys.has('KeyD') || moveKeys.has('ArrowRight')) steering -= 1;
      const beforeX = car.position.x;
      const beforeZ = car.position.z;
      if (throttle !== 0) {
        car.rotation.y += steering * delta * 1.45 * Math.sign(throttle);
        const speed = throttle > 0 ? 6.1 : 3.1;
        car.position.x += Math.sin(car.rotation.y) * speed * throttle * delta;
        car.position.z += Math.cos(car.rotation.y) * speed * throttle * delta;
        if(currentZone==='city'){car.position.x=THREE.MathUtils.clamp(car.position.x,30,87);car.position.z=THREE.MathUtils.clamp(car.position.z,-2.55,2.55);}else{car.position.x=THREE.MathUtils.clamp(car.position.x,10.15,20.95);car.position.z=THREE.MathUtils.clamp(car.position.z,-7.55,7.55);}
        car.userData.wheels?.forEach((wheel) => { wheel.rotation.x -= throttle * delta * 8; });
      }
      const moved = Math.abs(car.position.x - beforeX) > .0001 || Math.abs(car.position.z - beforeZ) > .0001;
      if (moved) {
        const localVehicleState = vehicles.find((item) => item.id === activeVehicleId);
        if (localVehicleState) { localVehicleState.position = { x: car.position.x, z: car.position.z }; localVehicleState.rotationY = car.rotation.y; }
      }
      if (moved && now - lastVehicleSentAt > 48) {
        socket.emit('vehicle:move', {
          vehicleId: activeVehicleId,
          position: { x: car.position.x, z: car.position.z },
          rotationY: car.rotation.y
        });
        lastVehicleSentAt = now;
        lastVehicleSentPosition = { x: car.position.x, z: car.position.z };
      }
      if (local) local.visible = false;
    }
  } else if (local) {
    const speed = 3.6;
    let dx = 0, dz = 0;
    if (moveKeys.has('KeyW') || moveKeys.has('ArrowUp')) dz -= 1;
    if (moveKeys.has('KeyS') || moveKeys.has('ArrowDown')) dz += 1;
    if (moveKeys.has('KeyA') || moveKeys.has('ArrowLeft')) dx -= 1;
    if (moveKeys.has('KeyD') || moveKeys.has('ArrowRight')) dx += 1;
    if (dx || dz) {
      if (local.userData.action && local.userData.action !== 'none') {
        local.userData.action = 'none';
        local.userData.bedId = null;
        local.rotation.x = 0;
        local.rotation.z = 0;
      }
      const beforeX = local.position.x;
      const beforeZ = local.position.z;
      const length = Math.hypot(dx, dz) || 1;
      const stepX = (dx / length) * speed * delta;
      const stepZ = (dz / length) * speed * delta;
      const bounds = currentZone === 'city'
        ? { minX: 27.2, maxX: 92.0, minZ: -26.0, maxZ: 26.0 }
        : { minX: -8.55, maxX: 21.2, minZ: -8.05, maxZ: 8.05 };
      const nextX = THREE.MathUtils.clamp(local.position.x + stepX, bounds.minX, bounds.maxX);
      const nextZ = THREE.MathUtils.clamp(local.position.z + stepZ, bounds.minZ, bounds.maxZ);
      if (!isHouseWallBlocked(nextX, local.position.z, world.colliders)) local.position.x = nextX;
      if (!isHouseWallBlocked(local.position.x, nextZ, world.colliders)) local.position.z = nextZ;
      local.rotation.y = Math.atan2(dx, dz);
      localMoving = Math.hypot(local.position.x - beforeX, local.position.z - beforeZ) > .0001;
    }
    const currentPosition = { x: local.position.x, z: local.position.z };
    const moved = Math.abs(currentPosition.x - lastSentPosition.x) > .018 || Math.abs(currentPosition.z - lastSentPosition.z) > .018;
    const changedMovingState = localMoving !== world.localMoving;
    if ((localMoving && now - lastMoveSentAt > 50 && moved) || changedMovingState) {
      socket.emit('player:move', { ...currentPosition, rotationY: local.rotation.y, moving: localMoving, zone: currentZone });
      lastMoveSentAt = now;
      lastSentPosition = currentPosition;
      world.localMoving = localMoving;
    }
  }

  updateWeather(delta, now);
  updateCityAmbient(delta,now);
  updateCityMission();
  world.playerObjects.forEach((object, id) => {
    if (id !== selfId && object.userData.targetPosition) {
      object.position.lerp(object.userData.targetPosition, Math.min(1, delta * 12));
      const targetYaw = Number(object.userData.targetRotationY) || 0;
      const yawDelta = Math.atan2(Math.sin(targetYaw - object.rotation.y), Math.cos(targetYaw - object.rotation.y));
      object.rotation.y += yawDelta * Math.min(1, delta * 12);
    }
    const moving = id === selfId ? localMoving : (object.userData.networkMoving || (object.userData.targetPosition && object.position.distanceTo(object.userData.targetPosition) > .035));
    const phase = object.userData.phase || 0;
    const swimming = object.userData.zone === 'penthouse' && object.position.x > 9.55 && object.position.x < 13.35 && object.position.z > -7.05 && object.position.z < -4.2;
    const action = object.userData.action || 'none';
    const limbs = object.userData.limbs;
    const torso = object.userData.torso;
    const head = object.userData.head;
    const beat = now * .001;

    if (action === 'sleep') {
      object.rotation.x = -Math.PI / 2;
      object.rotation.z = 0;
      if (object.visible) object.position.y = .84 + Math.sin(now * .0018 + phase) * .015;
      if (limbs) {
        limbs.leftArm.rotation.x = .08 + Math.sin(beat * .8 + phase) * .025;
        limbs.rightArm.rotation.x = -.08 - Math.sin(beat * .8 + phase) * .025;
        limbs.leftArm.rotation.z = -.22;
        limbs.rightArm.rotation.z = .22;
        limbs.leftLeg.rotation.x = .025;
        limbs.rightLeg.rotation.x = -.025;
      }
      if (torso) torso.scale.y = 1 + Math.sin(now * .0018 + phase) * .018;
      if (head) head.rotation.z = Math.sin(now * .0018 + phase) * .012;
    } else if (action === 'dance') {
      object.rotation.x = 0;
      const style = object.userData.danceStyle || 'groove';
      const speed = style === 'sway' ? 1.4 : style === 'salsa' ? 4.2 : 3.2;
      const wave = Math.sin(beat * speed + phase);
      const counter = Math.sin(beat * speed + phase + Math.PI);
      if (object.visible) object.position.y = (style === 'bounce' || style === 'disco' ? Math.abs(wave) * .13 : Math.abs(wave) * .045);
      object.rotation.z = style === 'sway' ? Math.sin(beat * 1.5 + phase) * .16 : Math.sin(beat * 3.0 + phase) * .09;
      if (limbs) {
        if (style === 'disco') {
          limbs.leftArm.rotation.z = -1.0 + Math.sin(beat * 2.2 + phase) * .18;
          limbs.rightArm.rotation.z = 1.0 + Math.sin(beat * 2.2 + phase + Math.PI) * .18;
          limbs.leftArm.rotation.x = wave * .55;
          limbs.rightArm.rotation.x = counter * .55;
        } else if (style === 'salsa') {
          limbs.leftArm.rotation.z = -.55 + wave * .25;
          limbs.rightArm.rotation.z = .55 + counter * .25;
          limbs.leftArm.rotation.x = wave * .8;
          limbs.rightArm.rotation.x = counter * .8;
        } else if (style === 'sway') {
          limbs.leftArm.rotation.z = -.24 + wave * .24;
          limbs.rightArm.rotation.z = .24 - wave * .24;
          limbs.leftArm.rotation.x = wave * .2;
          limbs.rightArm.rotation.x = -wave * .2;
        } else {
          limbs.leftArm.rotation.z = -.35 + wave * .35;
          limbs.rightArm.rotation.z = .35 + counter * .35;
          limbs.leftArm.rotation.x = wave * .82;
          limbs.rightArm.rotation.x = counter * .82;
        }
        limbs.leftLeg.rotation.x = style === 'sway' ? wave * .12 : wave * .52;
        limbs.rightLeg.rotation.x = style === 'sway' ? -wave * .12 : counter * .52;
      }
      if (torso) torso.scale.y = 1 + Math.abs(wave) * .025;
      if (head) head.rotation.z = Math.sin(beat * 2.8 + phase) * .045;
    } else {
      object.rotation.x = 0;
      object.rotation.z = 0;
      if (object.visible) {
        if (swimming) object.position.y = .14 + Math.sin(now * .004 + phase) * .045;
        else object.position.y = moving ? Math.abs(Math.sin(now * .012 + phase)) * .045 : Math.sin(now * .0015 + phase) * .012;
      }
      const limbCycle = now * (swimming ? .008 : .012) + phase;
      if (limbs) {
        const swing = swimming ? .88 : moving ? .58 : .025;
        limbs.leftArm.rotation.x = Math.sin(limbCycle) * swing;
        limbs.rightArm.rotation.x = -Math.sin(limbCycle) * swing;
        limbs.leftArm.rotation.z = swimming ? -.28 : -.18;
        limbs.rightArm.rotation.z = swimming ? .28 : .18;
        limbs.leftLeg.rotation.x = swimming ? Math.sin(limbCycle + Math.PI) * .35 : moving ? -Math.sin(limbCycle) * .62 : 0;
        limbs.rightLeg.rotation.x = swimming ? Math.sin(limbCycle) * .35 : moving ? Math.sin(limbCycle) * .62 : 0;
      }
      if (torso) torso.scale.y = 1 + Math.sin(now * .002 + phase) * .012;
      if (head) head.rotation.z = Math.sin(now * .0018 + phase) * .018;
    }
  });

  world.vehicleObjects.forEach((car, id) => {
    if (id !== activeVehicleId && car.userData.targetPosition) {
      car.position.lerp(car.userData.targetPosition, Math.min(1, delta * 10));
      const targetYaw = Number(car.userData.targetRotationY) || 0;
      const yawDelta = Math.atan2(Math.sin(targetYaw - car.rotation.y), Math.cos(targetYaw - car.rotation.y));
      car.rotation.y += yawDelta * Math.min(1, delta * 10);
    }
  });

  // Follow the local character so the city district is explorable without losing the camera.
  const followedObject = activeVehicleId ? world.vehicleObjects.get(activeVehicleId) : local;
  if (followedObject) {
    world.cameraTarget.lerp(new THREE.Vector3(followedObject.position.x, .55, followedObject.position.z), Math.min(1, delta * 2.7));
    world.camera.position.copy(world.cameraTarget).add(new THREE.Vector3().setFromSpherical(world.cameraSpherical));
    world.camera.lookAt(world.cameraTarget);
  }
  if (local && $('elevatorButton')) {
    const station = currentZone === 'city' ? { x: 28.5, z: 0 } : { x: 19.2, z: -6.0 };
    const nearElevator = Math.hypot(local.position.x - station.x, local.position.z - station.z) < 3.6;
    $('elevatorButton').disabled = !nearElevator || Boolean(activeVehicleId);
    const nearMall = currentZone === 'penthouse' && Math.hypot(local.position.x + 5.2, local.position.z - .45) < 3.6;
    $('mallButton').disabled = !nearMall || Boolean(activeVehicleId);
    $('mallButton').classList.toggle('mall-nearby', nearMall);
    $('elevatorButton').textContent = currentZone === 'city' ? '↕ Elevator · Home (F)' : '↕ Elevator · City (F)';
  }
  updateActivityControls(players);
  updateVoiceAudioVolumes();
  world.renderer.render(world.scene, world.camera);
}

function toggleCar() {
  if (!activeRoomId) return;
  if (activeVehicleId) {
    socket.emit('vehicle:exit', {}, (response) => {
      if (!response?.ok) return showToast(response?.error || 'Could not exit the car.');
      activeVehicleId = '';
      const local = world?.playerObjects.get(selfId);
      if (local && response.position) {
        local.position.set(response.position.x, 0, response.position.z);
        local.userData.targetPosition = new THREE.Vector3(response.position.x, 0, response.position.z);
        local.visible = true;
      }
      lastSentPosition = response.position || lastSentPosition;
      showToast('You stepped out of the car.');
    });
    return;
  }
  const local = world?.playerObjects.get(selfId);
  if (!local) return;
  let nearest = null;
  let nearestDistance = 4.8;
  vehicles.forEach((vehicle) => {
    if (vehicle.driverId) return;
    const distance = Math.hypot(local.position.x - vehicle.position.x, local.position.z - vehicle.position.z);
    if (distance < nearestDistance) { nearest = vehicle; nearestDistance = distance; }
  });
  if (!nearest) return showToast('Walk closer to a parked car to drive it.');
  socket.emit('vehicle:enter', { vehicleId: nearest.id }, (response) => {
    if (!response?.ok) return showToast(response?.error || 'Could not enter that car.');
    activeVehicleId = response.vehicleId;
    local.visible = false;
    showToast('You are driving. Use WASD or the arrow keys. Press E to get out.');
  });
}

$('driveButton').addEventListener('click', toggleCar);
function travelElevator() {
  if (!activeRoomId) return;
  socket.emit('elevator:travel', {}, (response) => {
    if (!response?.ok) return showToast(response?.error || 'Walk to the elevator before travelling.');
    currentZone = response.zone || 'penthouse';
    if (response.players) {
      players = response.players;
      updatePlayers(players);
      syncVoicePeers(players);
    }
    moveKeys.clear();
    if (world) world.localMoving = false;
    const local = world?.playerObjects.get(selfId);
    if (local) {
      local.userData.zone = currentZone;
      local.userData.networkMoving = false;
      if (response.position) {
        local.position.set(response.position.x, 0, response.position.z);
        local.userData.targetPosition.set(response.position.x, 0, response.position.z);
      }
    }
    lastSentPosition = response.position || lastSentPosition;
    showToast(currentZone === 'city' ? 'Welcome to the expanded city promenade.' : 'Back home in the penthouse. The mini mart is on the rooftop.');
    updateVoiceAudioVolumes();
  });
}
$('elevatorButton').addEventListener('click', travelElevator);

const SHOP_ITEMS = [
  { id: 'milk', name: 'Fresh milk', detail: 'Daily dairy essential', price: 18, icon: '🥛' },
  { id: 'bread', name: 'Bakery bread', detail: 'Freshly baked loaf', price: 14, icon: '🍞' },
  { id: 'apples', name: 'Apple pack', detail: 'Crisp fruit pack', price: 22, icon: '🍎' },
  { id: 'snacks', name: 'Snack basket', detail: 'Treats for movie night', price: 28, icon: '🍿' },
  { id: 'flowers', name: 'Flower bouquet', detail: 'A little gift for home', price: 35, icon: '💐' },
  { id: 'coffee', name: 'Coffee pack', detail: 'For a cozy morning', price: 26, icon: '☕' }
];
const SHOP_STORAGE_KEY = 'tg-mall-wallet-v1';
let shopWallet = 250;
let shopCart = {};
let shopInventory = {};
try {
  const savedShop = JSON.parse(localStorage.getItem(SHOP_STORAGE_KEY) || '{}');
  if (Number.isFinite(savedShop.wallet)) shopWallet = Math.max(0, savedShop.wallet);
  if (savedShop.inventory && typeof savedShop.inventory === 'object') shopInventory = savedShop.inventory;
} catch (_error) {}
function saveShopWallet() {
  localStorage.setItem(SHOP_STORAGE_KEY, JSON.stringify({ wallet: shopWallet, inventory: shopInventory }));
}
function renderMall() {
  const products = $('mallProducts');
  if (!products) return;
  products.innerHTML = SHOP_ITEMS.map((item) => {
    const count = shopCart[item.id] || 0;
    return '<article class="mall-product"><span class="mall-product-icon">' + item.icon + '</span><div class="mall-product-copy"><strong>' + item.name + '</strong><small>' + item.detail + '</small><b>' + item.price + ' coins</b></div><div class="mall-quantity"><button type="button" data-shop-minus="' + item.id + '" aria-label="Remove ' + item.name + '">−</button><span>' + count + '</span><button type="button" data-shop-plus="' + item.id + '" aria-label="Add ' + item.name + '">+</button></div></article>';
  }).join('');
  const total = SHOP_ITEMS.reduce((sum, item) => sum + item.price * (shopCart[item.id] || 0), 0);
  $('mallWallet').textContent = 'Wallet: ' + shopWallet + ' coins';
  $('mallCartTotal').textContent = 'Cart: ' + total + ' coins';
  const bag = SHOP_ITEMS.filter((item) => shopInventory[item.id]).map((item) => (shopInventory[item.id] + '× ' + item.name));
  $('mallBag').textContent = bag.length ? 'Your bag: ' + bag.join(' · ') : 'Your bag is empty.';
  $('mallCheckout').disabled = total <= 0 || total > shopWallet;
}
function openMall() {
  if (currentZone !== 'penthouse') return showToast('The mini mart is inside the penthouse only.');
  const local = world && world.playerObjects.get(selfId);
  if (!local || Math.hypot(local.position.x + 5.2, local.position.z - .45) > 4.2) return showToast('Walk through the Penthouse Mini Mart entrance first.');
  $('mallPanel').classList.remove('hidden');
  $('activitiesPanel').classList.add('hidden');
  $('wardrobePanel').classList.add('hidden');
  renderMall();
}
$('mallButton').addEventListener('click', openMall);
$('mallClose').addEventListener('click', () => $('mallPanel').classList.add('hidden'));
$('mallProducts').addEventListener('click', (event) => {
  const addId = event.target.closest('[data-shop-plus]')?.dataset.shopPlus;
  const removeId = event.target.closest('[data-shop-minus]')?.dataset.shopMinus;
  const id = addId || removeId;
  if (!id || !SHOP_ITEMS.some((item) => item.id === id)) return;
  shopCart[id] = Math.max(0, (shopCart[id] || 0) + (addId ? 1 : -1));
  if (!shopCart[id]) delete shopCart[id];
  renderMall();
});
$('mallCheckout').addEventListener('click', () => {
  const total = SHOP_ITEMS.reduce((sum, item) => sum + item.price * (shopCart[item.id] || 0), 0);
  if (!total || total > shopWallet) return renderMall();
  shopWallet -= total;
  const purchased = SHOP_ITEMS.filter((item) => shopCart[item.id]).map((item) => {
    shopInventory[item.id] = (shopInventory[item.id] || 0) + shopCart[item.id];
    return shopCart[item.id] + '× ' + item.name;
  }).join(', ');
  shopCart = {};
  saveShopWallet();
  renderMall();
  $('mallMessage').textContent = 'Purchase complete: ' + purchased + '. Enjoy your shopping!';
  showToast('Shopping complete! Your items are in your virtual bag.');
});
renderMall();
$('wardrobeToggle').addEventListener('click', () => {
  const willOpen = $('wardrobePanel').classList.contains('hidden');
  $('activitiesPanel').classList.add('hidden');
  $('wardrobePanel').classList.toggle('hidden', !willOpen);
});
$('wardrobeClose').addEventListener('click', () => $('wardrobePanel').classList.add('hidden'));
$('applyOutfit').addEventListener('click', () => {
  const outfit = {
    style: $('outfitStyle').value,
    color: $('outfitColor').value,
    accessory: $('outfitAccessory').value
  };
  socket.emit('player:outfit', { outfit }, (response) => {
    if (!response?.ok) return showToast(response?.error || 'Could not change your outfit.');
    currentOutfit = response.outfit;
    $('wardrobePanel').classList.add('hidden');
    showToast('Fresh look! Everyone can see your new outfit.');
  });
});

function nearestBedroomBed(local) {
  if (!local || currentZone !== 'penthouse') return null;
  const beds = [
    { id: 'bed-one', x: -5.15, z: -5.2 },
    { id: 'bed-two', x: 4.05, z: -5.2 }
  ];
  return beds.map((bed) => ({ ...bed, distance: Math.hypot(local.position.x - bed.x, local.position.z - bed.z) }))
    .sort((a, b) => a.distance - b.distance)[0] || null;
}

function updateActivityControls(nextPlayers = players) {
  if (!$('sleepButton')) return;
  const me = nextPlayers.find((player) => player.id === selfId);
  const local = world?.playerObjects.get(selfId);
  const nearBed = nearestBedroomBed(local);
  const action = local?.userData.action ?? me?.action ?? 'none';
  $('sleepButton').textContent = action === 'sleep' ? 'Wake up' : 'Sleep on nearby bed';
  $('sleepButton').disabled = action !== 'sleep' && (!nearBed || nearBed.distance > 3.5 || Boolean(activeVehicleId));
  $('danceButton').textContent = action === 'dance' ? 'Change dance' : 'Start dancing';
  $('stopActivityButton').classList.toggle('hidden', action === 'none');
  $('activityHint').textContent = action === 'sleep'
    ? 'Resting on the bed. Choose Wake up or move with WASD.'
    : action === 'dance'
      ? 'Your dance is visible to everyone in this room. Choose another style or stop.'
      : nearBed && nearBed.distance <= 3.5
        ? 'You are close to a bed. Press Sleep to lie down.'
        : 'Walk close to either bedroom bed to sleep. Dancing works anywhere on the map.';
}

function setPlayerActivity(action, danceStyle = 'groove') {
  if (!activeRoomId) return showToast('Join a penthouse first.');
  socket.emit('player:action', { action, danceStyle }, (response) => {
    if (!response?.ok) return showToast(response?.error || 'Could not change activity.');
    if (response.players) {
      players = response.players;
      updatePlayers(players);
    }
    if (response.position) lastSentPosition = response.position;
    showToast(action === 'sleep' ? 'Good night. Sweet dreams ♡' : action === 'dance' ? 'Let’s dance! Everyone can see you.' : 'Activity stopped.');
    updateActivityControls(players);
  });
}

$('activitiesToggle').addEventListener('click', () => {
  const willOpen = $('activitiesPanel').classList.contains('hidden');
  $('wardrobePanel').classList.add('hidden');
  $('activitiesPanel').classList.toggle('hidden', !willOpen);
});
$('activitiesClose').addEventListener('click', () => $('activitiesPanel').classList.add('hidden'));
$('sleepButton').addEventListener('click', () => {
  const me = players.find((player) => player.id === selfId);
  const local = world?.playerObjects.get(selfId);
  const action = local?.userData.action ?? me?.action ?? 'none';
  setPlayerActivity(action === 'sleep' ? 'none' : 'sleep');
});
$('danceButton').addEventListener('click', () => setPlayerActivity('dance', $('danceStyle').value));
$('stopActivityButton').addEventListener('click', () => setPlayerActivity('none'));

function syncWardrobeControls(outfit) {
  if (!outfit) return;
  currentOutfit = { ...currentOutfit, ...outfit };
  $('outfitStyle').value = currentOutfit.style || 'cozy';
  $('outfitColor').value = currentOutfit.color || 'cream';
  $('outfitAccessory').value = currentOutfit.accessory || 'none';
}

function setupMobileControls() {
  const controls = $('mobileControls');
  const joystick = $('mobileJoystick');
  const thumb = $('joystickThumb');
  if (!controls || !joystick || !thumb) return;
  document.body.classList.toggle('mobile-device', MOBILE_DEVICE);
  controls.classList.toggle('hidden', !MOBILE_DEVICE);
  if (!MOBILE_DEVICE || joystick.dataset.ready === 'true') return;
  joystick.dataset.ready = 'true';

  const directions = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  const clearJoystick = () => {
    directions.forEach((key) => moveKeys.delete(key));
    thumb.style.transform = 'translate(0, 0)';
  };
  const updateJoystick = (event) => {
    const rect = joystick.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const max = rect.width * .34;
    let dx = event.clientX - centerX;
    let dy = event.clientY - centerY;
    const distance = Math.hypot(dx, dy);
    if (distance > max) { dx = dx / distance * max; dy = dy / distance * max; }
    thumb.style.transform = `translate(${dx}px, ${dy}px)`;
    directions.forEach((key) => moveKeys.delete(key));
    if (Math.abs(dx) > max * .2) moveKeys.add(dx < 0 ? 'KeyA' : 'KeyD');
    if (Math.abs(dy) > max * .2) moveKeys.add(dy < 0 ? 'KeyW' : 'KeyS');
  };
  joystick.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    joystick.setPointerCapture?.(event.pointerId);
    updateJoystick(event);
  });
  joystick.addEventListener('pointermove', (event) => {
    if (joystick.hasPointerCapture?.(event.pointerId)) updateJoystick(event);
  });
  const release = (event) => {
    if (joystick.hasPointerCapture?.(event.pointerId)) joystick.releasePointerCapture(event.pointerId);
    clearJoystick();
  };
  joystick.addEventListener('pointerup', release);
  joystick.addEventListener('pointercancel', release);
  joystick.addEventListener('lostpointercapture', clearJoystick);

  $('mobileInteract')?.addEventListener('click', toggleCar);
  $('mobileElevator')?.addEventListener('click', travelElevator);
  $('mobileActivities')?.addEventListener('click', () => {
    $('wardrobePanel').classList.add('hidden');
    $('activitiesPanel').classList.toggle('hidden');
  });
}

window.addEventListener('keydown', (event) => {
  const target = document.activeElement;
  const typing = target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
  if (!activeRoomId || typing) return;
  if (event.repeat && (event.code === 'KeyE' || event.code === 'KeyF')) return;
  if (event.code === 'KeyE') {
    event.preventDefault();
    toggleCar();
    return;
  }
  if (event.code === 'KeyF') {
    event.preventDefault();
    travelElevator();
    return;
  }
  if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)) {
    event.preventDefault();
    moveKeys.add(event.code);
  }
});
window.addEventListener('keyup', (event) => moveKeys.delete(event.code));
window.addEventListener('blur', () => moveKeys.clear());

// ---------------------------- YouTube shared TV ----------------------------
function setupYoutubePlayer() {
  if (youtubeReady) return;
  try {
    youtube = new window.YT.Player('youtubePlayer', {
      width: '100%',
      height: '100%',
      videoId: '',
      playerVars: {
        autoplay: 0,
        controls: 1,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        enablejsapi: 1,
        origin: window.location.origin,
        widget_referrer: window.location.href
      },
      events: {
        onReady: () => {
          youtubeReady = true;
          const iframe = youtube.getIframe?.();
          if (iframe) {
            iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
          }
          if (pendingYoutubeState?.videoId) {
            const pending = pendingYoutubeState;
            pendingYoutubeState = null;
            applyInitialYoutubeState(pending);
          }
        },
        onStateChange: onYoutubeStateChange,
        onError: (event) => {
          const messages = {
            2: 'That YouTube link is invalid. Try a different video.',
            5: 'YouTube could not decode this video in the embedded player.',
            100: 'This YouTube video was removed or is private.',
            101: 'The owner does not allow this video to play inside other websites.',
            150: 'The owner does not allow this video to play inside other websites.',
            153: 'YouTube blocked the embed because browser referrer information was unavailable. Refresh the page and try again.'
          };
          showYoutubeTapToPlay(true);
          showToast(messages[event.data] || 'YouTube could not play that video. Try another one.');
        }
      }
    });
  } catch (_error) {
    showToast('The YouTube player could not load. Check your connection.');
  }
}

window.onYouTubeIframeAPIReady = setupYoutubePlayer;
if (window.YT && window.YT.Player) setupYoutubePlayer();

function extractYoutubeId(value) {
  const raw = String(value || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (host.endsWith('youtube.com') || host === 'youtube-nocookie.com') {
      if (url.searchParams.get('v')) return url.searchParams.get('v');
      const parts = url.pathname.split('/').filter(Boolean);
      const marker = parts.findIndex((part) => ['embed', 'shorts', 'live', 'v'].includes(part));
      if (marker >= 0) return parts[marker + 1] || '';
    }
  } catch (_error) {
    return '';
  }
  return '';
}

const SAVED_PLAYLISTS_KEY = 'tom-grace-saved-youtube-playlists';
let savedPlaylists = loadSavedPlaylists();
let playlistDraft = [];

function loadSavedPlaylists() {
  try {
    const value = JSON.parse(localStorage.getItem(SAVED_PLAYLISTS_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item) => item && typeof item.name === 'string' && Array.isArray(item.tracks)) : [];
  } catch (_error) { return []; }
}

function persistSavedPlaylists() {
  localStorage.setItem(SAVED_PLAYLISTS_KEY, JSON.stringify(savedPlaylists));
  renderSavedPlaylists();
}

function renderSavedPlaylists() {
  const select = $('savedPlaylistSelect');
  const list = $('savedPlaylistList');
  if (!select || !list) return;
  const selected = select.value;
  select.innerHTML = '<option value="">Your saved playlists</option>';
  list.innerHTML = '';
  savedPlaylists.forEach((playlist, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${playlist.name} · ${playlist.tracks.length} tracks`;
    select.appendChild(option);
    const item = document.createElement('div');
    item.className = 'saved-playlist-item';
    const label = document.createElement('span');
    label.textContent = `${playlist.name} (${playlist.tracks.length})`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'saved-playlist-delete';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete ${playlist.name}`);
    remove.addEventListener('click', () => {
      savedPlaylists.splice(index, 1);
      persistSavedPlaylists();
    });
    item.append(label, remove);
    list.appendChild(item);
  });
  if (selected && savedPlaylists[Number(selected)]) select.value = selected;
  if (!savedPlaylists.length) list.innerHTML = '<div class="music-queue-empty">No saved playlists yet.</div>';
}

function renderMusicQueue(state = {}) {
  musicQueue = Array.isArray(state.queue) ? state.queue : [];
  musicIndex = Number.isInteger(state.currentIndex) ? state.currentIndex : -1;
  const current = musicQueue[musicIndex];
  $('musicNowPlaying').textContent = current
    ? `Now sharing track ${musicIndex + 1} of ${musicQueue.length}. Everyone in this room gets the same queue.`
    : 'Add songs, save a playlist, then play it anytime.';
  const list = $('musicQueueList');
  list.innerHTML = '';
  if (!musicQueue.length) list.innerHTML = '<div class="music-queue-empty">The shared room queue is empty.</div>';
  musicQueue.forEach((track, index) => {
    const item = document.createElement('div');
    item.className = `music-queue-item${index === musicIndex ? ' active' : ''}`;
    item.textContent = `${index === musicIndex ? '▶ ' : ''}Track ${index + 1} · added by ${track.addedBy || 'player'}`;
    list.appendChild(item);
  });
  $('musicNextButton').disabled = musicIndex < 0 || musicIndex >= musicQueue.length - 1;
}

function sendPlaylistToRoom(tracks, button) {
  if (!tracks.length) return showToast('This playlist has no tracks yet.');
  if (tracks.length > 50) return showToast('A shared playlist can contain up to 50 tracks.');
  if (!activeRoomId) return showToast('Join a room before playing a playlist.');
  button.disabled = true;
  socket.emit('music:queue:replace', { videoIds: tracks }, (response) => {
    button.disabled = false;
    if (!response?.ok) return showToast(response?.error || 'Could not share this playlist.');
    renderMusicQueue(response.queue || {});
    showToast('Playlist shared with everyone in the room ♫');
  });
}

function addMusicToQueue() {
  const videoId = extractYoutubeId($('musicInput').value);
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return showToast('Please paste a valid YouTube video link.');
  if (playlistDraft.length >= 50) return showToast('A playlist can contain up to 50 tracks.');
  playlistDraft.push(videoId);
  $('musicInput').value = '';
  $('musicNowPlaying').textContent = `${playlistDraft.length} track(s) in your playlist draft. Save it or add more songs.`;
  showToast('Track added to your playlist draft.');
}

$('musicAddButton').addEventListener('click', addMusicToQueue);
$('musicInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') addMusicToQueue(); });
$('savePlaylistButton').addEventListener('click', () => {
  const name = $('playlistNameInput').value.trim().slice(0, 40);
  if (!name) return showToast('Give your playlist a name first.');
  if (!playlistDraft.length) return showToast('Add at least one YouTube track first.');
  savedPlaylists.push({ name, tracks: [...playlistDraft] });
  playlistDraft = [];
  $('playlistNameInput').value = '';
  persistSavedPlaylists();
  showToast('Playlist saved on this device ♡');
});
$('playSavedPlaylistButton').addEventListener('click', () => {
  const playlist = savedPlaylists[Number($('savedPlaylistSelect').value)];
  if (!playlist) return showToast('Choose one of your saved playlists first.');
  sendPlaylistToRoom(playlist.tracks, $('playSavedPlaylistButton'));
});
$('musicNextButton').addEventListener('click', () => {
  $('musicNextButton').disabled = true;
  socket.emit('music:next', {}, (response) => {
    if (!response?.ok) showToast(response?.error || 'Could not play the next track.');
  });
});
renderSavedPlaylists();

function showYoutubeTapToPlay(show = true) {
  const button = $('youtubeTapToPlay');
  if (button) button.classList.toggle('hidden', !show);
}

function loadYoutubeVideo(videoId, remote) {
  $('tvPlaceholder').classList.add('hidden');
  if (!youtubeReady || !youtube) {
    pendingYoutubeState = { videoId, isPlaying: false, currentTime: 0 };
    showYoutubeTapToPlay(true);
    return;
  }
  // Cue first: a Socket.IO round-trip is not a browser user gesture, so autoplay
  // is commonly blocked. Each player gets a clear, one-tap Play control.
  youtubeSyncGuard = Boolean(remote);
  youtube.cueVideoById({ videoId, startSeconds: 0 });
  showYoutubeTapToPlay(true);
  setTimeout(() => { youtubeSyncGuard = false; }, 1200);
}

function applyInitialYoutubeState(state) {
  if (!state?.videoId) return;
  $('tvPlaceholder').classList.add('hidden');
  if (!youtubeReady || !youtube) {
    pendingYoutubeState = state;
    showYoutubeTapToPlay(true);
    return;
  }
  const seconds = Math.max(0, Number(state.currentTime) || 0);
  youtubeSyncGuard = true;
  youtube.cueVideoById({ videoId: state.videoId, startSeconds: seconds });
  showYoutubeTapToPlay(true);
  setTimeout(() => { youtubeSyncGuard = false; }, 1400);
}

function applyRemoteYoutubePlayback(isPlaying, currentTime) {
  if (!youtubeReady || !youtube) return;
  youtubeSyncGuard = true;
  const seconds = Math.max(0, Number(currentTime) || 0);
  youtube.seekTo(seconds, true);
  if (isPlaying) youtube.playVideo();
  else youtube.pauseVideo();
  setTimeout(() => { youtubeSyncGuard = false; }, 900);
}

function onYoutubeStateChange(event) {
  $('tvPlaceholder').classList.add('hidden');
  if (event.data === window.YT.PlayerState.PLAYING) showYoutubeTapToPlay(false);
  else if ([window.YT.PlayerState.CUED, window.YT.PlayerState.PAUSED, window.YT.PlayerState.ENDED].includes(event.data)) showYoutubeTapToPlay(true);
  if (youtubeSyncGuard || !activeRoomId || !youtube) return;
  const state = event.data;
  if (state === window.YT.PlayerState.PLAYING || state === window.YT.PlayerState.PAUSED || state === window.YT.PlayerState.ENDED) {
    const isPlaying = state === window.YT.PlayerState.PLAYING;
    socket.emit('youtube:playback', { isPlaying, currentTime: youtube.getCurrentTime() || 0 });
  }
}

$('youtubeTapToPlay').addEventListener('click', () => {
  if (!youtubeReady || !youtube) {
    showToast('YouTube is still loading. Please try again in a moment.');
    return;
  }
  showYoutubeTapToPlay(false);
  youtube.playVideo();
});

setInterval(() => {
  if (!activeRoomId || !youtubeReady || !youtube || youtube.getPlayerState?.() !== 1) return;
  if (Date.now() - lastYoutubeSyncAt < 4800) return;
  lastYoutubeSyncAt = Date.now();
  socket.emit('youtube:playback', { isPlaying: true, currentTime: youtube.getCurrentTime() || 0 });
}, 1000);

// ---------------------------- Spotify: direct links + official embed ----------------------------
function openSpotifyHome() {
  window.open('https://open.spotify.com/', '_blank', 'noopener,noreferrer');
  $('spotifyMessage').textContent = 'Sign in on Spotify in the new tab, then return here to load a music link.';
}

function searchSpotify() {
  const query = $('spotifySearch').value.trim();
  if (!query) return showToast('Type a song, artist or playlist to search.');
  const url = `https://open.spotify.com/search/${encodeURIComponent(query)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
  $('spotifyMessage').textContent = 'Spotify search opened in a new tab. Copy a song or playlist link and paste it below.';
}

function parseSpotifyLink(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const uriMatch = raw.match(/^spotify:(track|album|playlist|artist|show|episode):([A-Za-z0-9]+)$/i);
  if (uriMatch) return { type: uriMatch[1].toLowerCase(), id: uriMatch[2] };
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!['open.spotify.com', 'spotify.com'].includes(host)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const index = parts.findIndex((part) => ['track', 'album', 'playlist', 'artist', 'show', 'episode'].includes(part.toLowerCase()));
    if (index < 0 || !parts[index + 1]) return null;
    const type = parts[index].toLowerCase();
    const id = parts[index + 1];
    if (!/^[A-Za-z0-9]+$/.test(id)) return null;
    return { type, id };
  } catch (_error) {
    return null;
  }
}

function loadSpotifyEmbed() {
  const parsed = parseSpotifyLink($('spotifyLink').value);
  if (!parsed) {
    $('spotifyMessage').textContent = 'That link was not recognized. Paste a Spotify track, album, playlist, artist or podcast URL.';
    showToast('Please paste a valid open.spotify.com music link.');
    return;
  }
  const mount = $('spotifyEmbedMount');
  mount.replaceChildren();
  const iframe = document.createElement('iframe');
  iframe.title = 'Spotify music player';
  iframe.src = `https://open.spotify.com/embed/${parsed.type}/${parsed.id}?utm_source=generator&theme=0`;
  iframe.width = '100%';
  iframe.height = parsed.type === 'track' || parsed.type === 'episode' ? '152' : '352';
  iframe.style.border = '0';
  iframe.style.borderRadius = '12px';
  iframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
  iframe.allowFullscreen = true;
  iframe.loading = 'lazy';
  mount.appendChild(iframe);
  const canonicalLink = `https://open.spotify.com/${parsed.type}/${parsed.id}`;
  $('spotifyOpenLink').href = canonicalLink;
  $('spotifyOpenLink').classList.remove('hidden');
  $('spotifyMessage').textContent = 'Player loaded. Sign in with Spotify if prompted, then use the player controls below.';
  try { localStorage.setItem('tg_last_spotify_link', canonicalLink); } catch (_error) { /* storage can be disabled */ }
}

$('spotifyConnect').addEventListener('click', openSpotifyHome);
$('spotifySearchButton').addEventListener('click', searchSpotify);
$('spotifySearch').addEventListener('keydown', (event) => { if (event.key === 'Enter') searchSpotify(); });
$('spotifyLoad').addEventListener('click', loadSpotifyEmbed);
$('spotifyLink').addEventListener('keydown', (event) => { if (event.key === 'Enter') loadSpotifyEmbed(); });
$('spotifyOpenLink').addEventListener('click', (event) => {
  if (!event.currentTarget.href || event.currentTarget.href === window.location.href) event.preventDefault();
});
try {
  const lastSpotifyLink = localStorage.getItem('tg_last_spotify_link');
  if (lastSpotifyLink) $('spotifyLink').value = lastSpotifyLink;
} catch (_error) { /* storage can be disabled */ }

window.addEventListener('beforeunload', () => {
  if (world) window.removeEventListener('resize', world.resizeHandler);
  socket.disconnect();
});
