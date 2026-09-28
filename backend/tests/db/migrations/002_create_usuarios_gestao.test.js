const fs = require('fs');
const path = require('path');

// Verificacao estatica do SQL da migration: testes de backend nunca dependem
// do MariaDB real de producao (.claude/rules/testes.md).
const MIGRATION_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  'db',
  'migrations',
  '002_create_usuarios_gestao.sql'
);

const COLUNAS_ESPERADAS = [
  'id',
  'usuario',
  'nome',
  'senha_hash',
  'perfil',
  'ativo',
  'criado_em',
];

function lerSqlBruto() {
  return fs.readFileSync(MIGRATION_PATH, 'utf8');
}

function lerSqlSemComentarios() {
  return lerSqlBruto()
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
  const regex = /^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*)\)([^)]*)$/i;
  return statements
    .filter((s) => /^CREATE\s+TABLE/i.test(s))
    .map((s) => {
      const match = s.match(regex);
      if (!match) {
        throw new Error(`CREATE TABLE nao reconhecido: ${s.slice(0, 80)}`);
      }
      const corpo = match[3];
      const linhas = corpo
        .split('\n')
        .map((linha) => linha.trim())
        .filter((linha) => linha.length > 0);
      const colunas = linhas
        .filter((linha) => !/^(PRIMARY|KEY|INDEX|UNIQUE|CONSTRAINT|FOREIGN)\b/i.test(linha))
        .map((linha) => linha.match(/^`?(\w+)`?/)[1]);
      const definicaoColuna = (nome) =>
        linhas.find((linha) => new RegExp(`^\`?${nome}\`?\\s`, 'i').test(linha)) || '';
      return {
        nome: match[2],
        ifNotExists: Boolean(match[1]),
        colunas,
        corpo,
        opcoes: match[4],
        definicaoColuna,
      };
    });
}

describe('migration 002_create_usuarios_gestao.sql', () => {
  it('cria usuarios_gestao com as colunas, tipos e UNIQUE esperados', () => {
    const statements = extrairStatements(lerSqlSemComentarios());
    const tabelas = extrairCreateTables(statements);

    expect(tabelas.map((t) => t.nome)).toEqual(['usuarios_gestao']);
    const [tabela] = tabelas;

    expect(tabela.colunas).toEqual(COLUNAS_ESPERADAS);

    expect(tabela.definicaoColuna('id')).toMatch(/INT\s+UNSIGNED\s+NOT\s+NULL\s+AUTO_INCREMENT/i);
    // latin1_bin: login diferencia maiusculas/minusculas e acentos.
    expect(tabela.definicaoColuna('usuario')).toMatch(
      /VARCHAR\(50\)\s+CHARACTER\s+SET\s+latin1\s+COLLATE\s+latin1_bin\s+NOT\s+NULL/i
    );
    expect(tabela.definicaoColuna('nome')).toMatch(/VARCHAR\(100\)\s+NOT\s+NULL/i);
    expect(tabela.definicaoColuna('senha_hash')).toMatch(/VARCHAR\(255\)\s+NOT\s+NULL/i);
    expect(tabela.definicaoColuna('perfil')).toMatch(
      /VARCHAR\(20\)\s+NOT\s+NULL\s+DEFAULT\s+'gestor'/i
    );
    expect(tabela.definicaoColuna('ativo')).toMatch(/TINYINT\(1\)\s+NOT\s+NULL\s+DEFAULT\s+'?1'?/i);
    expect(tabela.definicaoColuna('criado_em')).toMatch(
      /TIMESTAMP\s+NOT\s+NULL\s+DEFAULT\s+CURRENT_TIMESTAMP/i
    );

    expect(tabela.corpo).toMatch(/PRIMARY\s+KEY\s*\(\s*`?id`?\s*\)/i);
    expect(tabela.corpo).toMatch(
      /UNIQUE\s+KEY\s+`?uq_usuarios_gestao_usuario`?\s*\(\s*`?usuario`?\s*\)/i
    );
    expect(tabela.opcoes).toMatch(/ENGINE\s*=\s*InnoDB/i);
    expect(tabela.opcoes).toMatch(/CHARSET\s*=\s*latin1/i);

    // Apenas ASCII no arquivo inteiro (evita problemas de charset latin1/utf8).
    expect(lerSqlBruto()).toMatch(/^[\x00-\x7F]*$/);
  });

  it('pode ser executada novamente sem corromper dados (IF NOT EXISTS, sem DROP/ALTER/UPDATE/DELETE/TRUNCATE)', () => {
    const sql = lerSqlSemComentarios();
    const statements = extrairStatements(sql);
    const tabelas = extrairCreateTables(statements);

    expect(tabelas).toHaveLength(1);
    expect(tabelas[0].ifNotExists).toBe(true);

    // Toda instrucao da migration e um CREATE TABLE IF NOT EXISTS - nada que
    // altere, apague ou sobrescreva dados ja existentes (nem INSERT de seed).
    for (const statement of statements) {
      expect(statement).toMatch(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i);
    }
    expect(sql).not.toMatch(/\b(DROP|ALTER|UPDATE|DELETE|TRUNCATE|REPLACE|RENAME|INSERT)\b/i);
  });
});
