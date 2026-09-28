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
  '004_create_cache_produto.sql'
);

const TABELAS_ESPERADAS = ['vendas_produto_dia_cache', 'primeira_venda_produto'];

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

function normalizarColunas(lista) {
  return lista.split(',').map((c) => c.replace(/`/g, '').trim());
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
      const linhas = corpo
        .split('\n')
        .map((linha) => linha.trim())
        .filter((linha) => linha.length > 0);
      const colunas = {};
      for (const linha of linhas) {
        if (/^(PRIMARY|KEY|INDEX|UNIQUE|CONSTRAINT|FOREIGN)\b/i.test(linha)) continue;
        const [, nome, definicao] = linha.match(/^`?(\w+)`?\s+(.*?),?$/);
        colunas[nome] = definicao;
      }
      const pk = corpo.match(/PRIMARY\s+KEY\s*\(([^)]*)\)/i);
      const uniques = [...corpo.matchAll(/UNIQUE\s+(?:KEY|INDEX)\s+`?\w+`?\s*\(([^)]*)\)/gi)].map((m) =>
        normalizarColunas(m[1])
      );
      const indices = [...corpo.matchAll(/(?:^|\n)\s*(?:KEY|INDEX)\s+`?\w+`?\s*\(([^)]*)\)/gi)].map((m) =>
        normalizarColunas(m[1])
      );
      return {
        nome: match[2],
        ifNotExists: Boolean(match[1]),
        colunas,
        chavesUnicas: [...(pk ? [normalizarColunas(pk[1])] : []), ...uniques],
        indices,
        opcoes: s.slice(s.lastIndexOf(')')),
      };
    });
}

describe('migration 004_create_cache_produto.sql', () => {
  it('cria vendas_produto_dia_cache e primeira_venda_produto com as chaves unicas esperadas', () => {
    const tabelas = extrairCreateTables(extrairStatements(lerSqlSemComentarios()));
    expect(tabelas.map((t) => t.nome).sort()).toEqual([...TABELAS_ESPERADAS].sort());
    const porNome = Object.fromEntries(tabelas.map((t) => [t.nome, t]));

    // (a) vendas por dia e por produto: chave unica (dia, produto) para upsert
    const dia = porNome.vendas_produto_dia_cache;
    expect(dia.chavesUnicas).toContainEqual(['dia', 'produto']);
    expect(dia.colunas.dia).toMatch(/^DATE\s+NOT\s+NULL/i);
    expect(dia.colunas.produto).toMatch(/^INT\b.*NOT\s+NULL/i); // vendaitem.produto / produto.idProduto = int
    expect(dia.colunas.quantidade).toMatch(/^DECIMAL\(19,\s*4\)\s+NOT\s+NULL/i);
    expect(dia.colunas.faturamento).toMatch(/^DECIMAL\(19,\s*4\)\s+NOT\s+NULL/i);
    expect(dia.colunas.custo_total).toMatch(/^DECIMAL\(19,\s*4\)\s+NULL/i); // NULL = sem custo cadastrado
    expect(dia.colunas.itens_sem_custo).toMatch(/^INT\b.*NOT\s+NULL/i);
    expect(dia.colunas.atualizado_em).toMatch(/TIMESTAMP[^,]*DEFAULT\s+CURRENT_TIMESTAMP/i);
    expect(dia.indices).toContainEqual(['produto', 'dia']); // leitura por produto

    // (b) primeira venda valida por produto: produto unico
    const primeira = porNome.primeira_venda_produto;
    expect(primeira.chavesUnicas).toContainEqual(['produto']);
    expect(primeira.colunas.produto).toMatch(/^INT\b.*NOT\s+NULL/i);
    expect(primeira.colunas.primeira_venda).toMatch(/^DATE\s+NOT\s+NULL/i);
    expect(primeira.indices).toContainEqual(['primeira_venda']); // /novos filtra por periodo

    for (const tabela of tabelas) {
      expect(tabela.opcoes).toMatch(/ENGINE\s*=\s*InnoDB/i);
      expect(tabela.opcoes).toMatch(/CHARSET\s*=\s*latin1/i);
    }
  });

  it('pode ser executada novamente sem corromper dados (so CREATE TABLE IF NOT EXISTS, nao toca tabelas do ERP)', () => {
    const sql = lerSqlSemComentarios();
    const statements = extrairStatements(sql);

    expect(statements).toHaveLength(TABELAS_ESPERADAS.length);
    for (const statement of statements) {
      expect(statement).toMatch(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i);
    }
    expect(sql).not.toMatch(/\b(DROP|ALTER|UPDATE|DELETE|TRUNCATE|INSERT|REPLACE|RENAME|MODIFY|CHANGE|SELECT)\b/i);
    // Nenhuma referencia a tabelas do ERP nem a caches de migrations anteriores
    expect(sql).not.toMatch(
      /\b(vendacupom|vendaitem|clifor|setor|grupo|familia|formapag|flagvc|vendas_periodo_cache|compras_periodo_cache|usuarios_gestao)\b/i
    );
    // Sem FOREIGN KEY para produto do ERP (nao cria dependencia/lock no schema legado)
    expect(sql).not.toMatch(/\b(FOREIGN\s+KEY|REFERENCES)\b/i);
  });
});
