import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load server/.env only (won't exist on Vercel — env vars come from dashboard)
const serverEnv = path.join(__dirname, '../.env');

if (existsSync(serverEnv)) dotenv.config({ path: serverEnv });
