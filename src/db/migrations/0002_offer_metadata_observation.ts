/**
 * Tracks which observation supplied the denormalized offer attributes. This
 * lets an older snapshot be imported later without overwriting newer SKU or
 * variant metadata.
 */
export const MIGRATION_0002_OFFER_METADATA_OBSERVATION = `
ALTER TABLE offers ADD COLUMN metadata_observed_at INTEGER;

UPDATE offers
SET metadata_observed_at = (
  SELECT MAX(e.observed_at)
  FROM presence_events e
  WHERE e.entity_kind = 'offer'
    AND e.entity_id = offers.offer_id
    AND e.present = 1
);
`;
