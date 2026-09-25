import { Request, Response, NextFunction } from 'express';
import { LOCAL_USER_ID } from '../db.js';

// Desktop app: there are no accounts. Every request acts as the single local user
// whose data lives in the SQLite file on this machine.
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  req.user = { id: LOCAL_USER_ID } as any;
  next();
}
