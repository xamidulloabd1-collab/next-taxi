-- NEXT TAXI — geospatial columns, integrity constraints and immutability rules.
-- Hand-written: Prisma cannot express PostGIS columns, partial unique indexes,
-- CHECK constraints or triggers. Do not edit after it has been applied anywhere;
-- add a new migration instead.

-- ───────────────── PostGIS: driver positions ─────────────────
ALTER TABLE "driver_locations"
  ADD COLUMN "geog" geography(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography) STORED;

CREATE INDEX "driver_locations_geog_gist" ON "driver_locations" USING GIST ("geog");
CREATE INDEX "driver_locations_recorded_at_idx" ON "driver_locations" ("recorded_at");

ALTER TABLE "driver_locations"
  ADD CONSTRAINT "driver_locations_lat_range" CHECK ("lat" BETWEEN -90 AND 90),
  ADD CONSTRAINT "driver_locations_lng_range" CHECK ("lng" BETWEEN -180 AND 180);

-- ───────────────── PostGIS: service zones ─────────────────
ALTER TABLE "service_zones" ADD COLUMN "area" geometry(MultiPolygon, 4326);

CREATE OR REPLACE FUNCTION nt_service_zone_area() RETURNS trigger AS $$
DECLARE
  g geometry;
BEGIN
  BEGIN
    g := ST_SetSRID(ST_GeomFromGeoJSON(NEW."boundary"::text), 4326);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'ZONE_INVALID_GEOJSON: %', SQLERRM USING ERRCODE = '22023';
  END;
  IF GeometryType(g) NOT IN ('POLYGON', 'MULTIPOLYGON') THEN
    RAISE EXCEPTION 'ZONE_NOT_POLYGON' USING ERRCODE = '22023';
  END IF;
  IF NOT ST_IsValid(g) THEN
    RAISE EXCEPTION 'ZONE_INVALID_POLYGON: %', ST_IsValidReason(g) USING ERRCODE = '22023';
  END IF;
  NEW."area" := ST_Multi(g);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "service_zones_area_trg"
  BEFORE INSERT OR UPDATE OF "boundary" ON "service_zones"
  FOR EACH ROW EXECUTE FUNCTION nt_service_zone_area();

CREATE INDEX "service_zones_area_gist" ON "service_zones" USING GIST ("area");

-- ───────────────── Concurrency guarantees ─────────────────
-- A passenger can have at most one active ride.
CREATE UNIQUE INDEX "rides_one_active_per_passenger" ON "rides" ("passenger_id")
  WHERE "status" IN ('REQUESTED', 'SEARCHING', 'ASSIGNED', 'ARRIVING', 'ARRIVED', 'IN_PROGRESS');

-- A driver can be assigned to at most one active ride.
CREATE UNIQUE INDEX "rides_one_active_per_driver" ON "rides" ("driver_id")
  WHERE "status" IN ('ASSIGNED', 'ARRIVING', 'ARRIVED', 'IN_PROGRESS');

-- A driver sees at most one pending offer at a time.
CREATE UNIQUE INDEX "ride_offers_one_pending_per_driver" ON "ride_offers" ("driver_id")
  WHERE "status" = 'PENDING';

-- One active tariff per city + vehicle class.
CREATE UNIQUE INDEX "tariffs_one_active_per_class" ON "tariffs" ("city_id", "vehicle_class")
  WHERE "is_active";

-- One active vehicle per driver.
CREATE UNIQUE INDEX "driver_vehicles_one_active" ON "driver_vehicles" ("driver_id")
  WHERE "is_active";

-- Commission can be accrued only once per ride.
CREATE UNIQUE INDEX "ledger_entries_one_accrual_per_ride" ON "ledger_entries" ("ride_id", "account")
  WHERE "event_type" = 'COMMISSION_ACCRUED';

CREATE INDEX "rides_searching_idx" ON "rides" ("search_started_at") WHERE "status" = 'SEARCHING';
CREATE INDEX "ride_offers_driver_status_idx" ON "ride_offers" ("driver_id", "status");

-- ───────────────── CHECK constraints ─────────────────
ALTER TABLE "tariffs"
  ADD CONSTRAINT "tariffs_amounts_non_negative" CHECK ("base_fare" >= 0 AND "per_km" >= 0 AND "per_minute" >= 0 AND "minimum_fare" >= 0),
  ADD CONSTRAINT "tariffs_rounding_positive" CHECK ("rounding_step" > 0),
  ADD CONSTRAINT "tariffs_commission_range" CHECK ("commission_bps" BETWEEN 0 AND 5000),
  ADD CONSTRAINT "tariffs_quote_ttl_range" CHECK ("quote_ttl_seconds" BETWEEN 30 AND 3600),
  ADD CONSTRAINT "tariffs_version_positive" CHECK ("version" >= 1);

ALTER TABLE "fare_quotes"
  ADD CONSTRAINT "fare_quotes_amounts_non_negative" CHECK ("total_fare" >= 0 AND "base_fare" >= 0 AND "distance_fare" >= 0 AND "time_fare" >= 0),
  ADD CONSTRAINT "fare_quotes_route_non_negative" CHECK ("distance_meters" >= 0 AND "duration_seconds" >= 0);

ALTER TABLE "rides"
  ADD CONSTRAINT "rides_fare_non_negative" CHECK ("quoted_fare" >= 0 AND ("final_fare" IS NULL OR "final_fare" >= 0)),
  ADD CONSTRAINT "rides_commission_range" CHECK ("commission_bps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "rides_commission_non_negative" CHECK ("commission_amount" IS NULL OR "commission_amount" >= 0),
  ADD CONSTRAINT "rides_driver_required_when_assigned" CHECK (
    "status" NOT IN ('ASSIGNED', 'ARRIVING', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'SETTLED') OR "driver_id" IS NOT NULL
  ),
  ADD CONSTRAINT "rides_final_fare_when_completed" CHECK (
    "status" NOT IN ('COMPLETED', 'SETTLED') OR ("final_fare" IS NOT NULL AND "commission_amount" IS NOT NULL AND "driver_earnings" IS NOT NULL)
  );

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amounts_valid" CHECK ("amount" >= 0 AND "commission_amount" >= 0 AND "commission_amount" <= "amount"),
  ADD CONSTRAINT "payments_earnings_consistent" CHECK ("driver_earnings" = "amount" - "commission_amount");

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "ratings"
  ADD CONSTRAINT "ratings_score_range" CHECK ("score" BETWEEN 1 AND 5);

ALTER TABLE "cities"
  ADD CONSTRAINT "cities_dispatch_ranges" CHECK (
    "search_radius_meters" BETWEEN 300 AND 50000
    AND "offer_timeout_seconds" BETWEEN 8 AND 120
    AND "offer_batch_size" BETWEEN 1 AND 5
    AND "max_offers_per_ride" BETWEEN 1 AND 50
    AND "search_timeout_seconds" BETWEEN 30 AND 1800
    AND "max_driver_debt" >= 0
  ),
  ADD CONSTRAINT "cities_hours_format" CHECK (
    "operating_hours_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "operating_hours_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  );

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_year_range" CHECK ("year" BETWEEN 1980 AND 2100),
  ADD CONSTRAINT "vehicles_seats_range" CHECK ("seats" BETWEEN 1 AND 8);

ALTER TABLE "users"
  ADD CONSTRAINT "users_phone_e164" CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$' OR "deleted_at" IS NOT NULL);

-- ───────────────── Append-only records ─────────────────
CREATE OR REPLACE FUNCTION nt_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % rows cannot be updated or deleted', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_entries_immutable" BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION nt_forbid_mutation();
CREATE TRIGGER "ride_status_events_immutable" BEFORE UPDATE OR DELETE ON "ride_status_events"
  FOR EACH ROW EXECUTE FUNCTION nt_forbid_mutation();
CREATE TRIGGER "audit_logs_immutable" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION nt_forbid_mutation();
CREATE TRIGGER "settlements_immutable" BEFORE UPDATE OR DELETE ON "settlements"
  FOR EACH ROW EXECUTE FUNCTION nt_forbid_mutation();

-- Every ledger transaction must balance (sum of debits = sum of credits) at commit time.
CREATE OR REPLACE FUNCTION nt_ledger_balanced() RETURNS trigger AS $$
DECLARE
  imbalance bigint;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN "direction" = 'DEBIT' THEN "amount" ELSE -"amount" END), 0)
    INTO imbalance
    FROM "ledger_entries"
   WHERE "transaction_id" = NEW."transaction_id";
  IF imbalance <> 0 THEN
    RAISE EXCEPTION 'LEDGER_UNBALANCED: transaction % is off by %', NEW."transaction_id", imbalance USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ledger_entries_balanced"
  AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION nt_ledger_balanced();
