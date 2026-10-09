// Módulos da navegação (sidebar e busca). Rentabilidade ainda não tem tela (Fase 12 do PLAN): fica desabilitada.
export const MODULOS = [
  { id: 'dashboard', rotulo: 'Dashboard', rota: '#/', icone: 'dashboard' },
  { id: 'vendas', descricao: 'Faturamento, ticket médio e evolução diária.', rotulo: 'Vendas', rota: '#/vendas', icone: 'vendas' },
  { id: 'ranking-produtos', descricao: 'Os produtos que mais vendem, por critério.', rotulo: 'Ranking de Produtos', rota: '#/ranking-produtos', icone: 'ranking' },
  { id: 'curva-abc', descricao: 'Classificação A, B e C por venda, margem e estoque.', rotulo: 'Curva ABC', rota: '#/curva-abc', icone: 'curva-abc' },
  { id: 'estoque', descricao: 'Rupturas, excessos e cobertura em dias.', rotulo: 'Estoque', rota: '#/estoque', icone: 'estoque' },
  { id: 'rentabilidade', descricao: 'Margem e evolução da rentabilidade.', rotulo: 'Rentabilidade', rota: null, icone: 'rentabilidade', desabilitado: true },
  { id: 'usuarios', descricao: 'Cadastro de usuários e troca de senha.', rotulo: 'Usuários', rota: '#/usuarios', icone: 'usuarios' },
];

// Módulo da rota atual; qualquer rota desconhecida cai no Dashboard (mesma regra do App).
export function moduloDaRota(rota) {
  return MODULOS.find((m) => !m.desabilitado && m.rota === rota) || MODULOS[0];
}

export function normalizarTexto(texto) {
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
