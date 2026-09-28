const { readInput, getCommand, getFilePath, normalizePath, block, allow } = require('../_lib/hookUtils');

const input = readInput();
const toolName = input.tool_name || '';

if (toolName === 'Bash') {
  const command = getCommand(input);

  if (/\bgit\s+push\b/i.test(command)) {
    block(
      'frontend-engineer: "git push" está fora de escopo deste agent. ' +
      'Push é uma ação visível para outras pessoas e deve ser confirmada explicitamente pelo usuário.'
    );
  }

  if (/\b(mysql|mariadb)\b/i.test(command)) {
    block(
      'frontend-engineer: este agent não acessa o banco de dados diretamente. ' +
      'Toda leitura de dados deve vir da API do backend, via a camada frontend/src/services/.'
    );
  }
}

if (toolName === 'Write' || toolName === 'Edit') {
  const filePath = normalizePath(getFilePath(input));

  if (filePath.includes('backend/')) {
    block(
      'frontend-engineer: este agent só edita arquivos em frontend/. ' +
      `O caminho "${filePath}" pertence ao backend, que é escopo do agent backend-engineer.`
    );
  }
}

allow();
