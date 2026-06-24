// Vercel Serverless Function Entry Point
// This file is the single entry for ALL /api/* requests on Vercel.
// It imports the Express app from server/src/index.js and lets it handle routing.

import app from '../server/dist/index.js';

export default app;
