const path = require('path');
const { readInput, getFilePath, normalizePath, projectRoot, runNpmTest, allow, block } = require('../_lib/hookUtils');

const input = readInput();
const toolName = input.tool_name || '';

if (toolName !== 'Write' && toolName !== 'Edit') {
  allow();
}

const filePath = normalizePath(getFilePath(input));

if (!filePath.includes('backend/src/db/') && !filePath.includes('backend/src/jobs/')) {
  allow();
}

const backendDir = path.join(projectRoot(input), 'backend');
const { passed, output } = runNpmTest(backendDir);

if (!passed) {
  block(
    `database-engineer: os testes do backend falharam após editar "${filePath}" (migration/job). Corrija antes de seguir.\n\n${output}`
  );
}

allow();
