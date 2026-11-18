import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import searchHandler from '../api/search.js';
import { isRailCoreConfigured } from './railcore.js';

const app = express();
const port = Number(process.env.PORT || 4100);
const here = path.dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  service: 'SmartRail AI',
  scheduleProviderConfigured: isRailCoreConfigured(),
  customAvailabilityProviderConfigured: Boolean(process.env.RAIL_AVAILABILITY_URL && process.env.RAIL_API_KEY)
}));

app.post('/api/search', searchHandler);

app.listen(port, () => console.log(`SmartRail API listening on ${port} (project: ${here})`));
