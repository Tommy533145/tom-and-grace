# Tom&Grace — Social World Edition 1.3

A multiplayer 3D social-house prototype built with Three.js, Express and Socket.IO. It is designed as a relaxed hangout world: no quests, tasks, timers or scoring.

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

## Spotify without a Client ID

1. Press **Open Spotify & sign in**. Spotify opens in a separate browser tab; sign in there.
2. Use **Search** in Tom&Grace to open Spotify search in a separate tab, or search directly in Spotify.
3. On Spotify, use Share → Copy link for a track, album, playlist, artist or podcast.
4. Paste the copied link into the Spotify link field in Tom&Grace and press **Load**.
5. Use the official embedded Spotify player. If Spotify asks you to sign in again inside the player, follow its prompt or use **Open this music in Spotify**.

This uses Spotify's official embeds and does not use the Web Playback SDK or Spotify Web API, so no Spotify Developer Client ID is needed. Spotify decides which playback experience is available for the listener, account, content and browser. Some embeds may offer previews or prompt the user to open Spotify. Each player controls their own Spotify embed; this does not synchronize music audio between people. The Spotify embed is an official external player, so its appearance and available controls are provided by Spotify.

## Voice chat

Voice is optional and starts only after a player clicks **Join voice** and grants microphone access. Each player who wants to talk should also join. Click **Mute mic** to mute your microphone while continuing to hear nearby players. Use HTTPS after deployment; `http://localhost:3000` is allowed for local development. A public STUN server is used by default. For restrictive networks, add temporary TURN credentials to `public/config.js` using `VOICE_TURN_URL`, `VOICE_TURN_USERNAME` and `VOICE_TURN_CREDENTIAL`. For larger rooms, a dedicated SFU is recommended over peer-to-peer mesh.

## Deploy online with Render

The repository includes `render.yaml` as a Render Blueprint. To publish it:

1. Create a GitHub repository and upload the contents of the extracted `tom-and-grace` folder (the `server.js`, `package.json`, `public/`, and `render.yaml` should be at the repository root).
2. Sign in to Render and connect your GitHub account.
3. In Render, choose **New → Blueprint** and select the repository containing `render.yaml`.
4. Review and create the `tom-and-grace` web service.
5. When the deploy finishes, open the HTTPS `onrender.com` URL and create a room. Send the invite link to another player.

Render web services support WebSockets and HTTPS. The included blueprint uses `npm install`, `npm start` and `/health` for health checks. A free Render instance may spin down after inactivity, so the first request after idle time may take a little longer.

**I cannot publish it into your Render/GitHub accounts from this project archive alone.** You must connect your own GitHub and Render accounts and approve the deploy. The ZIP is ready for that process.

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
