const { readInput, getCommand, getFilePath, normalizePath, block, allow } = require('../_lib/hookUtils');

const input = readInput();
const toolName = input.tool_name || '';

if (toolName === 'Bash') {
  const command = getCommand(input);

  if (/\bgit\s+push\b/i.test(command)) {
    block(
      'backend-engineer: "git push" está fora de escopo deste agent. ' +
      'Push é uma ação visível para outras pessoas e deve ser confirmada explicitamente pelo usuário, não decidida por um subagent de implementação.'
    );
  }

  if (/\b(DROP|ALTER|TRUNCATE)\s+TABLE\b/i.test(command)) {
    block(
      'backend-engineer: comandos destrutivos de schema (DROP/ALTER/TRUNCATE TABLE) não são responsabilidade deste agent. ' +
      'Desenho de schema e migrations são escopo do agent database-engineer.'
    );
  }
}

if (toolName === 'Write' || toolName === 'Edit') {
  const filePath = normalizePath(getFilePath(input));

  if (filePath.includes('frontend/')) {
    block(
      'backend-engineer: este agent só edita arquivos em backend/. ' +
      `O caminho "${filePath}" pertence ao frontend, que é escopo do agent frontend-engineer.`
    );
  }

  if (filePath.includes('backend/src/db/migrations/')) {
    block(
      'backend-engineer: migrations de banco de dados são escopo do agent database-engineer, não deste agent. ' +
      'Implemente apenas o controller/service que consome as tabelas já existentes.'
    );
  }
}

allow();
