import "dotenv/config";
import express from "express";
import cors from "cors";

import uploadsRouter from "./routes/uploads";
import rendersRouter from "./routes/renders";
import jobsRouter    from "./routes/jobs";
import previewRouter from "./routes/preview";

const app  = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN ?? "http://localhost:3000",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", uploadsRouter);
app.use("/api", rendersRouter);
app.use("/api", jobsRouter);
app.use("/api", previewRouter);

app.listen(PORT, () => {
  console.log(`[qlipo-backend] Rodando na porta ${PORT}`);
});
