# Tom&Grace — Shared Music Room Edition 1.5

A multiplayer 3D social-house world built with Three.js, Express and Socket.IO. Players share rooms, movement, chat, activities, voice signaling, and a synchronized YouTube music queue, with Spotify available for private listening.

## What's included

- A cutaway 3D luxury penthouse with living room, kitchen/dining area, two bedrooms, hallway, bathroom and rooftop terrace with an infinity pool.
- A walkable city promenade connected by elevator, with shops, mid-rise buildings, a fountain plaza, trees, benches and street lamps.
- Two drivable 3D cars. Walk close to a parked car and press **E** to enter; use **WASD / arrow keys** to drive; press **E** again to leave.
- Character selection: Tom, Grace, Alex and Riley.
- Wardrobe with outfit styles, colors and accessories; changes are shared with the room.
- Private invite-link rooms for up to eight players.
- Live player movement, facing direction, outfits, activities and car movement synchronized through Socket.IO.
- Room-wide chat, with recent messages retained while the room exists.
- Optional proximity voice chat using browser microphone permissions and peer-to-peer WebRTC audio.
- **Sleep interaction:** walk close to either bedroom bed, open Activities and choose **Sleep on nearby bed**. The character lies down on the bed and other players see the sleeping animation. Choose **Wake up** or start moving to get up.
- **Dance animations:** choose Easy groove, Disco, Salsa, Happy bounce or Slow sway. Other players see the same dance. Choose Stop activity or move with WASD to stop dancing.
- Shared YouTube TV: paste a YouTube URL or video ID; video selection and playback position are synchronized.
- **Simplified Spotify:** no Spotify Developer Client ID, Spotify dashboard registration or app-specific OAuth setup. Open Spotify directly to sign in, search for a song/album/playlist, copy its Spotify link, and paste it into Tom&Grace to load the official Spotify embed. Playback and controls remain personal to each player.

## Requirements

- Node.js 18 or newer
- Internet connection for Three.js, YouTube, Spotify and online fonts/media
- A modern desktop browser such as Chrome or Edge; microphone use requires localhost or HTTPS

## Run locally on Windows, macOS or Linux

1. Extract the ZIP.
2. Open a terminal in the `tom-and-grace` folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the app:

   ```bash
   npm start
   ```

5. Open `http://localhost:3000`.
6. Choose a character and create a penthouse.
7. Press **Invite friends** and share the generated URL. Another person opens the link and chooses their own character.

### Test multiplayer in two local browser sessions

1. Start the server once with `npm start`.
2. Open `http://localhost:3000` in Chrome and create a house.
3. Copy the invitation link.
4. Open an Incognito window or a second browser (Edge/Firefox) and paste the invite link.
5. Select a different character and join.
6. Check movement, chat, wardrobe, sleep, dancing, cars, shared YouTube and voice signaling. For voice testing, allow microphone access on both sessions. For realistic echo/voice tests, use two separate devices with headphones.

A dependency-free server behavior test is included and can be run with `npm run test:smoke`. It uses two simulated Socket.IO clients to verify room joining, chat, voice signaling, sleep/dance synchronization and elevator transitions. It is not a replacement for a live two-browser test.

## Controls

| Control | Action |
|---|---|
| W / A / S / D | Walk around the penthouse/city or drive |
| Arrow keys | Alternative movement / driving controls |
| E | Enter a nearby free car or exit the car |
| F | Use the elevator when standing beside its doors |
| Wardrobe | Change outfit style, color and accessory |
| Activities → Sleep | Sleep when close to either bedroom bed; Wake up to get up |
| Activities → Dance | Choose Groove, Disco, Salsa, Bounce or Sway |
| Stop activity | Stop sleeping/dancing; movement also cancels the activity |
| Join voice | Request microphone permission and enter proximity voice chat |
| Mute mic | Mute/unmute your microphone while remaining able to hear nearby players |
| Left mouse drag | Rotate the 3D camera |
| Mouse wheel | Zoom camera in and out |

## Shared Music Room

- Add a YouTube video link or 11-character video ID to the **Shared Music Room** queue.
- Everyone in the same room receives the same queue, current selection, and synchronized playback state.
- Any room member can add a track, choose a queued track, or play the next track. The queue is limited to 50 items per room.
- A newly joined player receives the current queue and playback state.
- YouTube may require each player to tap play once because browser autoplay policies differ. Some videos disable embedded playback and cannot play inside the game.
- The room queue is held in server memory and resets when the room is empty or the server restarts.

## Personal Spotify (separate from shared music)

1. Press **Open Spotify & sign in** to open Spotify in a separate browser tab.
2. Use the Spotify search field to open a search in Spotify, or search directly in the Spotify app.
3. Copy a track, album, playlist, artist or podcast link and paste it into the personal Spotify field.
4. Press **Load** to use Spotify's official embedded player for your own listening.

This uses Spotify's official embeds and does not use the Web Playback SDK or Spotify Web API, so no Spotify Developer Client ID is needed. Spotify decides which playback experience is available for the listener, account, content and browser. Spotify remains personal: its audio and controls are not broadcast or synchronized to other players. Use the Shared Music Room YouTube queue when everyone should hear the same room music.



## Voice chat

Voice is optional and starts only after a player clicks **Join voice** and grants microphone access. Each player who wants to talk should also join. Click **Mute mic** to mute your microphone while continuing to hear nearby players. Use HTTPS after deployment; `http://localhost:3000` is allowed for local development. A public STUN server is used by default. For restrictive networks, add temporary TURN credentials to `public/config.js` using `VOICE_TURN_URL`, `VOICE_TURN_USERNAME` and `VOICE_TURN_CREDENTIAL`. For larger rooms, a dedicated SFU is recommended over peer-to-peer mesh.

## Deploy online with EthioDeploy (free, no card)

EthioDeploy is the selected alternative for the first hosted test. Its published free plan supports Node.js/Express, Socket.IO WebSockets, HTTPS, one project, and a managed database option without a credit card. The free web service has 256 MB RAM, 0.5 CPU, and sleeps after 30 minutes without traffic; the first visitor after idle may wait for it to wake. This is suitable for a small test, not a guaranteed always-on worldwide production launch. See the [EthioDeploy Node.js guide](https://ethiodeploy.com/deploy/nodejs) and [Express/Socket.IO guide](https://ethiodeploy.com/deploy/express).

1. Open [EthioDeploy](https://ethiodeploy.com/) and sign in with GitHub.
2. Install its GitHub App and grant access only to the `Tommy533145/tom-and-grace` repository.
3. Choose **New Project** and select this repository. The Free plan does not include branch previews, so it deploys the repository's default branch. The worldwide Windows-client and Shared Music Room 1.5 changes are on `main`. EthioDeploy deploys new commits from the default branch automatically after the build and health check pass. Verify the latest deployment in the EthioDeploy dashboard before sharing the live URL; a successful GitHub build does not itself prove the hosted game has updated.
4. Confirm the detected Node.js service uses `npm install` and `npm start`. The app already reads `process.env.PORT`, binds to `0.0.0.0`, and exposes `/health`.
5. Wait for the health check to pass, then open the generated HTTPS `.ethiodeploy.app` URL and verify `/health` returns JSON with `"ok": true`.
6. Use that real URL in the Windows launcher on first launch. Share browser invite links only after the URL has been tested.

EthioDeploy deploys from GitHub after you authorize its GitHub App. I cannot sign in to your account or grant repository access on your behalf. Do not share your GitHub password or access token in chat.

## Current prototype limitations

- Room state and chat history are stored in server memory. Restarting the service clears active rooms and chat. Use a database/Redis adapter before scaling or deploying multiple server instances.
- Voice uses peer-to-peer mesh signaling. Large rooms or restrictive networks need TURN/SFU infrastructure for production reliability.
- Spotify embeds are personal players. They do not relay one player's audio to the others or synchronize playback.
- YouTube videos that disallow embedding cannot play in the in-game TV.
- Full browser-to-browser testing must be done after installing dependencies and opening two local browser sessions; the project archive includes test instructions.

## Project structure

```text
tom-and-grace/
├── server.js
├── package.json
├── render.yaml
├── README.md
└── public/
    ├── index.html
    ├── style.css
    ├── config.js  # optional TURN settings only; no Spotify ID
    └── app.js
```

 
## Worldwide-ready launch and Windows desktop edition

The browser game remains the primary cross-platform way to play. Players can join from a modern browser without installing anything. The Windows installer is an optional desktop launcher that opens the same hosted multiplayer game, so desktop and browser players share rooms and invites.

### Windows installer
- Build on Windows with `npm install` followed by `npm run build:win`.
- The installer is generated in `dist/` as `TomAndGrace-Setup-1.5.0.exe`.
- GitHub Actions can build it from **Actions → Build Tom&Grace Windows installer** or when a `v*` release tag is pushed.
- On first launch, enter the real HTTPS address of the deployed game server. The Windows app saves it securely in the local app-data folder so players do not need to enter it again.

### Regional server discovery
- `/api/regions` advertises the current server plus any configured regional servers.
- `REGION_ID`, `REGION_NAME`, and `PUBLIC_BASE_URL` identify the current deployment.
- `REGION_DIRECTORY_JSON` may contain a JSON array of `{ "id", "name", "url" }` entries. All region URLs must use HTTPS.
- The lobby measures server health latency and supports automatic or manual region choice. Invite links stay on the host region so friends in other countries can join the same room.

Example directory value (replace with actual deployed service URLs):
`[{"id":"asia","name":"Asia (Singapore)","url":"https://YOUR-ASIA-SERVICE.ethiodeploy.app"},{"id":"europe","name":"Europe (Frankfurt)","url":"https://YOUR-EUROPE-SERVICE.ethiodeploy.app"},{"id":"north-america","name":"North America (Ohio)","url":"https://YOUR-NORTH-AMERICA-SERVICE.ethiodeploy.app"}]`

### Launch limits and next production steps
The first deployment is a single global room server; players worldwide can join the same invite room, but latency depends on distance to that server. Do not advertise regional choices until the corresponding services are actually deployed and their URLs are configured. Room state currently lives in server memory, so multiple instances/regions do not share public rooms or persistent profiles. Before running several active regions, add a shared Redis Socket.IO adapter and persistent room/account storage. Voice is browser peer-to-peer mesh; TURN credentials improve connectivity and an SFU is recommended for larger groups. Free hosting is for an initial test and can sleep when idle.

## Windows desktop launcher

The Windows installer is built by GitHub Actions when the configured workflow runs successfully. The desktop launcher is a lightweight secure Electron client for the hosted multiplayer game; it does not bundle a local multiplayer server.

1. Download the `TomAndGrace-Setup-1.4.0.exe` artifact from the successful **Build Tom&Grace Windows installer** workflow run (or the release asset when a versioned release is published).
2. Install and open Tom&Grace.
3. On first launch, enter the HTTPS URL of the deployed Tom&Grace server. The launcher remembers this address on that Windows PC.
4. If the server has not been deployed yet, the installer can still be built, but players cannot enter the shared world until a reachable server URL exists.

For local development, `http://localhost:3000` is accepted by the desktop launcher. Remote plain-HTTP URLs are rejected.

## Regional and multiplayer deployment status

Regional selection is discovery and routing support, not automatic multi-region replication. A region must first be deployed and its real HTTPS URL added to `REGION_DIRECTORY_JSON`. Invite rooms are pinned to their selected server. The current room map is in process memory, so a room exists only on the server instance that created it; players in different regions cannot share the same room until shared room state and a Socket.IO adapter are implemented. User accounts, friends and long-term progress are not yet backed by persistent storage.

The repository still contains `render.yaml` as an optional Render configuration, but Render account billing verification blocked the previous attempt. EthioDeploy is the selected no-card test host. Do not assume a public game URL exists until its deployment completes and its `/health` endpoint has been checked.


## Shared Music Room implementation (1.5)

The shared music room uses the synchronized YouTube player rather than relaying Spotify audio. The server owns each room's queue (up to 50 validated YouTube video IDs), current queue index, and playback state. Queue additions, track selection, next-track actions, and queue snapshots are broadcast to all members of the same room. The Spotify embed remains a separate, personal listening option. Shared queues are in-memory and are not persisted across server restarts.
