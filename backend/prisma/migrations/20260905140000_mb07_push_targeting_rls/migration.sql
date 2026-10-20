DROP POLICY "mobile_device_installations_owner_scope"
  ON "mobile_device_installations";
CREATE POLICY "mobile_device_installations_owner_scope"
  ON "mobile_device_installations" FOR ALL
  USING (
    "organization_id" = app_current_organization_id()
    AND (
      "user_id" = app_current_user_id()
      OR app_has_permission('notifications.create')
    )
  )
  WITH CHECK (
    "organization_id" = app_current_organization_id()
    AND "user_id" = app_current_user_id()
  );

DROP POLICY "mobile_push_deliveries_recipient_scope"
  ON "mobile_push_deliveries";
CREATE POLICY "mobile_push_deliveries_recipient_scope"
  ON "mobile_push_deliveries" FOR ALL
  USING (
    "organization_id" = app_current_organization_id()
    AND EXISTS (
      SELECT 1 FROM "notifications" n
       WHERE n."id" = "notification_id"
         AND n."organization_id" = app_current_organization_id()
         AND (
           n."recipient_user_id" = app_current_user_id()
           OR app_has_permission('notifications.create')
           OR app_has_permission('notifications.dispatch')
         )
    )
  )
  WITH CHECK (
    "organization_id" = app_current_organization_id()
    AND EXISTS (
      SELECT 1 FROM "notifications" n
       WHERE n."id" = "notification_id"
         AND n."organization_id" = app_current_organization_id()
         AND (
           n."recipient_user_id" = app_current_user_id()
           OR app_has_permission('notifications.create')
         )
    )
  );
