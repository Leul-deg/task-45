import app from "./app";
import { startCronJobs } from "./cron";
import { loadRevokedTokensFromDb } from "./utils/tokenBlocklist";
const port = Number(process.env.PORT) || 3000;

app.listen(port, "0.0.0.0", async () => {
  await loadRevokedTokensFromDb();

  if (process.env.ENABLE_CRON !== "false") {
    startCronJobs();
  }

  console.log(`Backend server running on port ${port}`);
});
