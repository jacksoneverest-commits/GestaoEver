const { readInput, block, allow } = require('../_lib/hookUtils');

const input = readInput();
const toolName = input.tool_name || '';

if (toolName === 'Write' || toolName === 'Edit' || toolName === 'Bash') {
  block(
    `code-reviewer: este agent é somente leitura — revisa e reporta achados, nunca modifica código nem executa comandos (tentativa de usar "${toolName}" bloqueada). ` +
    'Se uma correção for necessária, descreva o que precisa mudar e delegue para o agent de implementação apropriado (backend-engineer, frontend-engineer ou database-engineer).'
  );
}

allow();
