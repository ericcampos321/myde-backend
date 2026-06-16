-- =============================================================================
-- EXPLAIN ANALYZE — queries críticas do Myde (read-only)
-- =============================================================================
-- Como rodar (psql), passando IDs de teste do banco LOCAL:
--
--   psql "$DATABASE_URL" \
--     -v tenant_id="'00000000-0000-0000-0000-000000000000'" \
--     -v conversation_id="'00000000-0000-0000-0000-000000000000'" \
--     -v operator_id="'operator-1'" \
--     -v from_ts="'2026-06-01T00:00:00Z'" \
--     -v to_ts="'2026-07-01T00:00:00Z'" \
--     -v external_message_id="'wamid.TESTE'" \
--     -f src/db/explain/critical-queries.explain.sql
--
-- Notas de segurança:
-- - NÃO seleciona body de mensagem, prompt, token nem qualquer conteúdo sensível.
--   Onde o body apareceria (listagem/preview/busca), trocamos por `length(body)`.
-- - Use SEMPRE IDs de teste/local. Não rode em produção com dados reais.
-- - Para um plano realista, gere volume antes (centenas de conversas / milhares
--   de mensagens por tenant); em tabela vazia o Postgres prefere Seq Scan e o
--   plano não reflete produção.
-- =============================================================================

\timing on

-- -----------------------------------------------------------------------------
-- 1) GET /conversations — listagem por tenant ordenada por last_message_at desc
--    Índice esperado: whatsapp_conversations_tenant_last_message_idx
-- -----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, contact_id, status, last_message_at, created_at
FROM whatsapp_conversations
WHERE tenant_id = :tenant_id
ORDER BY last_message_at DESC;

-- 1b) Read model da listagem (A-01 CORRIGIDO): preview + unread + última inbound
--     por conversa em UMA query (DISTINCT ON + agregação), sem carregar todas as
--     mensagens do tenant. Espelha
--     WhatsAppConversationRepository.listConversationSummaries.
--     Índices esperados: whatsapp_messages_tenant_conversation_created_idx
--     (DISTINCT ON / unread) e whatsapp_conversations_tenant_last_message_idx (ordem).
--     :operator_id é o operador atual (parametrizado, nunca concatenado).
EXPLAIN (ANALYZE, BUFFERS)
WITH latest_messages AS (
  SELECT DISTINCT ON (m.conversation_id)
    m.conversation_id, m.body, m.direction, m.status
  FROM whatsapp_messages m
  WHERE m.tenant_id = :tenant_id
  ORDER BY m.conversation_id, m.created_at DESC, m.id DESC
),
latest_inbound AS (
  SELECT DISTINCT ON (m.conversation_id)
    m.conversation_id, m.id, m.created_at
  FROM whatsapp_messages m
  WHERE m.tenant_id = :tenant_id AND m.direction = 'inbound'
  ORDER BY m.conversation_id, m.created_at DESC, m.id DESC
),
unread_counts AS (
  SELECT m.conversation_id, COUNT(*)::int AS unread_count
  FROM whatsapp_messages m
  LEFT JOIN conversation_read_states r
    ON r.tenant_id = m.tenant_id
   AND r.conversation_id = m.conversation_id
   AND r.operator_id = :operator_id
  WHERE m.tenant_id = :tenant_id
    AND m.direction = 'inbound'
    AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
  GROUP BY m.conversation_id
)
SELECT
  c.id, c.contact_id, c.status, c.last_message_at, c.created_at,
  ct.name AS contact_name, length(ct.phone) AS contact_phone_len,
  length(lm.body) AS last_message_body_len, lm.direction, lm.status,
  li.id AS last_inbound_id, li.created_at AS last_inbound_at,
  COALESCE(uc.unread_count, 0) AS unread_count
FROM whatsapp_conversations c
LEFT JOIN whatsapp_contacts ct ON ct.id = c.contact_id AND ct.tenant_id = c.tenant_id
LEFT JOIN latest_messages lm ON lm.conversation_id = c.id
LEFT JOIN latest_inbound li ON li.conversation_id = c.id
LEFT JOIN unread_counts uc ON uc.conversation_id = c.id
WHERE c.tenant_id = :tenant_id
ORDER BY c.last_message_at DESC, c.id DESC;

-- -----------------------------------------------------------------------------
-- 2) GET /conversations/:id/messages — página mais recente (cursor por created,id)
--    Índice esperado: whatsapp_messages_tenant_conversation_created_idx
-- -----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, direction, status, length(body) AS body_len, created_at
FROM whatsapp_messages
WHERE tenant_id = :tenant_id
  AND conversation_id = :conversation_id
ORDER BY created_at DESC, id DESC
LIMIT 31;

-- -----------------------------------------------------------------------------
-- 3) Busca textual dentro da conversa (ILIKE no body)
--    Atenção: ILIKE '%termo%' tem wildcard à esquerda → não usa índice btree no
--    body. O filtro tenant+conversation usa o índice; o ILIKE é avaliado sobre
--    esse subconjunto (aceitável: já é bounded por conversa).
-- -----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, direction, status, length(body) AS body_len, created_at
FROM whatsapp_messages
WHERE tenant_id = :tenant_id
  AND conversation_id = :conversation_id
  AND body ILIKE '%teste%' ESCAPE '\'
ORDER BY created_at DESC, id DESC
LIMIT 21;

-- -----------------------------------------------------------------------------
-- 4) Webhook inbound — idempotência por (tenant, external_message_id)
--    Índice esperado: whatsapp_messages_tenant_external_message_unique (parcial)
-- -----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, created_at
FROM whatsapp_messages
WHERE tenant_id = :tenant_id
  AND external_message_id = :external_message_id
LIMIT 1;

-- -----------------------------------------------------------------------------
-- 5) Status webhook — update de status por external_message_id (tenant-scoped)
--    Índice esperado: whatsapp_messages_tenant_external_message_idx
--    (EXPLAIN sem ANALYZE para NÃO executar o UPDATE.)
-- -----------------------------------------------------------------------------
EXPLAIN
UPDATE whatsapp_messages
SET status = 'delivered', updated_at = now()
WHERE tenant_id = :tenant_id
  AND external_message_id = :external_message_id;

-- -----------------------------------------------------------------------------
-- 6) Busca de contato por telefone (upsert/webhook)
--    Índice esperado: whatsapp_contacts_tenant_phone_unique
-- -----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, length(phone) AS phone_len, created_at
FROM whatsapp_contacts
WHERE tenant_id = :tenant_id
  AND phone = '0000000000'
LIMIT 1;

-- -----------------------------------------------------------------------------
-- 7) GET /ai/usage — resumo agregado (janela [from, to))
--    Índice esperado: ai_interaction_logs_tenant_created_at_idx
-- -----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) AS total,
       count(*) FILTER (WHERE blocked) AS blocked,
       sum(prompt_tokens) AS prompt_tokens,
       sum(total_tokens) AS total_tokens,
       avg(duration_ms) AS avg_duration_ms
FROM ai_interaction_logs
WHERE tenant_id = :tenant_id
  AND created_at >= :from_ts
  AND created_at < :to_ts;

-- 7b) GET /ai/usage — recentes paginados (cursor por created_at, id)
--     Índice esperado: ai_interaction_logs_tenant_created_at_idx
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, created_at, conversation_id, stage, model, source, provider,
       risk_level, blocked, total_tokens, duration_ms
FROM ai_interaction_logs
WHERE tenant_id = :tenant_id
  AND created_at >= :from_ts
  AND created_at < :to_ts
ORDER BY created_at DESC, id DESC
LIMIT 21;

\timing off
