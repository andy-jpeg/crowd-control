import "dotenv/config";
import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

app.use(express.json());

app.get("/", (_req, res) => {
  res.send("Crowd Control backend is running!");
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "crowd-control-backend"
  });
});

app.listen(port, host, () => {
  console.log(`Backend running at http://${host}:${port}`);
});