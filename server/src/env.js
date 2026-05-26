import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env files only if they exist (they won't exist on Vercel)
const rootEnv = path.join(__dirname, '../../.env');
const serverEnv = path.join(__dirname, '../.env');

if (existsSync(rootEnv)) dotenv.config({ path: rootEnv });
if (existsSync(serverEnv)) dotenv.config({ path: serverEnv });
