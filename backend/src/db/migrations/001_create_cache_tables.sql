-- =============================================================================
-- Migration 001 - Tabelas de agregacao/cache de periodo (PLAN.md, Task 2.2)
-- Alvo: MariaDB 10.1.41, banco do ERP (engine InnoDB, charset latin1, igual as
-- tabelas do ERP: vendacupom, vendaitem, produto etc.).
--
-- Esta migration e definitiva: depois de aplicada, NAO e editada. Qualquer
-- mudanca de schema vira uma nova migration numerada (002_..., 003_...).
--
-- IDEMPOTENCIA
--   Os dois CREATE usam IF NOT EXISTS. Rodar a migration de novo e um no-op
--   (o MariaDB so emite um warning "table already exists") e nao altera nem
--   apaga linhas ja gravadas. Nenhuma tabela existente do ERP e alterada.
--   Limitacao conhecida: IF NOT EXISTS nao compara estrutura - se uma tabela
--   com o mesmo nome e outra estrutura ja existir, ela e mantida como esta.
--
-- DESIGN APPEND-ONLY
--   O usuario da aplicacao tem apenas SELECT, INSERT e CREATE (sem UPDATE,
--   DELETE, ALTER ou DROP). Por isso o cache nunca e atualizado no lugar:
--   cada recalculo de um periodo INSERE uma nova linha (nova versao), e as
--   versoes antigas ficam como historico. Nao ha UNIQUE em
--   (periodo_inicio, periodo_fim) justamente para permitir varias versoes.
--
-- COMO LER A VERSAO MAIS RECENTE DE UM PERIODO
--   A versao vigente e a de maior atualizado_em; empate e desfeito pelo maior
--   id (AUTO_INCREMENT e monotonico). O indice idx_periodo_atualizado cobre
--   essa busca:
--
--     SELECT faturamento_total, quantidade_cupons, atualizado_em
--       FROM vendas_periodo_cache
--      WHERE periodo_inicio = ? AND periodo_fim = ?
--      ORDER BY atualizado_em DESC, id DESC
--      LIMIT 1;
--
-- SEMANTICA DAS COLUNAS
--   periodo_inicio / periodo_fim : intervalo fechado de datas (inclusive nas
--                                  duas pontas), dias do calendario da loja.
--   faturamento_total            : vendas -> soma de vendacupom.valortotal
--                                  (ja liquido) das vendas validas
--                                  (flagvc.flag = 1 e vendacupom.status = 0);
--                                  compras -> total das notas de compra.
--   quantidade_cupons            : vendas -> numero de cupons validos;
--                                  compras -> numero de notas de compra.
--   atualizado_em                : momento em que a versao foi gravada.
--                                  TIMESTAMP e armazenado em UTC pelo MariaDB
--                                  e convertido pelo time_zone da sessao.
--
-- A frequencia do job que popula estas tabelas e a origem exata dos dados de
-- compras sao "Decisao em aberto" no SPEC.md e ficam fora desta migration.
-- =============================================================================

CREATE TABLE IF NOT EXISTS `vendas_periodo_cache` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `periodo_inicio` DATE NOT NULL,
  `periodo_fim` DATE NOT NULL,
  `faturamento_total` DECIMAL(19,4) NOT NULL DEFAULT '0.0000',
  `quantidade_cupons` INT UNSIGNED NOT NULL DEFAULT '0',
  `atualizado_em` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_periodo_atualizado` (`periodo_inicio`, `periodo_fim`, `atualizado_em`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `compras_periodo_cache` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `periodo_inicio` DATE NOT NULL,
  `periodo_fim` DATE NOT NULL,
  `faturamento_total` DECIMAL(19,4) NOT NULL DEFAULT '0.0000',
  `quantidade_cupons` INT UNSIGNED NOT NULL DEFAULT '0',
  `atualizado_em` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_periodo_atualizado` (`periodo_inicio`, `periodo_fim`, `atualizado_em`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
