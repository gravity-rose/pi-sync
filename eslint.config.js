import { recommended } from "@dbaida/eslint-config";

// The check-*.ts scripts run standalone under plain Node (see check-glob.ts)
// and sit outside the TypeScript project, so the project-service parser
// rejects them. They are not source; keep lint pointed at src/.
export default [{ ignores: ["check-*.ts"] }, ...recommended];
