/**
 * ESSA — API server
 * npm run dev → http://localhost:4000
 */
import { createApp } from "./app";
import { logger } from "./lib/logger";


// Every current route is disciplined about try/catch + next(err), but that
// only covers errors thrown inside a request's own call stack. An error
// from something outside one (a stray unawaited promise, an async callback
// with no catch) has no Express error handler to reach — without this,
// it would crash the whole process silently (Node's default since v15)
// and take every user's sync down until the platform restarts it, with no
// log line explaining why. Logging then exiting (rather than trying to
// keep serving) is deliberate: after an uncaught error the process is in
// an unknown state, and Railway restarts it immediately either way.
process.on("uncaughtException", (err) => {
  logger.error("uncaught_exception", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.error("unhandled_rejection", reason);
  process.exit(1);
});

const app = createApp();

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => logger.info("server_started", { port: PORT }));
