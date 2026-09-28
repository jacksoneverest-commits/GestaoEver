const path = require('path');
const { readInput, projectRoot, runNpmTest, allow, block } = require('../_lib/hookUtils');

const input = readInput();
const backendDir = path.join(projectRoot(input), 'backend');
const { passed, output } = runNpmTest(backendDir);

if (!passed) {
  block(
    'database-engineer: não é possível encerrar a task com os testes do backend falhando. ' +
    `Rode "npm test" em backend/ e corrija antes de finalizar.\n\n${output}`
  );
}

allow();
