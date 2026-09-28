const fs = require('fs');
const path = require('path');

// Verificação estática do SQL da migration: testes de backend nunca dependem
// do MariaDB real de produção (.claude/rules/testes.md).
const MIGRATION_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  'db',
  'migrations',
  '001_create_cache_tables.sql'
);

const COLUNAS_ESPERADAS = [
  'id',
  'periodo_inicio',
  'periodo_fim',
  'faturamento_total',
  'quantidade_cupons',
  'atualizado_em',
];

const TABELAS_ESPERADAS = ['vendas_periodo_cache', 'compras_periodo_cache'];

function lerSqlSemComentarios() {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(--|#)[^\n]*/g, ' ');
}

function extrairStatements(sql) {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function extrairCreateTables(statements) {
  const regex = /^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*)\)[^)]*$/i;
  return statements
    .filter((s) => /^CREATE\s+TABLE/i.test(s))
    .map((s) => {
      const match = s.match(regex);
      if (!match) {
        throw new Error(`CREATE TABLE não reconhecido: ${s.slice(0, 80)}`);
      }
      const corpo = match[3];
      const colunas = corpo
        .split('\n')
        .map((linha) => linha.trim())
        .filter((linha) => linha.length > 0)
        .filter((linha) => !/^(PRIMARY|KEY|INDEX|UNIQUE|CONSTRAINT|FOREIGN)\b/i.test(linha))
        .map((linha) => linha.match(/^`?(\w+)`?/)[1]);
      return {
        nome: match[2],
        ifNotExists: Boolean(match[1]),
        colunas,
        corpo,
      };
    });
}

describe('migration 001_create_cache_tables.sql', () => {
  it('cria vendas_periodo_cache e compras_periodo_cache com as colunas esperadas', () => {
    const statements = extrairStatements(lerSqlSemComentarios());
    const tabelas = extrairCreateTables(statements);

    expect(tabelas.map((t) => t.nome).sort()).toEqual([...TABELAS_ESPERADAS].sort());

    for (const tabela of tabelas) {
      expect(tabela.colunas).toEqual(COLUNAS_ESPERADAS);
      expect(tabela.corpo).toMatch(/`?faturamento_total`?\s+DECIMAL\(19,\s*4\)/i);
      expect(tabela.corpo).toMatch(/`?atualizado_em`?\s+\w+[^,]*DEFAULT\s+CURRENT_TIMESTAMP/i);
      expect(tabela.corpo).toMatch(/PRIMARY\s+KEY\s*\(\s*`?id`?\s*\)/i);
      expect(tabela.corpo).toMatch(
        /KEY\s+`?\w+`?\s*\(\s*`?periodo_inicio`?\s*,\s*`?periodo_fim`?\s*,\s*`?atualizado_em`?\s*\)/i
      );
    }
  });

  it('pode ser executada novamente sem corromper dados (IF NOT EXISTS, sem DROP/ALTER/UPDATE/DELETE/TRUNCATE)', () => {
    const sql = lerSqlSemComentarios();
    const statements = extrairStatements(sql);
    const tabelas = extrairCreateTables(statements);

    expect(tabelas).toHaveLength(TABELAS_ESPERADAS.length);
    for (const tabela of tabelas) {
      expect(tabela.ifNotExists).toBe(true);
    }

    // Toda instrução da migration é um CREATE TABLE IF NOT EXISTS — nada que
    // altere, apague ou sobrescreva dados já existentes.
    for (const statement of statements) {
      expect(statement).toMatch(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i);
    }
    expect(sql).not.toMatch(/\b(DROP|ALTER|UPDATE|DELETE|TRUNCATE|REPLACE|RENAME)\b/i);
  });
});
