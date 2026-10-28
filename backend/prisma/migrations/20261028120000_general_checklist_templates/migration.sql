ALTER TABLE checklist_templates
  ADD COLUMN is_general BOOLEAN NOT NULL DEFAULT FALSE;

-- Modelos antigos continuam disponíveis para seleção manual. O padrão geral
-- depende de uma decisão explícita do owner, não da ausência de tipo.
