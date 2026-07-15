-- #133: portal echoes now SKIP at the queue gate (Wave 3) — retire the ones already sitting in the
-- review queue. Sticky + reversible: dismissed rows appear in the Rejected tab and can be restored;
-- the committer never touches dismissed_at.
--
-- Run AFTER the queue's portal-skip deploys, so new echoes don't refill the queue.
-- House path: backend/scripts/ (same as backfill-shipment-ports.sql).

UPDATE shipments
SET dismissed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
WHERE review_status = 'provisional'
  AND dismissed_at IS NULL
  AND kind = 'SHIPMENT'
  AND (
    CAST(review_reasons AS nvarchar(max)) LIKE '%portal echo%'
    OR CAST(review_reasons AS nvarchar(max)) LIKE '%platform/portal email without carrier identity%'
  );
-- report what happened
SELECT @@ROWCOUNT AS dismissed_portal_echoes;
