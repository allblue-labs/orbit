CREATE UNIQUE INDEX storage_files_id_organization_id_key ON storage_files(id, organization_id);
CREATE TABLE storage_upload_admissions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  storage_file_id uuid UNIQUE,
  expires_at timestamptz(3) NOT NULL,
  FOREIGN KEY(storage_file_id, organization_id) REFERENCES storage_files(id, organization_id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX storage_upload_admissions_organization_id_expires_at_idx ON storage_upload_admissions(organization_id, expires_at);
ALTER TABLE storage_upload_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_upload_admissions FORCE ROW LEVEL SECURITY;
CREATE POLICY upload_admission_tenant ON storage_upload_admissions FOR ALL
 USING (app_is_platform_admin() OR organization_id = app_current_organization_id())
 WITH CHECK (app_is_platform_admin() OR organization_id = app_current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON storage_upload_admissions TO orbit_app;
