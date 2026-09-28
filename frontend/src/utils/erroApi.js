// Traduz o erro do service em um estado próprio da tela (o apiClient expõe o status HTTP em `erro.status`).
// 503 = dados do período ainda não preparados (cache); 501 = recurso ainda indisponível; demais = erro genérico.
export function classificarErro(e, mensagemPadrao) {
  const mensagem = (e && e.message) || mensagemPadrao;
  if (e && e.status === 503) return { tipo: 'nao-preparado', mensagem };
  if (e && e.status === 501) return { tipo: 'indisponivel', mensagem };
  return { tipo: 'generico', mensagem };
}
