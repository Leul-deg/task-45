import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();

const dbPort = Number(process.env.DB_PORT) || 3306;

export const dbPool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: dbPort,
  user: process.env.DB_USER || "app_user",
  password: process.env.DB_PASSWORD || "app_password",
  database: process.env.DB_NAME || "incident_db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
