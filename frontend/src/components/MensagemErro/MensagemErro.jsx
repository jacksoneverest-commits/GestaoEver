// Mensagem de erro de tela (ver `classificarErro` em utils/erroApi.js). Sem CSS próprio: as classes usam o
// `prefixo` da tela (ex: "ranking" -> `ranking__erro`, `ranking__aviso--atencao`) e são estilizadas no CSS dela.
function MensagemErro({ erro, prefixo }) {
  if (erro.tipo === 'nao-preparado') {
    return (
      <div role="alert" className={`${prefixo}__aviso ${prefixo}__aviso--atencao`}>
        <p className={`${prefixo}__aviso-titulo`}>Dados desse período ainda não foram preparados</p>
        <p className={`${prefixo}__aviso-detalhe`}>{erro.mensagem}</p>
      </div>
    );
  }
  if (erro.tipo === 'indisponivel') {
    return (
      <div role="status" className={`${prefixo}__aviso ${prefixo}__aviso--info`}>
        <p className={`${prefixo}__aviso-titulo`}>Ainda indisponível</p>
        <p className={`${prefixo}__aviso-detalhe`}>{erro.mensagem}</p>
      </div>
    );
  }
  return <p role="alert" className={`${prefixo}__erro`}>{erro.mensagem}</p>;
}

export default MensagemErro;
