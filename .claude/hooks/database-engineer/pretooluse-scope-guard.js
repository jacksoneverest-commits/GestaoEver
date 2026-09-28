const { readInput, getCommand, getFilePath, normalizePath, block, allow } = require('../_lib/hookUtils');

const LEGACY_TABLES = [
  'vendacupom',
  'vendaitem',
  'produto',
  'clifor',
  'setor',
  'grupo',
  'familia',
  'formapag',
  'flagvc',
];

const input = readInput();
const toolName = input.tool_name || '';

if (toolName === 'Bash') {
  const command = getCommand(input);

  if (/\bgit\s+push\b/i.test(command)) {
    block(
      'database-engineer: "git push" está fora de escopo deste agent. ' +
      'Push é uma ação visível para outras pessoas e deve ser confirmada explicitamente pelo usuário.'
    );
  }

  const destructiveMatch = command.match(/\b(DROP|ALTER|TRUNCATE)\s+TABLE\s+`?(\w+)`?/i);
  if (destructiveMatch && LEGACY_TABLES.includes(destructiveMatch[2].toLowerCase())) {
    block(
      `database-engineer: comando destrutivo (${destructiveMatch[1].toUpperCase()}) contra a tabela do ERP existente "${destructiveMatch[2]}" foi bloqueado. ` +
      'Este agent só pode criar tabelas novas de cache/histórico — nunca alterar o schema do sistema legado.'
    );
  }

  if (/\bDROP\s+DATABASE\b/i.test(command)) {
    block('database-engineer: "DROP DATABASE" é uma operação destrutiva irreversível e nunca é permitida por este agent.');
  }
}

if (toolName === 'Write' || toolName === 'Edit') {
  const filePath = normalizePath(getFilePath(input));

  if (filePath.includes('frontend/')) {
    block(
      'database-engineer: este agent não edita código de frontend. ' +
      `O caminho "${filePath}" é escopo do agent frontend-engineer.`
    );
  }

  if (filePath.includes('backend/src/modules/')) {
    block(
      'database-engineer: controllers e services de API são escopo do agent backend-engineer, não deste agent. ' +
      'Este agent trabalha apenas em backend/src/db/ e backend/src/jobs/.'
    );
  }
}

allow();
