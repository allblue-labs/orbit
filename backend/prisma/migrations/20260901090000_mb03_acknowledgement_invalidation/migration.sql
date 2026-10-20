-- PR-MB-03 closure — conteúdo material reconhecido não pode mudar mantendo
-- silenciosamente o acknowledgement anterior como válido.
CREATE OR REPLACE FUNCTION invalidate_operation_customer_acknowledgement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ROW(
    OLD.customer_id, OLD.asset_id, OLD.title, OLD.description,
    OLD.scheduled_start, OLD.scheduled_end, OLD.location
  ) IS DISTINCT FROM ROW(
    NEW.customer_id, NEW.asset_id, NEW.title, NEW.description,
    NEW.scheduled_start, NEW.scheduled_end, NEW.location
  ) THEN
    UPDATE customer_acknowledgements
       SET invalidated_at = CURRENT_TIMESTAMP,
           invalidation_reason = 'EXECUTION_CONTENT_CHANGED'
     WHERE organization_id = OLD.organization_id
       AND execution_type = 'OPERATION'
       AND execution_id = OLD.id
       AND invalidated_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operations_invalidate_customer_acknowledgement
AFTER UPDATE OF customer_id, asset_id, title, description,
  scheduled_start, scheduled_end, location
ON operations
FOR EACH ROW
EXECUTE FUNCTION invalidate_operation_customer_acknowledgement();
