-- Seed default data for the Incident Control Center.
-- This script is idempotent (INSERT IGNORE / INSERT ... ON DUPLICATE KEY UPDATE).
-- IMPORTANT: Change the default admin password in production before deploying.

-- Default Administrator user
-- Default password: admin123 — CHANGE IN PRODUCTION
INSERT IGNORE INTO users (id, username, password_hash, role, login_attempts, locked_until, created_at)
VALUES (
  1,
  'admin',
  '$2b$10$tMi40OKbMvEXDi1FpYoz4.22M2vXxZygOm1xJfJL3TkIX0dB4hrV2',
  'Administrator',
  0,
  NULL,
  NOW()
);

-- Reporter user — Default password: reporter123
INSERT IGNORE INTO users (id, username, password_hash, role, login_attempts, locked_until, created_at)
VALUES (
  2,
  'reporter1',
  '$2b$10$EoBX0bLPp/izH/MEVcBgau7WpxcLBkDXNDvlwCyk0PD44Jopw2LbC',
  'Reporter',
  0,
  NULL,
  NOW()
);

-- Dispatcher user — Default password: dispatcher123
INSERT IGNORE INTO users (id, username, password_hash, role, login_attempts, locked_until, created_at)
VALUES (
  3,
  'dispatcher1',
  '$2b$10$Lk93xj3GOfjPkj6dJ7QMuuTopI5xDxSZ3rLpLvlT1aj.PoLK26YZq',
  'Dispatcher',
  0,
  NULL,
  NOW()
);

-- Safety Manager user — Default password: manager123
INSERT IGNORE INTO users (id, username, password_hash, role, login_attempts, locked_until, created_at)
VALUES (
  4,
  'safety_mgr',
  '$2b$10$/hBlMh8dEln9sV7hMk9HYezasPtjf5e5vX4cfz7W/05iNjjcncIqi',
  'Safety Manager',
  0,
  NULL,
  NOW()
);

-- Auditor user — Default password: auditor123
INSERT IGNORE INTO users (id, username, password_hash, role, login_attempts, locked_until, created_at)
VALUES (
  5,
  'auditor1',
  '$2b$10$vnVnW9L0C6Wa5WnJr3zvjuwpOMub9eiZnF.EQXEGd0PmpjxboqOpW',
  'Auditor',
  0,
  NULL,
  NOW()
);

-- Default SLA Settings
INSERT INTO settings (config_key, config_value, updated_at)
VALUES ('sla_defaults', '{"ack_minutes":15,"close_hours":72}', NOW())
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);

-- Default Incident Types
INSERT INTO settings (config_key, config_value, updated_at)
VALUES ('incident_types', '["Near Miss","Injury","Property Damage","Environmental Spill","Slip/Trip/Fall","Chemical Spill","Equipment Failure","Fire"]', NOW())
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);

-- Default Facility Sites
INSERT INTO settings (config_key, config_value, updated_at)
VALUES ('facility_sites', '["Main Campus","Warehouse A","Warehouse B","Lab Building","Field Office"]', NOW())
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);
