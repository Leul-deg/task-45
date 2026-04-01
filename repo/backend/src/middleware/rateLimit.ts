import rateLimit from "express-rate-limit";
import type { Request, RequestHandler } from "express";

const isTest = process.env.NODE_ENV === "test";
const passthrough: RequestHandler = (_req, _res, next) => next();

export const preAuthRateLimiter: RequestHandler = isTest
  ? passthrough
  : rateLimit({
      windowMs: 60 * 1000,
      limit: 120,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many requests. Please try again later." },
    });

export const postAuthRateLimiter: RequestHandler = isTest
  ? passthrough
  : rateLimit({
      windowMs: 60 * 1000,
      limit: 60,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      validate: false,
      keyGenerator: (req: Request): string => {
        const userId = req.auth?.sub;
        if (userId) {
          return `user:${userId}`;
        }
        return `ip:${req.ip ?? "unknown"}`;
      },
      message: { error: "Too many requests. Please try again later." },
    });
