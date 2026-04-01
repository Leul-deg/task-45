import crypto from "crypto";
import { spawn } from "child_process";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, readdir, stat, unlink } from "fs/promises";
import path from "path";

import cron from "node-cron";

const NIGHTLY_RETENTION_DAYS = 30;
const MONTHLY_RETENTION_DAYS = 365 * 5;

function getEncryptionKey(): Buffer {
  const secret = process.env.DATA_ENCRYPTION_KEY;

  if (!secret) {
    throw new Error("DATA_ENCRYPTION_KEY is required for backup encryption");
  }

  return crypto.createHash("sha256").update(secret).digest();
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function dumpDatabase(sqlPath: string): Promise<void> {
  const host = process.env.DB_HOST || "127.0.0.1";
  const port = String(process.env.DB_PORT || "3306");
  const user = process.env.DB_USER || "app_user";
  const password = process.env.DB_PASSWORD || "app_password";
  const database = process.env.DB_NAME || "incident_db";

  return new Promise((resolve, reject) => {
    const child = spawn(
      "mysqldump",
      ["--single-transaction", "--quick", "-h", host, "-P", port, "-u", user, database],
      {
        env: {
          ...process.env,
          MYSQL_PWD: password,
        },
      },
    );

    const outputStream = createWriteStream(sqlPath);
    child.stdout.pipe(outputStream);

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      outputStream.end(() => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`mysqldump failed (${code}): ${stderr.trim()}`));
      });
    });
  });
}

async function encryptFile(inputPath: string): Promise<string> {
  const outputPath = `${inputPath}.enc`;
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const input = createReadStream(inputPath);
  const output = createWriteStream(outputPath);

  output.write(iv);

  await new Promise<void>((resolve, reject) => {
    input.on("error", reject);
    output.on("error", reject);

    cipher.on("error", reject);
    output.on("finish", resolve);

    input.pipe(cipher).pipe(output);
  });

  const authTag = cipher.getAuthTag();
  await new Promise<void>((resolve, reject) => {
    const finalOutput = createWriteStream(outputPath, { flags: "a" });
    finalOutput.on("error", reject);
    finalOutput.on("finish", resolve);
    finalOutput.end(authTag);
  });

  await unlink(inputPath);
  return outputPath;
}

async function pruneOldBackups(directory: string, maxAgeDays: number): Promise<void> {
  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const files = await readdir(directory);

  await Promise.all(
    files.map(async (fileName) => {
      const fullPath = path.join(directory, fileName);
      const fileStat = await stat(fullPath);

      if (now - fileStat.mtimeMs > maxAgeMs) {
        await unlink(fullPath);
      }
    }),
  );
}

async function runBackup(targetDir: string, retentionDays: number): Promise<string> {
  await mkdir(targetDir, { recursive: true });

  const timestamp = formatTimestamp(new Date());
  const sqlPath = path.join(targetDir, `incident-db-${timestamp}.sql`);

  await dumpDatabase(sqlPath);
  const encryptedPath = await encryptFile(sqlPath);
  await pruneOldBackups(targetDir, retentionDays);

  return encryptedPath;
}

export async function runNightlyBackup(): Promise<void> {
  const nightlyDir = path.resolve(process.cwd(), "backups", "nightly");
  const encryptedPath = await runBackup(nightlyDir, NIGHTLY_RETENTION_DAYS);
  console.log(`Nightly encrypted backup created: ${encryptedPath}`);
}

export async function runMonthlyArchive(): Promise<void> {
  const monthlyDir = path.resolve(process.cwd(), "backups", "monthly");
  const encryptedPath = await runBackup(monthlyDir, MONTHLY_RETENTION_DAYS);
  console.log(`Monthly encrypted archive created: ${encryptedPath}`);
}

export function startBackupCronJobs(): void {
  cron.schedule("0 2 * * *", () => {
    void runNightlyBackup().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown nightly backup error";
      console.error(`Nightly backup failed: ${message}`);
    });
  });

  cron.schedule("0 3 1 * *", () => {
    void runMonthlyArchive().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown monthly archive error";
      console.error(`Monthly archive failed: ${message}`);
    });
  });
}
