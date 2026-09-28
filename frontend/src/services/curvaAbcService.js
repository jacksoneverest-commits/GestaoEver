import { apiGet } from './apiClient.js';

// Só repassa os parâmetros presentes (o backend aplica os padrões dos ausentes).
function comParametrosPresentes(base, opcionais) {
  const parametros = { ...base };
  Object.entries(opcionais).forEach(([chave, valor]) => {
    if (valor !== undefined && valor !== null) parametros[chave] = valor;
  });
  return parametros;
}

// GET /api/curva-abc?inicio&fim&agrupador=produto|grupo|setor|familia|marca|cliente|fornecedor[&id][&limite]
// -> { agrupador, inicio, fim, id?, limite, totalItens, itens }.
// Itens (exceto fornecedor): { id, nome, faturamento, lucro, valorEstoque, participacaoVenda, acumuladoVenda,
//   classificacaoVenda, classificacaoMargem, classificacaoEstoque, semCusto }.
// Itens de fornecedor (curva de compras): { id, nome, valorCompras, participacaoCompra, acumuladoCompra, classificacaoCompra }.
// `id` (inteiro positivo) detalha um item da dimensão: as linhas passam a ser os produtos dele. `limite` 1-1000.
export function obterCurvaAbc({ inicio, fim, agrupador, id, limite }) {
  return apiGet('/api/curva-abc', comParametrosPresentes({ inicio, fim, agrupador }, { id, limite }));
}

// GET /api/curva-abc/itens?agrupador=grupo|setor|familia|marca|cliente|produto[&busca][&limite]
// -> { agrupador, busca?, limite, totalItens, itens: [{ id, nome }] } em ordem alfabética.
// Para `produto` a `busca` é obrigatória (mín. 2 caracteres); `fornecedor` não tem seleção (400).
export function listarItens({ agrupador, busca, limite }) {
  return apiGet('/api/curva-abc/itens', comParametrosPresentes({ agrupador }, { busca, limite }));
}
