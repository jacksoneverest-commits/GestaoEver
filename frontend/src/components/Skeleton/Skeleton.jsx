import './Skeleton.css';

const TAMANHOS = ['linha', 'card', 'bloco'];

// Placeholder de carregamento com a altura do conteúdo final (evita salto de layout).
// tamanho: 'linha' (24px) | 'card' (120px, padrão) | 'bloco' (280px) — alturas definidas em CSS, sem estilo inline.
function Skeleton({ rotulo = 'Carregando...', tamanho = 'card' }) {
  const variante = TAMANHOS.includes(tamanho) ? tamanho : 'card';
  return <div role="status" aria-label={rotulo} className={`skeleton skeleton--${variante}`} />;
}

export default Skeleton;
