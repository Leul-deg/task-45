import { startAlertCronJobs } from "./alerts";
import { startBackupCronJobs } from "./backup";
import { startEscalationCronJobs } from "./escalation";

let hasStarted = false;

export function startCronJobs(): void {
  if (hasStarted) {
    return;
  }

  hasStarted = true;
  startBackupCronJobs();
  startAlertCronJobs();
  startEscalationCronJobs();
}
