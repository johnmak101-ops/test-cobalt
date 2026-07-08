-- Backfill shipments.pol_id / pod_id / origin_country from ingest.parsed_record.
--
-- Why: the matcher's decision `fields` never carried pol/pod to the committer, so all committed
-- shipments had null port FKs → route + originCountry rendered '—' across Shipments/Dashboard/Alerts
-- (data-wiring audit gaps 2,3,8). The committer's resolution code is correct; this re-resolves the
-- already-committed legs from their source evidence. Run after widening tracking.ports (see seed.ts).
--
-- Resolution: exact UN/LOCODE first; else a bidirectional name match (port name in the free-text, or
-- vice-versa) guarded by name length >= 4 — mirrors MastersRepository.portByCodeOrName.
--
-- Apply: docker exec -i <pg> psql -U postgres -d cobalt -f - < backfill-shipment-ports.sql
-- This is a demo-data backfill; the durable forward fix is the matcher emitting pol/pod in decisions.

UPDATE tracking.shipments s
SET pol_id = polp.id, pod_id = podp.id, origin_country = polp.country
FROM (
  SELECT s2.id, e.pol, e.pod
  FROM tracking.shipments s2
  LEFT JOIN LATERAL (
    SELECT pr.fields->>'pol' AS pol, pr.fields->>'pod' AS pod
    FROM ingest.parsed_record pr
    WHERE ((pr.fields->>'booking_no' = s2.booking_no AND s2.booking_no IS NOT NULL)
        OR (pr.fields->>'so_no' = s2.so_no AND s2.so_no IS NOT NULL))
      AND trim(coalesce(pr.fields->>'pol','')) <> ''
    LIMIT 1
  ) e ON true
) src
LEFT JOIN LATERAL (
  SELECT id, country FROM tracking.ports p
  WHERE upper(p.unlocode) = upper(trim(src.pol))
     OR (length(p.name) >= 4 AND (p.name ILIKE '%' || trim(src.pol) || '%' OR trim(src.pol) ILIKE '%' || p.name || '%'))
  ORDER BY (upper(p.unlocode) = upper(trim(src.pol))) DESC
  LIMIT 1
) polp ON true
LEFT JOIN LATERAL (
  SELECT id FROM tracking.ports p
  WHERE upper(p.unlocode) = upper(trim(src.pod))
     OR (length(p.name) >= 4 AND (p.name ILIKE '%' || trim(src.pod) || '%' OR trim(src.pod) ILIKE '%' || p.name || '%'))
  ORDER BY (upper(p.unlocode) = upper(trim(src.pod))) DESC
  LIMIT 1
) podp ON true
WHERE s.id = src.id AND (polp.id IS NOT NULL OR podp.id IS NOT NULL);
