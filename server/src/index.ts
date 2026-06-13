/**
 * MOMENTUM — API server
 * npm run dev → http://localhost:4000
 */
import express from "express";
import cors from "cors";
import { ZodError } from "zod";
import transactions from "./routes/transactions";
import goals from "./routes/goals";
import debts from "./routes/debts";
import dashboard from "./routes/dashboard";
import sync from "./routes/sync";

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? "http://localhost:3000" }));
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "momentum-api" }));

app.use("/api/transactions", transactions);
app.use("/api/goals", goals);
app.use("/api/debts", debts);
app.use("/api/dashboard", dashboard);
app.use("/api/sync", sync);

// Central error handler — Zod issues come back as 422 with details.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(422).json({ error: "Validation failed", issues: err.issues });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side — your data is safe." });
});

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => console.log(`momentum-api listening on :${PORT}`));
