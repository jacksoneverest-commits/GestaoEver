// Helpers de período. Datas em ISO 8601 (YYYY-MM-DD) calculadas no fuso LOCAL
// (nunca via toISOString, que converte para UTC e vira o dia à noite no Brasil).

function paraIsoLocal(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

// Últimos `dias` dias, incluindo hoje: periodoUltimosDias(30) em 24/09 -> 26/08 a 24/09.
export function periodoUltimosDias(dias, agora = new Date()) {
  const inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - (dias - 1));
  return { inicio: paraIsoLocal(inicio), fim: paraIsoLocal(agora) };
}

// Últimos `dias` dias terminando ONTEM (só dias fechados): periodoUltimosDiasAteOntem(30) em 24/09 -> 25/08 a 23/09.
export function periodoUltimosDiasAteOntem(dias, agora = new Date()) {
  const ontem = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1);
  return periodoUltimosDias(dias, ontem);
}
