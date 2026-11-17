import express, { type Express, type ErrorRequestHandler } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sessionMiddleware, csrfProtection } from "./lib/security";
import { HttpError } from "./lib/store";
import authRouter from "./routes/auth";
import eventsRouter from "./routes/events";
import tasksRouter from "./routes/tasks";
import publicRouter from "./routes/public";
import recapsRouter from "./routes/recaps";
import demoRouter from "./routes/demo";

const app: Express = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0]?.replace(/\/public\/v\/[^/]+/, "/public/v/[private]"),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(express.json({limit:"128kb"}));
app.use((req,res,next) => {
  res.set("X-Content-Type-Options","nosniff");
  res.set("Referrer-Policy","no-referrer");
  res.set("Cache-Control","no-store");
  next();
});
app.use(sessionMiddleware);
app.use("/api", csrfProtection, authRouter);

app.use("/api", router);
app.use("/api", eventsRouter);
app.use("/api", tasksRouter, publicRouter);
app.use("/api", recapsRouter, demoRouter);
const errors: ErrorRequestHandler = (err, req, res, _next) => {
  if (err.name === "ZodError") { res.status(400).json({error:"Please check the required fields and their values."}); return; }
  if (err instanceof HttpError) { res.status(err.status).json({error:err.message}); return; }
  req.log.error({name:err.name,code:err.code}, "Request failed");
  res.status(500).json({error:"Something went wrong. Please try again."});
};
app.use(errors);

export default app;
