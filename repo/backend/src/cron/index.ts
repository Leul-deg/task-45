import { startAlertCronJobs } from "./alerts";
import { startBackupCronJobs } from "./backup";

let hasStarted = false;

export function startCronJobs(): void {
  if (hasStarted) {
    return;
  }

  hasStarted = true;
  startBackupCronJobs();
  startAlertCronJobs();
}
