-- =============================================================================
-- Migration 004 - Caches de vendas por produto e de primeira venda (PLAN.md,
-- Task 7.3)
-- Alvo: MariaDB 10.1.41, banco do ERP (engine InnoDB, charset latin1, igual as
-- tabelas do ERP e as caches da 001). Cria DUAS tabelas novas; nenhuma tabela
-- existente (do ERP ou das migrations 001-003) e alterada.
--
-- Esta migration e definitiva: depois de aplicada, NAO e editada. Qualquer
-- mudanca de schema vira uma nova migration numerada (005_..., 006_...).
--
-- POR QUE EXISTE
--   Decisao do usuario (revisao da Fase 7): ranking-produtos criterio
--   crescimento/queda compara o periodo com o anterior POR PRODUTO, e /novos
--   precisa da primeira venda historica de cada produto. O unico cache
--   existente (vendas_periodo_cache) e agregado por dia, sem produto, e o
--   CLAUDE.md proibe varrer vendacupom/vendaitem para comparativos com periodos
--   anteriores. O job da Task 7.4 (backend/src/jobs/vendasProdutoCache.job.js)
--   popula as duas tabelas com upsert (INSERT ... ON DUPLICATE KEY UPDATE).
--
-- REGRA DE VENDA VALIDA VIGENTE
--   So entram nas duas tabelas itens de cupons com flagvc.Venda = 1 (join
--   vendacupom.Flag = flagvc.flag) E vendacupom.Status = 0 (ativa; 5 =
--   cancelada). Fonte unica: backend/src/shared/vendaValida.js
--   (JOIN_VENDA_VALIDA + WHERE_VENDA_VALIDA). O comentario da 001 que cita
--   "flagvc.flag = 1" esta desatualizado (ver 003).
--   Joins de origem: vendacupom.idcupom = vendaitem.idcupom;
--   vendaitem.produto = produto.idProduto.
--
-- TIPO DA COLUNA produto
--   INT (com sinal), o mesmo de vendaitem.produto, verificado em modo somente
--   leitura na Task 5.3 (ver cabecalho de modules/vendas/
--   vendasDepartamento.service.js). Sem FOREIGN KEY para produto: o cache nao
--   cria dependencia nem lock no schema legado, e um produto removido do
--   cadastro continua com seu historico de vendas.
--
-- -----------------------------------------------------------------------------
-- (a) vendas_produto_dia_cache - uma linha por (dia, produto)
-- -----------------------------------------------------------------------------
--   dia             : vendacupom.data (dia do calendario da loja).
--   produto         : vendaitem.produto.
--   quantidade      : SUM(vendaitem.qt). vendaitem.qt e DOUBLE no ERP
--                     (fracionario em pesaveis); aqui DECIMAL(19,4) para que a
--                     soma de varias linhas diarias seja exata. Arredonda a 4
--                     casas por dia/produto - suficiente para kg/unidade.
--   faturamento     : SUM(vendaitem.vtotal) (DECIMAL(19,4) no ERP; mesma
--                     precisao de vendas_periodo_cache.faturamento_total).
--   custo_total     : CMV = SUM(vendaitem.qt * vendaitem.pcusto) (custo gravado
--                     no item na hora da venda, mesma formula do criterio
--                     margem da Task 7.1). NULL permitido.
--   itens_sem_custo : quantos itens (linhas de vendaitem) do dia/produto nao
--                     tem custo (pcusto NULL). Serve para o gestor enxergar
--                     falha de cadastro de custo.
--   atualizado_em   : momento da ultima gravacao da linha. E o
--                     CURRENT_TIMESTAMP da SESSAO do MariaDB (fuso definido
--                     pelo time_zone da sessao/servidor), NAO necessariamente
--                     UTC: o timezone 'Z' do pool (connection.js) so afeta a
--                     conversao de datas feita pelo driver mysql2 e nao altera
--                     o time_zone da sessao.
--                     Sem ON UPDATE automatico (igual a 001): o job seta
--                     atualizado_em = CURRENT_TIMESTAMP no ON DUPLICATE KEY.
--                     O criterio de "dia fechado" (abaixo) compara
--                     atualizado_em com o inicio do dia seguinte, entao so e
--                     correto se a sessao estiver no MESMO fuso do dia de
--                     negocio da loja (Brasil). Antes de aplicar, conferir em
--                     modo somente leitura: SELECT @@time_zone, NOW()
--
--   LINHA SENTINELA (produto = 0) = MARCADOR DE "DIA COMPLETO"
--     Para CADA dia processado (com ou sem vendas) o job grava POR ULTIMO a
--     linha (dia, produto = 0, quantidade 0, faturamento 0, custo_total NULL,
--     itens_sem_custo 0), depois de todas as linhas de produto do dia.
--     produto = 0 e RESERVADO: produto.idProduto do ERP e INT positivo, e o
--     job descarta qualquer linha agregada com produto <= 0 (colidiria com a
--     sentinela).
--     Um dia so e considerado coberto/"fechado" quando a sentinela existe com
--     atualizado_em >= inicio do dia seguinte (gravada depois de o dia
--     terminar). Sem sentinela, ou com sentinela anterior a isso, o dia e
--     tratado como nao coberto/parcial (hoje nunca e fechado).
--     Todo leitor desta tabela deve IGNORAR a sentinela: filtrar produto > 0
--     (ou INNER JOIN com produto), inclusive em somas e contagens.
--
--   CUSTO PARCIAL (decisao do usuario, implementada no job da Task 7.4)
--     custo_total     = SUM(qt * pcusto) somente dos itens que TEM pcusto;
--                       fica NULL so se NENHUM item do dia/produto tem custo.
--     itens_sem_custo = SUM(pcusto IS NULL).
--     "Sem custo" = pcusto IS NULL apenas; pcusto = 0 e custo valido (mesma
--     regra da Task 7.1).
--     Regra de leitura: itens_sem_custo > 0 (SUM no periodo) => custo, lucro
--     e margem DESCONHECIDOS (nao usar o custo_total parcial como se fosse o
--     custo completo).
--
--   CHAVE / INDICES
--     PRIMARY KEY (dia, produto): e a chave unica do upsert e, no InnoDB, o
--       indice clusterizado - a leitura por periodo (WHERE dia BETWEEN ? AND ?)
--       e um range scan contiguo que ja traz todas as colunas, sem lookup
--       extra. Por isso nao ha coluna id AUTO_INCREMENT (diferente da 001).
--     KEY idx_produto_dia (produto, dia): leitura por produto (historico de um
--       produto, ou periodo de um conjunto pequeno de produtos).
--
--   CANCELAMENTOS POSTERIORES (tratado no job da Task 7.4)
--     O usuario da aplicacao NAO tem DELETE. Se um cupom for cancelado depois
--     de agregado e um (dia, produto) ficar sem venda valida, o job
--     sobrescreve a linha com quantidade = 0, faturamento = 0,
--     custo_total = NULL, itens_sem_custo = 0 (nao consegue apagar). A
--     sentinela (produto = 0) nunca entra nesse tratamento. Consumidores devem
--     tratar linha zerada como "sem venda".
--
-- -----------------------------------------------------------------------------
-- (b) primeira_venda_produto - uma linha por produto
-- -----------------------------------------------------------------------------
--   produto        : vendaitem.produto (PRIMARY KEY - unico).
--   primeira_venda : dia da primeira venda valida do produto em todo o
--                    historico (MIN(vendacupom.data)).
--   atualizado_em  : momento da ultima gravacao da linha.
--   KEY idx_primeira_venda (primeira_venda): /novos filtra
--     WHERE primeira_venda BETWEEN ? AND ?.
--   Upsert sugerido: primeira_venda = LEAST(primeira_venda,
--   VALUES(primeira_venda)). Limitacao: LEAST nunca "avanca" a data se a venda
--   mais antiga for cancelada depois; se isso importar, recalcular a partir de
--   MIN(dia) de vendas_produto_dia_cache com quantidade > 0 (exige o cache
--   diario cobrindo o historico inteiro). O preenchimento inicial e uma
--   varredura pesada do historico - rodar fora do horario de uso.
--
-- IDEMPOTENCIA
--   Os dois CREATE usam IF NOT EXISTS. Rodar a migration de novo e um no-op
--   (o MariaDB so emite o warning 1050 "table already exists") e nao altera
--   nem apaga linhas ja gravadas. Nao ha DROP, ALTER, INSERT, UPDATE ou DELETE.
--   Limitacao conhecida: IF NOT EXISTS nao compara estrutura - se uma tabela
--   com o mesmo nome e outra estrutura ja existir, ela e mantida como esta
--   (conferir com SHOW CREATE TABLE apos aplicar).
--
-- A frequencia do job que popula estas tabelas segue como "Decisao em aberto"
-- (CLAUDE.md / SPEC.md) e fica fora desta migration.
-- =============================================================================

CREATE TABLE IF NOT EXISTS `vendas_produto_dia_cache` (
  `dia` DATE NOT NULL,
  `produto` INT NOT NULL,
  `quantidade` DECIMAL(19,4) NOT NULL DEFAULT '0.0000',
  `faturamento` DECIMAL(19,4) NOT NULL DEFAULT '0.0000',
  `custo_total` DECIMAL(19,4) NULL DEFAULT NULL,
  `itens_sem_custo` INT UNSIGNED NOT NULL DEFAULT '0',
  `atualizado_em` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`dia`, `produto`),
  KEY `idx_produto_dia` (`produto`, `dia`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `primeira_venda_produto` (
  `produto` INT NOT NULL,
  `primeira_venda` DATE NOT NULL,
  `atualizado_em` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`produto`),
  KEY `idx_primeira_venda` (`primeira_venda`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
