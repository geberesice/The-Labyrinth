// Your own meerkat "signalling" server, in case the free PeerJS cloud server is down or blocked.
// It only introduces players to each other; the game itself goes directly between browsers.
//
//   npm run peer-server            (port 9000)
//   PORT=9000 npm run peer-server
//
// Then open the game with ?peer=your-computer:9000 (or set it in the game's settings).
import http from 'node:http';
import express from 'express';
import { ExpressPeerServer } from 'peer';

const port = Number(process.env.PORT) || 9000;
const app = express();
const server = http.createServer(app);
app.get('/', (_req, res) => res.type('text').send('Meerkat Labyrinth peer server is running.\n'));
app.use('/', ExpressPeerServer(server, { path: '/', allow_discovery: false }));
server.listen(port, '0.0.0.0', () => console.log(`Meerkat peer server on port ${port}`));
