-- Aureus — Migração 0009: enforcement de imutabilidade em signals/signal_outcomes (F14).
--
-- CONTEXTO: signals era append-only apenas por convenção da aplicação; um UPDATE
-- direto no banco era aceito. Esta migração adiciona o nível 2 (banco) sem remover
-- o nível 1 (API só emite INSERT OR IGNORE — verificado por teste).
--
-- COMPATIBILIDADE ANALISADA (não impede operação legítima):
--   • Nenhum caminho da aplicação emite UPDATE/DELETE nessas duas tabelas
--     (somente INSERT OR IGNORE). Triggers não afetam cron, resolvedor nem rotas.
--   • Tabelas Aureus (state/cycles/snapshots/events) NÃO são tocadas: o singleton
--     de estado usa ON CONFLICT DO UPDATE legitimamente.
--   • Migrations futuras continuam aplicáveis (DDL não é bloqueado, só DML em linhas).
--
-- CORREÇÃO LEGÍTIMA / RECUPERAÇÃO ADMINISTRATIVA (procedimento obrigatório):
--   1. NUNCA UPDATE/DELETE direto: triggers abortam. Para corrigir, crie uma NOVA
--      migration versionada que: (a) DROP TRIGGER <nome>; (b) grave a correção
--      como NOVO INSERT compensatório (outcome ou sinal versionado) com motivo
--      registrado; (c) recrie o trigger idêntico. Originais permanecem intactos.
--   2. Emergência com banco inacessível à migração: DROP TRIGGER manual + recriação
--      imediata após, com o motivo lançado no log de operação.
--
-- NÃO aplicar em produção remotamente sem aprovação de deploy (seguir runbook D1).

CREATE TRIGGER IF NOT EXISTS trg_signals_no_update
BEFORE UPDATE ON signals
BEGIN
  SELECT RAISE(ABORT, 'F14: signals e append-only; UPDATE bloqueado, use INSERT compensatorio versionado');
END;

CREATE TRIGGER IF NOT EXISTS trg_signals_no_delete
BEFORE DELETE ON signals
BEGIN
  SELECT RAISE(ABORT, 'F14: signals e append-only; DELETE bloqueado, use INSERT compensatorio versionado');
END;

CREATE TRIGGER IF NOT EXISTS trg_signal_outcomes_no_update
BEFORE UPDATE ON signal_outcomes
BEGIN
  SELECT RAISE(ABORT, 'F14: signal_outcomes e append-only; UPDATE bloqueado, use INSERT compensatorio versionado');
END;

CREATE TRIGGER IF NOT EXISTS trg_signal_outcomes_no_delete
BEFORE DELETE ON signal_outcomes
BEGIN
  SELECT RAISE(ABORT, 'F14: signal_outcomes e append-only; DELETE bloqueado, use INSERT compensatorio versionado');
END;
