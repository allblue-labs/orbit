-- Retire only the default transport; preserve historical delivery audit rows.
-- REALTIME from older clients is accepted as an IN_APP alias by the service.
ALTER TABLE "notifications" ALTER COLUMN "channels" SET DEFAULT ARRAY['IN_APP']::varchar(30)[];
ALTER TABLE "notification_preferences" ALTER COLUMN "channels" SET DEFAULT ARRAY['IN_APP']::varchar(30)[];
