declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email?: string; viaToken?: boolean; readOnly?: boolean };
    }
  }
}

export {};
