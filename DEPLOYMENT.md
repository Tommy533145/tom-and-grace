# Deploy Tom&Grace on Render

This repository includes a Render Blueprint. The full application source is stored in numbered Base64 bundle parts and is unpacked by `prepare.js` during the build.

## Deploy

1. Sign in to Render with the GitHub account that owns this repository.
2. Open the Render Dashboard and choose **New > Blueprint**.
3. Select the `Tommy533145/tom-and-grace` repository and the `main` branch.
4. Review the service named `tom-and-grace`, then apply the Blueprint.
5. Wait for the build and deployment to finish. Open the generated HTTPS URL.
6. Visit `/health` on that URL; it should return JSON with `ok: true`.

The build installs dependencies and then runs `node prepare.js`, which extracts the game files into the service root. The server starts with `npm start`.

## Important notes

- Use the generated HTTPS site URL when sharing invitation links. WebSocket connections use the same origin.
- Browser microphone permission is required for voice chat. Some networks may need TURN credentials configured in `public/config.js`.
- The Spotify flow is based on Spotify embeds and links; availability and full playback depend on Spotify, the track, browser and account.
- Room state is currently in memory. Restarting/redeploying the service clears active rooms and chat history.
