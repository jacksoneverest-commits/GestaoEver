const path = require('path');
const { readInput, getFilePath, normalizePath, projectRoot, runNpmTest, allow, block } = require('../_lib/hookUtils');

const input = readInput();
const toolName = input.tool_name || '';

if (toolName !== 'Write' && toolName !== 'Edit') {
  allow();
}

const filePath = normalizePath(getFilePath(input));

if (!filePath.includes('backend/')) {
  allow();
}

const backendDir = path.join(projectRoot(input), 'backend');
const { passed, output } = runNpmTest(backendDir);

if (!passed) {
  block(
    `backend-engineer: os testes do backend falharam após editar "${filePath}". Corrija antes de seguir para a próxima task.\n\n${output}`
  );
}

allow();
