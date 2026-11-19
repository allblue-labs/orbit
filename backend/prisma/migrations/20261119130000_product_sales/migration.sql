CREATE TABLE product_sales (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_unit_id UUID NOT NULL REFERENCES business_units(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  created_by_id UUID NOT NULL,
  request_id UUID NOT NULL,
  request_hash CHAR(64) NOT NULL,
  receipt_id UUID NOT NULL UNIQUE REFERENCES artifact_executions(id) ON DELETE RESTRICT,
  customer_name VARCHAR(255) NOT NULL,
  paid_on DATE NOT NULL,
  subtotal DECIMAL(14,2) NOT NULL,
  discount DECIMAL(14,2) NOT NULL,
  total DECIMAL(14,2) NOT NULL,
  items JSONB NOT NULL,
  payments JSONB NOT NULL,
  notes VARCHAR(500),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT product_sales_request_key UNIQUE (organization_id, created_by_id, request_id),
  CONSTRAINT product_sales_unit_scope FOREIGN KEY (business_unit_id, organization_id)
    REFERENCES business_units (id, organization_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT product_sales_customer_scope FOREIGN KEY (customer_id, organization_id)
    REFERENCES customers (id, organization_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT product_sales_receipt_scope FOREIGN KEY (receipt_id, organization_id, business_unit_id)
    REFERENCES artifact_executions (id, organization_id, business_unit_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT product_sales_amounts CHECK (discount >= 0 AND total > 0 AND total = subtotal - discount),
  CONSTRAINT product_sales_items CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 20),
  CONSTRAINT product_sales_payments CHECK (jsonb_typeof(payments) = 'array' AND jsonb_array_length(payments) BETWEEN 1 AND 5)
);

CREATE INDEX product_sales_unit_history ON product_sales (organization_id, business_unit_id, created_at DESC, id DESC);
CREATE INDEX product_sales_customer_idx ON product_sales (customer_id);

ALTER TABLE product_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_sales FORCE ROW LEVEL SECURITY;
CREATE POLICY product_sales_scope ON product_sales
  USING (app_is_platform_admin() OR (
    organization_id = app_current_organization_id()
    AND business_unit_id = ANY(app_current_business_unit_ids())
  ))
  WITH CHECK (app_is_platform_admin() OR (
    organization_id = app_current_organization_id()
    AND business_unit_id = ANY(app_current_business_unit_ids())
    AND created_by_id = app_current_user_id()
  ));
GRANT SELECT, INSERT ON product_sales TO orbit_app;

ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_type_valid;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_type_valid
  CHECK (type IN ('ENTRY','CONSUMPTION','SALE','RETURN','ADJUSTMENT_IN','ADJUSTMENT_OUT','TRANSFER_IN','TRANSFER_OUT'));
