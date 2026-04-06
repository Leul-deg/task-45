import cors from "cors";
import dotenv from "dotenv";
import express from "express";

import adminRouter from "./controllers/admin";
import authRouter from "./controllers/auth";
import exportsRouter from "./controllers/exports";
import incidentsRouter from "./controllers/incidents";
import reportsRouter from "./controllers/reports";
import searchRouter from "./controllers/search";
import settingsRouter from "./controllers/settings";
import { auditLogger } from "./middleware/audit";
import { preAuthRateLimiter, postAuthRateLimiter } from "./middleware/rateLimit";
import {
  authenticateJwt,
  requireHttps,
  requireRole,
  secureStateChangingRoute,
  securityHeaders,
} from "./middleware/security";

dotenv.config();

const app = express();

app.set("trust proxy", 1);

app.use(requireHttps);
app.use(securityHeaders);
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost",
    credentials: true,
  }),
);
app.use(express.json({ limit: "16kb" }));
app.use(preAuthRateLimiter);
app.use(auditLogger);

app.use("/auth", authRouter);

app.use("/admin", authenticateJwt, postAuthRateLimiter, adminRouter);
app.use("/incidents", authenticateJwt, postAuthRateLimiter, incidentsRouter);
app.use("/settings", authenticateJwt, postAuthRateLimiter, settingsRouter);
app.use("/search", authenticateJwt, postAuthRateLimiter, searchRouter);
app.use("/export", authenticateJwt, postAuthRateLimiter, exportsRouter);
app.use("/reports", authenticateJwt, postAuthRateLimiter, reportsRouter);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post(
  "/protected/admin-check",
  ...secureStateChangingRoute,
  requireRole("Administrator"),
  (_req, res) => {
    res.status(200).json({ status: "authorized" });
  },
);

export default app;
