import type { Request, Response, NextFunction } from 'express';
import { bridgeConfig } from './config.js';

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.header('x-api-key');
  if (!apiKey || apiKey !== bridgeConfig.apiKey) {
    res.status(401).json({
      ok: false,
      error: 'UNAUTHORIZED',
      message: 'Missing or invalid bridge API key.',
    });
    return;
  }
  next();
}
