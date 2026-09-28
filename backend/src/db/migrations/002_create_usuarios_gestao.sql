-- =============================================================================
-- Migration 002 - Tabela de usuarios do GestaoEverSoftPlus (PLAN.md, Task 3.1)
-- Alvo: MariaDB 10.1.41, banco do ERP (engine InnoDB, charset latin1, igual as
-- tabelas do ERP e a migration 001).
--
-- Tabela propria do GestaoEverSoftPlus (decisao do usuario para o login).
-- Nao reaproveita nem altera nenhuma tabela do ERP (clifor etc.).
--
-- Esta migration e definitiva: depois de aplicada, NAO e editada. Qualquer
-- mudanca de schema vira uma nova migration numerada (003_..., 004_...).
--
-- IDEMPOTENCIA
--   Unico comando: CREATE TABLE IF NOT EXISTS. Rodar de novo e um no-op (o
--   MariaDB so emite um warning "table already exists") e nao altera nem
--   apaga linhas ja gravadas. Nenhum usuario inicial (seed) e criado aqui.
--   Limitacao conhecida: IF NOT EXISTS nao compara estrutura - se uma tabela
--   com o mesmo nome e outra estrutura ja existir, ela e mantida como esta.
--
-- SEMANTICA DAS COLUNAS
--   usuario    : login, unico (uq_usuarios_gestao_usuario). Collation
--                latin1_bin (comparacao binaria): o login DIFERENCIA
--                maiusculas/minusculas e acentos - "Joao", "joao" e "joao"
--                com til sao logins distintos, tanto no UNIQUE quanto no
--                WHERE usuario = ? do login.
--                Limitacao: no MariaDB 10.1 toda collation e PAD SPACE, entao
--                espacos FINAIS continuam ignorados na comparacao ("joao" e
--                "joao " colidem no UNIQUE). A aplicacao deve fazer trim do
--                usuario no cadastro e no login.
--   nome       : nome de exibicao.
--   senha_hash : hash scrypt formatado pela aplicacao. NUNCA senha em texto.
--   perfil     : 'dono', 'gestor' ou 'gerente_loja'. Sem CHECK (MariaDB 10.1
--                nao aplica CHECK); validacao feita na aplicacao. Nesta fase
--                os perfis NAO diferenciam permissoes (CLAUDE.md).
--   ativo      : 1 = pode logar, 0 = bloqueado. O login deve filtrar ativo = 1.
--   criado_em  : TIMESTAMP, armazenado em UTC pelo MariaDB e convertido pelo
--                time_zone da sessao.
--
-- OBSERVACAO DE PERMISSOES
--   Conforme a migration 001, o usuario da aplicacao tem apenas SELECT, INSERT
--   e CREATE. Desativar usuario ou trocar senha exigiria UPDATE - fora do
--   escopo desta migration; cadastro/manutencao de usuarios fica a cargo do
--   orquestrador/DBA.
-- =============================================================================

CREATE TABLE IF NOT EXISTS `usuarios_gestao` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `usuario` VARCHAR(50) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  `nome` VARCHAR(100) NOT NULL,
  `senha_hash` VARCHAR(255) NOT NULL,
  `perfil` VARCHAR(20) NOT NULL DEFAULT 'gestor',
  `ativo` TINYINT(1) NOT NULL DEFAULT '1',
  `criado_em` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_usuarios_gestao_usuario` (`usuario`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
