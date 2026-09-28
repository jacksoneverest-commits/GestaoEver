const path = require('path');
const { readInput, projectRoot, runNpmTest, allow, block } = require('../_lib/hookUtils');

const input = readInput();
const frontendDir = path.join(projectRoot(input), 'frontend');
const { passed, output } = runNpmTest(frontendDir);

if (!passed) {
  block(
    'frontend-engineer: não é possível encerrar a task com os testes do frontend falhando. ' +
    `Rode "npm test" em frontend/ e corrija antes de finalizar.\n\n${output}`
  );
}

allow();
