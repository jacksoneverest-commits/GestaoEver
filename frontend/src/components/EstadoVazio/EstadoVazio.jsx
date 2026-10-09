import './EstadoVazio.css';

// Estado vazio com orientação do que fazer (em vez de texto solto em itálico).
function EstadoVazio({ titulo, descricao }) {
  return (
    <div className="estado-vazio">
      <p className="estado-vazio__titulo">{titulo}</p>
      {descricao && <p className="estado-vazio__descricao">{descricao}</p>}
    </div>
  );
}

export default EstadoVazio;
