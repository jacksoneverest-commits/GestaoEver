import './TabelaDados.css';

// Tabela dos mesmos dados do gráfico (substitui o gráfico no mesmo espaço do card).
//
// colunas[0] é o cabeçalho de linha (valor em item[colunas[0].chave] ou `renderPrimeira`).
// Demais colunas: { chave, rotulo, numerica, formatar, somar, barra }.
//   - `somar`: entra na linha de total (soma dos itens exibidos, formatada por `formatar`). A soma é só
//     exibição de uma coluna aditiva (valores/quantidades); colunas sem `somar` (ex.: participação %)
//     mostram "—" no total, porque somar percentuais seria recalcular indicador no frontend.
//   - `barra`: mostra a mini-barra de participação (decorativa; o número continua visível).
// `totalCompleto`: total do conjunto inteiro vindo da API; se for maior que a soma exibida,
// a linha de total é rotulada "Total exibido". `indicePico`: linha do maior valor (-1 = nenhum).

const TOLERANCIA = 0.005;

function soma(itens, chave) {
  return itens.reduce((acc, item) => acc + (Number(item[chave]) || 0), 0);
}

// Participação informada pela API; sem ela, escala visual pelo maior valor exibido.
function valorDaBarra(item, coluna, maior) {
  const participacao = Number(item.participacaoPercentual);
  if (item.participacaoPercentual !== undefined && item.participacaoPercentual !== null && Number.isFinite(participacao)) {
    return Math.min(100, Math.max(0, Math.round(participacao)));
  }
  if (!maior) return 0;
  return Math.round(((Number(item[coluna.chave]) || 0) / maior) * 100);
}

function formatar(coluna, valor) {
  return coluna.formatar ? coluna.formatar(valor) : valor;
}

function TabelaDados({ titulo, colunas, itens, indicePico = -1, totalCompleto, renderPrimeira }) {
  const [primeira, ...demais] = colunas;
  const colunaBarra = demais.find((coluna) => coluna.barra);
  const maior = colunaBarra ? Math.max(0, ...itens.map((item) => Number(item[colunaBarra.chave]) || 0)) : 0;

  const colunaReferencia = colunaBarra ?? demais.find((coluna) => coluna.somar);
  const somaExibida = colunaReferencia ? soma(itens, colunaReferencia.chave) : 0;
  const parcial =
    totalCompleto !== undefined &&
    totalCompleto !== null &&
    Number(totalCompleto) - somaExibida > TOLERANCIA;
  const temTotal = demais.some((coluna) => coluna.somar);

  return (
    <div className="tabela-dados">
      <table className="tabela-dados__tabela" aria-label={`${titulo} (tabela)`}>
        <thead>
          <tr>
            {colunas.map((coluna) => (
              <th key={coluna.chave} scope="col" className={coluna.numerica ? 'num' : undefined}>
                {coluna.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {itens.map((item, indice) => (
            <tr key={item.chaveLinha ?? `${item.id ?? item.hora ?? item.diaSemana ?? 'linha'}-${indice}`}>
              <th scope="row">{renderPrimeira ? renderPrimeira(item, indice) : item[primeira.chave]}</th>
              {demais.map((coluna) => {
                const valor = formatar(coluna, item[coluna.chave]);
                const ehPico = indice === indicePico && coluna === (colunaBarra ?? demais[0]);
                return (
                  <td key={coluna.chave} className={coluna.numerica ? 'num' : undefined}>
                    {coluna.barra || ehPico ? (
                      <div className="tabela-dados__celula">
                        <span className="tabela-dados__valor">
                          {ehPico && <span className="tabela-dados__pico">Pico</span>}
                          <span>{valor}</span>
                        </span>
                        {coluna.barra && (
                          <progress className="tabela-dados__barra" aria-hidden="true" max={100} value={valorDaBarra(item, coluna, maior)} />
                        )}
                      </div>
                    ) : (
                      valor
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {temTotal && (
          <tfoot>
            <tr>
              <th scope="row">{parcial ? 'Total exibido' : 'Total'}</th>
              {demais.map((coluna) => (
                <td key={coluna.chave} className={coluna.numerica ? 'num' : undefined}>
                  {coluna.somar ? formatar(coluna, soma(itens, coluna.chave)) : '—'}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export default TabelaDados;
