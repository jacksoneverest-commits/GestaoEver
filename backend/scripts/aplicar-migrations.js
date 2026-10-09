// Aplica, em ordem, os .sql de uma pasta de migrations. Usado pelo instalador (autorizado
// explicitamente pelo usuário em 2026-10-09). Registra cada arquivo aplicado em
// migrations_aplicadas e nunca reaplica um registrado; as migrations atuais também são idempotentes.
// Uso: node scripts/aplicar-migrations.js <pastaDasMigrations>
// Exit code 0 = tudo aplicado; 1 = falha (para na primeira que falhar).
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const pasta = process.argv[2];
  if (!pasta || !fs.existsSync(pasta)) {
    console.error('Uso: node scripts/aplicar-migrations.js <pastaDasMigrations>');
    return 1;
  }
  const arquivos = fs.readdirSync(pasta).filter((nome) => /^\d+_.*\.sql$/.test(nome)).sort();

  const conexao = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });
  try {
    await conexao.query(
      'CREATE TABLE IF NOT EXISTS `migrations_aplicadas` (' +
        '`arquivo` VARCHAR(150) NOT NULL, `aplicada_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
        'PRIMARY KEY (`arquivo`)) ENGINE=InnoDB'
    );
    const [linhas] = await conexao.query('SELECT arquivo FROM migrations_aplicadas');
    const aplicadas = new Set(linhas.map((l) => l.arquivo));

    for (const arquivo of arquivos) {
      if (aplicadas.has(arquivo)) {
        console.log(`Já registrada: ${arquivo}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(pasta, arquivo), 'utf8');
      try {
        await conexao.query(sql);
      } catch (erro) {
        console.error(`Falha em ${arquivo} (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`);
        return 1;
      }
      await conexao.execute('INSERT INTO migrations_aplicadas (arquivo) VALUES (?)', [arquivo]);
      console.log(`Aplicada: ${arquivo}`);
    }
    return 0;
  } finally {
    await conexao.end();
  }
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((erro) => {
    console.error(`Falha ao aplicar migrations (código: ${erro && erro.code ? erro.code : 'desconhecido'}).`);
    process.exit(1);
  });
