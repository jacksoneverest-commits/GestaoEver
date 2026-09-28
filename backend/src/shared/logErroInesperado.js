// Log seguro de erro inesperado nos controllers (ramo que responde 500 para um erro que não é de
// validação nem um erro interno já logado pelo service).
// Registra SOMENTE o nome da classe do erro e o `code` — nunca message, stack, SQL nem dados do banco
// (regra de segurança do projeto). Não altera a resposta HTTP.

function textoSeguro(valor) {
  return typeof valor === 'string' || typeof valor === 'number' ? String(valor) : 'desconhecido';
}

function logarErroInesperado(modulo, erro) {
  const nome = erro && erro.name ? textoSeguro(erro.name) : 'desconhecido';
  const codigo = erro && erro.code ? textoSeguro(erro.code) : 'desconhecido';
  console.error(`[${modulo}] Erro inesperado (tipo: ${nome}, código: ${codigo}).`);
}

module.exports = { logarErroInesperado };
