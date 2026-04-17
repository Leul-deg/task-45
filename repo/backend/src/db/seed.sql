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

-- Default Safety Resources
INSERT IGNORE INTO safety_resources (id, title, category, description, url, tags, price, rating) VALUES
(1, 'Fire Extinguisher Operating Procedure', 'Fire Safety', 'Standard procedure for operating ABC-type fire extinguishers using the PASS technique.', '/docs/fire-extinguisher-sop.pdf', '["fire","extinguisher","PASS","emergency"]', 25.00, 5),
(2, 'Chemical Spill Response Guide', 'Hazardous Materials', 'Step-by-step containment and cleanup for chemical spills in laboratory environments.', '/docs/chemical-spill-guide.pdf', '["chemical","spill","hazmat","cleanup"]', 120.50, 4),
(3, 'PPE Selection Matrix', 'Personal Protective Equipment', 'Reference chart for selecting appropriate PPE based on hazard type and exposure level.', '/docs/ppe-matrix.pdf', '["PPE","gloves","goggles","respirator"]', 0.00, 5),
(4, 'Confined Space Entry Permit', 'Confined Space', 'Permit template and checklist for safe confined space entry operations.', '/docs/confined-space-permit.pdf', '["confined space","permit","ventilation"]', 15.00, 3),
(5, 'Lockout/Tagout (LOTO) Procedure', 'Machine Safety', 'Energy isolation procedures for maintenance and servicing of equipment.', '/docs/loto-procedure.pdf', '["LOTO","lockout","tagout","energy isolation"]', 40.00, 4),
(6, 'Incident Investigation Template', 'Investigation', 'Root cause analysis template for workplace incident investigations.', '/docs/investigation-template.pdf', '["investigation","root cause","RCA","5-why"]', 0.00, 4),
(7, 'Emergency Evacuation Plan', 'Emergency Response', 'Building evacuation routes and assembly point procedures for all facility sites.', '/docs/evacuation-plan.pdf', '["evacuation","emergency","assembly","fire drill"]', 10.00, 5),
(8, 'Ergonomic Workstation Assessment', 'Ergonomics', 'Self-assessment checklist for computer workstation ergonomic setup.', '/docs/ergonomic-assessment.pdf', '["ergonomics","workstation","posture","RSI"]', 5.00, 3);
