-- Apply on existing databases that were created before price/rating columns existed.
-- Safe to run once; ignore duplicate column errors if re-run.

ALTER TABLE safety_resources
  ADD COLUMN price DECIMAL(12,2) NULL COMMENT 'Internal chargeback / remediation cost' AFTER tags;

ALTER TABLE safety_resources
  ADD COLUMN rating TINYINT UNSIGNED NULL COMMENT 'Internal usefulness score 1-5' AFTER price;

CREATE INDEX idx_resources_price ON safety_resources (price);
CREATE INDEX idx_resources_rating ON safety_resources (rating);
