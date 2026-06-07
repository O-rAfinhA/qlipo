import { createClerkClient } from "@clerk/backend";
import type { Request, Response, NextFunction } from "express";

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Token de autenticacao ausente." });
    return;
  }
  try {
    await clerk.verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Token invalido ou expirado." });
  }
}
