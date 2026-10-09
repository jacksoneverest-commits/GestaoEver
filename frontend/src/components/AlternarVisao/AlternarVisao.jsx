import './AlternarVisao.css';

const OPCOES = [
  { valor: 'grafico', rotulo: 'Gráfico' },
  { valor: 'tabela', rotulo: 'Tabela' },
];

// Controle segmentado Gráfico | Tabela. Botões nativos (teclado) com aria-pressed.
function AlternarVisao({ valor, aoMudar, rotulo = 'Visualização' }) {
  return (
    <div className="alternar-visao" role="group" aria-label={rotulo}>
      {OPCOES.map((opcao) => (
        <button
          key={opcao.valor}
          type="button"
          className={`alternar-visao__opcao${valor === opcao.valor ? ' alternar-visao__opcao--ativa' : ''}`}
          aria-pressed={valor === opcao.valor}
          onClick={() => aoMudar(opcao.valor)}
        >
          {opcao.rotulo}
        </button>
      ))}
    </div>
  );
}

export default AlternarVisao;
