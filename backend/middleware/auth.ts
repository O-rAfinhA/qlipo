import { verifyToken } from "@clerk/backend";
import type { Request, Response, NextFunction } from "express";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Token de autenticacao ausente." });
    return;
  }
  try {
    const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY! });
    res.locals.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "Token invalido ou expirado." });
  }
}
