import { Request, Response, NextFunction } from 'express';

/*
 * Input that the database cannot store must never end as a 500:
 *  - a NUL character (%00 in an address, \u0000 in JSON) makes PostgreSQL refuse the text;
 *  - a lone UTF-16 surrogate cannot be turned into UTF-8;
 *  - a date far outside the supported range cannot be sent to the database.
 * Addresses with %00 are refused, JSON bodies are cleaned the same way notes already are (see scrub in utils/meta.ts),
 * and the database errors that still slip through become 400 instead of 500.
 */
const BAD = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const BAD_ALL = new RegExp(BAD.source, 'g');

function clean(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return BAD.test(v) ? v.replace(BAD_ALL, '') : v;
  if (v === null || typeof v !== 'object' || Buffer.isBuffer(v) || depth > 60) return v;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) { const c = clean(v[i], depth + 1); if (c !== v[i]) v[i] = c; }
    return v;
  }
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const val = clean(o[k], depth + 1);
    const key = BAD.test(k) ? k.replace(BAD_ALL, '') : k;
    if (key !== k) { delete o[k]; if (key !== '__proto__') o[key] = val; }
    else if (val !== o[k]) o[k] = val;
  }
  return o;
}

/** Refuse an address that contains an encoded NUL (%00). */
export function rejectNulInUrl(req: Request, res: Response, next: NextFunction) {
  if (/%00/i.test(req.url)) return res.status(400).json({ error: 'That address contains a character Peblo cannot use.' });
  next();
}

/** Strip NUL characters and broken surrogates from every text in a parsed JSON body (keys too). Mount right after express.json. */
export function cleanBody(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) req.body = clean(req.body);
  next();
}

/** Database complaints about the text or date a person sent are the person's mistake (400), not a server fault. Mount just before errorHandler. */
export function inputErrors(err: any, _req: Request, res: Response, next: NextFunction) {
  const msg = String(err?.message || '');
  if (/invalid byte sequence for encoding/i.test(msg) || err?.meta?.code === '22021') {
    return res.status(400).json({ error: 'The text cannot contain null characters.' });
  }
  if ((err instanceof RangeError && /Invalid time value/i.test(msg))
    || (/Could not convert argument value/i.test(msg) && /DateTime/.test(msg))
    || err?.meta?.code === '22008' || /(date\/time field value out of range|timestamp out of range)/i.test(msg)) {
    return res.status(400).json({ error: 'That date is out of range.' });
  }
  // a broken upload body (busboy / multer parse errors) is a bad request
  if (/Malformed part header|Unexpected end of (form|multipart)|Boundary not found|Malformed urlencoded form|Multipart:/i.test(msg)) {
    return res.status(400).json({ error: 'That upload could not be read.' });
  }
  next(err);
}
