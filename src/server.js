import cors from 'cors';
import dns from 'dns';
import 'dotenv/config';
import express from 'express';
import http from 'http';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { handleLiveConnection } from './live.js';
import transcriptionRoutes from './routes/transcriptions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

dns.setServers([
  '8.8.8.8',
  '1.1.1.1'
]);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: mongoose.connection.readyState === 1 });
});
app.use('/api/transcriptions', transcriptionRoutes);
app.use(express.static(path.join(__dirname, '../public')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/live' });
wss.on('connection', handleLiveConnection);

await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/speech_to_text');
console.log('MongoDB connected');
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
