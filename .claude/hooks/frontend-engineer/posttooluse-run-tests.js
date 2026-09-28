const path = require('path');
const { readInput, getFilePath, normalizePath, projectRoot, runNpmTest, allow, block } = require('../_lib/hookUtils');

const input = readInput();
const toolName = input.tool_name || '';

if (toolName !== 'Write' && toolName !== 'Edit') {
  allow();
}

const filePath = normalizePath(getFilePath(input));

if (!filePath.includes('frontend/')) {
  allow();
}

const frontendDir = path.join(projectRoot(input), 'frontend');
const { passed, output } = runNpmTest(frontendDir);

if (!passed) {
  block(
    `frontend-engineer: os testes do frontend falharam após editar "${filePath}". Corrija antes de seguir para a próxima task.\n\n${output}`
  );
}

allow();
