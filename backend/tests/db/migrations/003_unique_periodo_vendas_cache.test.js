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
  '003_unique_periodo_vendas_cache.sql'
);

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

const REGEX_ADD_UNIQUE =
  /^ALTER\s+TABLE\s+`?(\w+)`?\s+ADD\s+UNIQUE\s+(?:KEY|INDEX)\s+(IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(\s*`?(\w+)`?\s*,\s*`?(\w+)`?\s*\)$/i;

describe('migration 003_unique_periodo_vendas_cache.sql', () => {
  it('cria a chave unica uq_vendas_periodo sobre (periodo_inicio, periodo_fim) em vendas_periodo_cache', () => {
    const statements = extrairStatements(lerSqlSemComentarios());

    expect(statements).toHaveLength(1);
    const match = statements[0].match(REGEX_ADD_UNIQUE);
    expect(match).not.toBeNull();

    const [, tabela, , nomeChave, coluna1, coluna2] = match;
    expect(tabela).toBe('vendas_periodo_cache');
    expect(nomeChave).toBe('uq_vendas_periodo');
    expect([coluna1, coluna2]).toEqual(['periodo_inicio', 'periodo_fim']);
  });

  it('pode ser executada novamente sem corromper dados (IF NOT EXISTS, sem DROP/DELETE/TRUNCATE/UPDATE/INSERT, so toca vendas_periodo_cache)', () => {
    const sql = lerSqlSemComentarios();
    const statements = extrairStatements(sql);

    for (const statement of statements) {
      const match = statement.match(REGEX_ADD_UNIQUE);
      expect(match).not.toBeNull();
      expect(Boolean(match[2])).toBe(true); // IF NOT EXISTS presente
    }

    expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|REPLACE|RENAME|MODIFY|CHANGE)\b/i);
    expect(sql).not.toMatch(/compras_periodo_cache/i);

    const tabelasReferenciadas = sql.match(/\b\w+_periodo_cache\b|\bvendacupom\b|\bvendaitem\b|\bproduto\b/gi) || [];
    expect(new Set(tabelasReferenciadas.map((t) => t.toLowerCase()))).toEqual(
      new Set(['vendas_periodo_cache'])
    );
  });
});
