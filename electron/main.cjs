// Desktop app: opens the game (the built dist/ folder) in its own window.
const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The game is served from app://game/ so it behaves like a normal website:
// sound files load, saved levels persist, and online play works.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const DIST = path.join(__dirname, '..', 'dist');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    title: 'The Labyrinth',
    backgroundColor: '#1a1220',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL('app://game/index.html');
  // links to websites open in the normal browser, never inside the game window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
  return win;
}

// ---- saving and opening level files (.meerkat) ----

const FILTERS = [{ name: 'Meerkat level', extensions: ['meerkat'] }, { name: 'All files', extensions: ['*'] }];

ipcMain.handle('level:save', async (event, { name, text }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const safe = String(name || 'My Maze').replace(/[\\/:*?"<>|]+/g, '').trim() || 'My Maze';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save level',
    defaultPath: path.join(app.getPath('documents'), `${safe}.meerkat`),
    filters: FILTERS,
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, String(text), 'utf8');
  return path.basename(filePath);
});

ipcMain.handle('level:open', async event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open level',
    defaultPath: app.getPath('documents'),
    filters: FILTERS,
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return null;
  const stat = await fs.stat(filePaths[0]);
  if (stat.size > 1_000_000) throw new Error('That file is too big to be a level.');
  return { name: path.basename(filePaths[0]), text: await fs.readFile(filePaths[0], 'utf8') };
});

// ---- app ----

app.whenReady().then(() => {
  protocol.handle('app', request => {
    let { pathname } = new URL(request.url);
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'Game', submenu: [{ role: 'togglefullscreen' }, { role: 'reload' }, { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'Help', submenu: [{ label: 'Game website', click: () => shell.openExternal('https://github.com/geberesice/The-Labyrinth') }, { role: 'toggleDevTools' }] },
  ]));

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
