import { config } from "./lib/config.js";
import { createApp } from "./app.js";

const app = createApp();
app.listen(config.port, () => {
  console.log(`stockgame server on http://127.0.0.1:${config.port}`);
  console.log(`static root: ${config.staticRoot || "(repo root)"}`);
});
