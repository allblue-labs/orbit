-- O aceite e o aviso ao owner devem confirmar ou reverter juntos, inclusive
-- no PMOC, cujo comando público é executado por função SECURITY DEFINER.
-- A função não recebe destinatário, organização ou conteúdo do chamador:
-- todos são derivados do registro que efetivamente recebeu a resposta.
CREATE FUNCTION app_customer_document_owner_notification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_owner uuid;
  v_unit uuid;
  v_entity uuid;
  v_entity_type text;
  v_code text;
  v_customer text;
  v_type text;
  v_title text;
  v_body text;
  v_key text;
  v_payload jsonb;
  v_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF TG_TABLE_NAME = 'quote_acceptance_links' THEN
    SELECT o.owner_user_id, q.business_unit_id, q.id,
           COALESCE(NEW.snapshot->>'code', q.code),
           COALESCE(NEW.snapshot->>'customerName', c.trade_name, c.legal_name)
      INTO v_owner, v_unit, v_entity, v_code, v_customer
      FROM public.quotes q
      JOIN public.organizations o ON o.id = q.organization_id
      JOIN public.customers c ON c.id = q.customer_id AND c.organization_id = q.organization_id
     WHERE q.id = NEW.quote_id AND q.organization_id = NEW.organization_id;
    v_entity_type := 'quote';
    v_key := 'customer-quote-response:' || NEW.id::text;
    CASE NEW.decision
      WHEN 'APPROVE' THEN
        v_type := 'QUOTE_CUSTOMER_APPROVED';
        v_title := 'Orçamento aprovado e assinado';
        v_body := format('%s aprovou e assinou o orçamento %s. Responsável pelo aceite: %s.', v_customer, v_code, NEW.signer_name);
      WHEN 'REJECT' THEN
        v_type := 'QUOTE_CUSTOMER_REJECTED';
        v_title := 'Orçamento recusado pelo cliente';
        v_body := format('%s recusou o orçamento %s. Resposta de %s. Motivo: %s', v_customer, v_code, NEW.signer_name, NEW.reason);
      WHEN 'REQUEST_CHANGES' THEN
        v_type := 'QUOTE_CUSTOMER_CHANGES_REQUESTED';
        v_title := 'Cliente solicitou alterações no orçamento';
        v_body := format('%s solicitou alterações no orçamento %s. Resposta de %s: %s', v_customer, v_code, NEW.signer_name, NEW.reason);
      ELSE
        RETURN NEW;
    END CASE;
    v_payload := jsonb_build_object('decision', NEW.decision, 'reason', NEW.reason, 'respondedAt', NEW.responded_at);
  ELSIF TG_TABLE_NAME = 'pmoc_plan_signature_links' THEN
    SELECT o.owner_user_id, p.business_unit_id, p.id,
           COALESCE(NEW.public_summary->>'code', p.code),
           COALESCE(NEW.public_summary->>'customerName', c.trade_name, c.legal_name)
      INTO v_owner, v_unit, v_entity, v_code, v_customer
      FROM public.pmoc_plans p
      JOIN public.organizations o ON o.id = p.organization_id
      JOIN public.customers c ON c.id = p.customer_id AND c.organization_id = p.organization_id
     WHERE p.id = NEW.plan_id AND p.organization_id = NEW.organization_id;
    v_entity_type := 'pmoc-plan';
    v_key := 'customer-pmoc-signature:' || NEW.id::text;
    v_type := 'PMOC_CONTRACT_SIGNED';
    v_title := 'Contrato PMOC assinado pelo cliente';
    v_body := format('%s assinou o contrato PMOC %s. Responsável pelo aceite: %s.', v_customer, v_code, NEW.signer_name);
    v_payload := jsonb_build_object('decision', 'SIGNED', 'respondedAt', NEW.signed_at);
  ELSE
    RETURN NEW;
  END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Customer document owner not found';
  END IF;

  -- UUIDv7 compatível com PostgreSQL 17 e com ParseUUIDv7Pipe das rotas de
  -- leitura/marcação; gen_random_uuid() sozinho produziria UUIDv4 inválido.
  v_id := (
    lpad(to_hex(floor(extract(epoch FROM v_now) * 1000)::bigint), 12, '0') ||
    '7' || substr(replace(gen_random_uuid()::text, '-', ''), 14, 3) ||
    substr(replace(gen_random_uuid()::text, '-', ''), 17, 16)
  )::uuid;
  INSERT INTO public.notifications (
    id, organization_id, business_unit_id, recipient_user_id, type, dedupe_key,
    channels, title, body, status, payload, sent_at, created_at, updated_at
  ) VALUES (
    v_id, NEW.organization_id, v_unit, v_owner, v_type, v_key,
    ARRAY['IN_APP'], v_title, v_body, 'SENT',
    v_payload || jsonb_build_object('entityType', v_entity_type, 'entityId', v_entity,
      'code', v_code, 'customerName', v_customer, 'signerName', NEW.signer_name, 'acceptanceLinkId', NEW.id),
    v_now, v_now, v_now
  ) ON CONFLICT (organization_id, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    INSERT INTO public.notification_deliveries (
      id, notification_id, recipient_user_id, channel, status, provider, attempts,
      sent_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_id, v_owner, 'IN_APP', 'SENT', 'orbit-database', 1,
      v_now, v_now, v_now
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_customer_document_owner_notification() FROM PUBLIC;

CREATE TRIGGER quote_customer_response_notify_owner
AFTER UPDATE OF responded_at ON quote_acceptance_links
FOR EACH ROW WHEN (OLD.responded_at IS NULL AND NEW.responded_at IS NOT NULL)
EXECUTE FUNCTION app_customer_document_owner_notification();

CREATE TRIGGER pmoc_customer_signature_notify_owner
AFTER UPDATE OF signed_at ON pmoc_plan_signature_links
FOR EACH ROW WHEN (OLD.signed_at IS NULL AND NEW.signed_at IS NOT NULL)
EXECUTE FUNCTION app_customer_document_owner_notification();
