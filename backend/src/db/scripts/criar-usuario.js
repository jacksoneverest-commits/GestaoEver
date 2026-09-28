// Cria um usuário em usuarios_gestao (necessário para o primeiro login).
// Uso: node src/db/scripts/criar-usuario.js <usuario> "<nome>" <perfil>
// A senha vem da variável de ambiente NOVA_SENHA ou de um prompt oculto no terminal.
// Nunca é aceita como argumento de linha de comando.
const path = require('path');
const { hashSenha } = require('../../modules/auth/auth.crypto');

const PERFIS_VALIDOS = ['dono', 'gestor', 'gerente_loja'];
const TAMANHO_MINIMO_SENHA = 8;

// Lógica pura e testável: valida, gera o hash scrypt e insere via query parametrizada.
async function criarUsuario({ usuario, nome, perfil, senha }, pool) {
  if (typeof usuario !== 'string' || !usuario.trim() || usuario.length > 50) {
    throw new Error('Usuário inválido: informe um login de até 50 caracteres.');
  }
  if (typeof nome !== 'string' || !nome.trim() || nome.length > 100) {
    throw new Error('Nome inválido: informe um nome de até 100 caracteres.');
  }
  if (!PERFIS_VALIDOS.includes(perfil)) {
    throw new Error(`Perfil inválido: use um de ${PERFIS_VALIDOS.join(', ')}.`);
  }
  if (typeof senha !== 'string' || senha.length < TAMANHO_MINIMO_SENHA) {
    throw new Error(`Senha inválida: use pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
  }

  const senhaHash = await hashSenha(senha);
  await pool.execute(
    'INSERT INTO usuarios_gestao (usuario, nome, senha_hash, perfil, ativo) VALUES (?, ?, ?, ?, 1)',
    [usuario.trim(), nome.trim(), senhaHash, perfil]
  );
}

// Lê a senha do terminal sem ecoar os caracteres.
function lerSenhaOculta(pergunta) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('Sem terminal interativo: defina a variável de ambiente NOVA_SENHA.'));
      return;
    }
    process.stdout.write(pergunta);
    let senha = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const aoReceber = (chunk) => {
      for (const caractere of chunk) {
        if (caractere === '\r' || caractere === '\n' || caractere === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', aoReceber);
          process.stdout.write('\n');
          resolve(senha);
          return;
        }
        if (caractere === '\u0003') {
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (caractere === '\u007f' || caractere === '\b') {
          senha = senha.slice(0, -1);
        } else {
          senha += caractere;
        }
      }
    };
    stdin.on('data', aoReceber);
  });
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
  const [usuario, nome, perfil] = process.argv.slice(2);
  if (!usuario || !nome || !perfil) {
    console.error('Uso: node src/db/scripts/criar-usuario.js <usuario> "<nome>" <perfil>');
    console.error(`Perfis válidos: ${PERFIS_VALIDOS.join(', ')}. Senha via NOVA_SENHA ou prompt oculto.`);
    process.exitCode = 1;
    return;
  }

  const { getPool } = require('../connection');
  try {
    const senha = process.env.NOVA_SENHA || (await lerSenhaOculta('Senha: '));
    await criarUsuario({ usuario, nome, perfil, senha }, getPool());
    console.log(`Usuário "${usuario}" criado com o perfil "${perfil}".`);
  } catch (erro) {
    if (erro && erro.code === 'ER_DUP_ENTRY') {
      console.error(`Já existe um usuário com o login "${usuario}".`);
    } else if (erro && erro.code) {
      console.error(`Falha ao criar usuário (código: ${erro.code}).`);
    } else {
      console.error(erro.message);
    }
    process.exitCode = 1;
  } finally {
    try {
      await getPool().end();
    } catch (erro) {
      // pool pode nem ter sido criada (configuração ausente)
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { criarUsuario, PERFIS_VALIDOS };
