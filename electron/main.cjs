const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const START_PAGE = path.join(__dirname, 'start.html');
const PRELOAD = path.join(__dirname, 'preload.cjs');
const CONFIG_FILE = path.join(app.getPath('userData'), 'connection.json');

function readSavedUrl() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return typeof saved.url === 'string' ? saved.url : '';
  } catch (_error) {
    return '';
  }
}

function validateGameUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch (_error) {
    throw new Error('Enter a valid game address, such as https://your-game.onrender.com');
  }
  const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !localHttp) {
    throw new Error('For safety, use an HTTPS game address. HTTP is allowed only for localhost.');
  }
  return parsed.toString().replace(/\/$/, '');
}

function createGameWindow(url) {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#101116',
    autoHideMenuBar: true,
    title: 'Tom&Grace',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url: target }) => {
    try {
      const parsed = new URL(target);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') shell.openExternal(target);
    } catch (_error) {}
    return { action: 'deny' };
  });
  window.loadURL(url);
  return window;
}

function createStartWindow() {
  const window = new BrowserWindow({
    width: 560,
    height: 520,
    resizable: false,
    autoHideMenuBar: true,
    title: 'Connect to Tom&Grace',
    backgroundColor: '#101116',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.loadFile(START_PAGE);
  return window;
}

ipcMain.handle('tom-grace:connect', async (event, value) => {
  const url = validateGameUrl(value);
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ url }, null, 2), 'utf8');
  createGameWindow(url);
  const startWindow = BrowserWindow.fromWebContents(event.sender);
  if (startWindow && !startWindow.isDestroyed()) startWindow.close();
  return { ok: true };
});

app.whenReady().then(() => {
  const savedUrl = readSavedUrl();
  if (savedUrl) {
    try {
      createGameWindow(validateGameUrl(savedUrl));
      return;
    } catch (_error) {}
  }
  createStartWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createStartWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
