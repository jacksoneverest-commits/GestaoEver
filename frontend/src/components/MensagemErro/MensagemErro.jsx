import './MensagemErro.css';

// Mensagem de erro de tela (ver `classificarErro` em utils/erroApi.js). O estilo é compartilhado
// (`mensagem-erro`, variantes `--erro`/`--atencao`/`--info`); o `prefixo` da tela (ex: "ranking" ->
// `ranking__erro`) continua nas classes apenas como gancho opcional de estilo/teste.
function MensagemErro({ erro, prefixo }) {
  const comPrefixo = (sufixo) => (prefixo ? ` ${prefixo}__${sufixo}` : '');

  if (erro.tipo === 'nao-preparado') {
    return (
      <div role="alert" className={`mensagem-erro mensagem-erro--atencao${comPrefixo('aviso')}${comPrefixo('aviso--atencao')}`}>
        <p className="mensagem-erro__titulo">Dados desse período ainda não foram preparados</p>
        <p className="mensagem-erro__detalhe">{erro.mensagem}</p>
      </div>
    );
  }
  if (erro.tipo === 'indisponivel') {
    return (
      <div role="status" className={`mensagem-erro mensagem-erro--info${comPrefixo('aviso')}${comPrefixo('aviso--info')}`}>
        <p className="mensagem-erro__titulo">Ainda indisponível</p>
        <p className="mensagem-erro__detalhe">{erro.mensagem}</p>
      </div>
    );
  }
  return <p role="alert" className={`mensagem-erro mensagem-erro--erro${comPrefixo('erro')}`}>{erro.mensagem}</p>;
}

export default MensagemErro;
