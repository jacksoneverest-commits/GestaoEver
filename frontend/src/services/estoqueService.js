import { apiGet } from './apiClient.js';

// Só repassa os parâmetros presentes (o backend aplica os padrões dos ausentes).
function comParametrosPresentes(base, opcionais) {
  const parametros = { ...base };
  Object.entries(opcionais).forEach(([chave, valor]) => {
    if (valor !== undefined && valor !== null) parametros[chave] = valor;
  });
  return parametros;
}

// GET /api/estoque/niveis?inicio&fim[&nivel=grupo|setor|familia&id][&classificacao=ruptura|proximo_ruptura|excesso][&limite]
// -> { inicio, fim, fimSolicitado, classificacao, limite, totalItens, resumo: { ruptura, proximoRuptura, excesso },
//      itens: [{ id, nome, estoqueAtual, estoqueMinimo, estoqueMaximo, quantidadeVendida, mediaDiaria, coberturaDias,
//      classificacao }] }. `resumo` são as 3 contagens (não exclusivas) do filtro de departamento; `itens` é a lista
// da `classificacao` pedida (padrão ruptura). `limite` 1-500.
export function obterNiveis({ inicio, fim, nivel, id, classificacao, limite }) {
  return apiGet('/api/estoque/niveis', comParametrosPresentes({ inicio, fim }, { nivel, id, classificacao, limite }));
}

// GET /api/estoque/cobertura?inicio&fim[&nivel&id][&limite]
// -> { inicio, fim, fimSolicitado, limite, totalItens, itens: [{ id, nome, estoqueAtual, quantidadeVendida, mediaDiaria,
//      coberturaDias }] }: produtos com venda no período, menor cobertura primeiro.
export function obterCobertura({ inicio, fim, nivel, id, limite }) {
  return apiGet('/api/estoque/cobertura', comParametrosPresentes({ inicio, fim }, { nivel, id, limite }));
}

// GET /api/estoque/parados?inicio&fim[&nivel&id][&limite]
// -> { inicio, fim, fimSolicitado, limite, totalItens, valorTotalParado, itens: [{ id, nome, estoqueAtual, custoUnitario,
//      valorParado }] }: produtos com estoque positivo e sem venda no período, maior valor parado primeiro.
export function obterParados({ inicio, fim, nivel, id, limite }) {
  return apiGet('/api/estoque/parados', comParametrosPresentes({ inicio, fim }, { nivel, id, limite }));
}
