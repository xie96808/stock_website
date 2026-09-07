import { config } from "./lib/config.js";
import { createApp } from "./app.js";

const app = createApp({ skipStatic: config.skipStatic });
app.listen(config.port, "127.0.0.1", () => {
  console.log(`stockgame server on http://127.0.0.1:${config.port}`);
  console.log(`static root: ${config.skipStatic ? "(disabled)" : (config.staticRoot || "(repo root)")}`);
});
