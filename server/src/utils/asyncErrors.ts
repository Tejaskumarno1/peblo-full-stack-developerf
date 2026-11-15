// Express 4 does not catch a rejected promise from an async route handler: the request hangs and Node (15+) can exit on the unhandled rejection.
// Many route files use `async (req, res) => { ... }` without try/catch, so this makes Express pass such a rejection to the error handler (the same fix as the express-async-errors package).
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

try {
  const Layer = require('express/lib/router/layer');
  if (Layer?.prototype && !Layer.prototype.__pebloAsync) {
    Layer.prototype.__pebloAsync = true;
    Layer.prototype.handle_request = function handle_request(req: any, res: any, next: any) {
      const fn = this.handle;
      if (fn.length > 3) return next(); // an error handler is not run for a normal request
      try {
        const out = fn(req, res, next);
        if (out && typeof out.catch === 'function') out.catch(next);
      } catch (err) {
        next(err);
      }
    };
  }
} catch (e) {
  console.error('[server] async error forwarding could not be installed:', (e as Error)?.message);
}
