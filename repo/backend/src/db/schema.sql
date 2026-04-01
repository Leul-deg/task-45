CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('Administrator', 'Reporter', 'Dispatcher', 'Safety Manager', 'Auditor') NOT NULL,
  login_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS incidents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reporter_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  site VARCHAR(255) NOT NULL,
  time DATETIME NOT NULL,
  status ENUM('New', 'Acknowledged', 'In Progress', 'Escalated', 'Closed') NOT NULL DEFAULT 'New',
  rating TINYINT UNSIGNED NULL,
  cost DECIMAL(12,2) NULL,
  risk_tags JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_incidents_reporter FOREIGN KEY (reporter_id) REFERENCES users(id),
  INDEX idx_incidents_status (status),
  INDEX idx_incidents_time (time)
);

CREATE TABLE IF NOT EXISTS incident_actions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  incident_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(255) NOT NULL,
  evidence_log TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_actions_incident FOREIGN KEY (incident_id) REFERENCES incidents(id),
  CONSTRAINT fk_actions_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_actions_incident (incident_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  route VARCHAR(255) NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  before_val JSON NULL,
  after_val JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_audit_user (user_id)
);

CREATE TABLE IF NOT EXISTS settings (
  config_key VARCHAR(100) PRIMARY KEY,
  config_value JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
  token_id VARCHAR(255) PRIMARY KEY,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_revoked_expires (expires_at)
);

CREATE TABLE IF NOT EXISTS images (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  incident_id BIGINT UNSIGNED NULL,
  file_ref VARCHAR(512) NOT NULL,
  uploaded_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_images_incident FOREIGN KEY (incident_id) REFERENCES incidents(id),
  CONSTRAINT fk_images_user FOREIGN KEY (uploaded_by) REFERENCES users(id),
  INDEX idx_images_incident (incident_id)
);

CREATE TABLE IF NOT EXISTS incident_collaborators (
  incident_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  assigned_by BIGINT UNSIGNED NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (incident_id, user_id),
  CONSTRAINT fk_collab_incident FOREIGN KEY (incident_id) REFERENCES incidents(id),
  CONSTRAINT fk_collab_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_collab_assigner FOREIGN KEY (assigned_by) REFERENCES users(id),
  INDEX idx_collab_user (user_id)
);

CREATE TABLE IF NOT EXISTS privacy_consent (
  user_id BIGINT UNSIGNED NOT NULL,
  consented BOOLEAN NOT NULL DEFAULT FALSE,
  consented_at TIMESTAMP NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_consent_user FOREIGN KEY (user_id) REFERENCES users(id)
);
