// Regra de venda valida do GestaoEverSoftPlus (spec.md, decisao do usuario):
// o tipo do cupom (vendacupom.Flag) precisa ser um tipo de venda em flagvc
// (flagvc.Venda = 1) e o cupom precisa estar ativo (vendacupom.Status = 0;
// Status = 5 e cancelada). Todo agregado de venda usa estes dois fragmentos,
// com as tabelas nomeadas pelos aliases padrao `vendacupom` e `flagvc`.
const JOIN_VENDA_VALIDA = 'INNER JOIN flagvc ON flagvc.flag = vendacupom.Flag';
const WHERE_VENDA_VALIDA = 'flagvc.Venda = 1 AND vendacupom.Status = 0';

module.exports = { JOIN_VENDA_VALIDA, WHERE_VENDA_VALIDA };
