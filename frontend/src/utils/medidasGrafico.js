import { useMemo } from 'react';
import { lerTokenNumero } from './graficos.js';

// Medidas numéricas dos gráficos (o Recharts exige números, não var()). Cada uma vem de um token
// sem unidade em styles/tokens.css; o segundo valor é o padrão quando o CSS não está carregado.
const MEDIDAS = {
  barSize: ['--vc-barra-largura', 16],
  raioBarra: ['--vc-barra-raio', 8],
  alturaGrafico: ['--altura-grafico', 280],
  alturaCompacta: ['--altura-grafico-compacto', 160],
  alturaPorBarraForma: ['--vc-altura-barra-forma', 40],
  alturaPorBarraDepartamento: ['--vc-altura-barra-departamento', 36],
  alturaExtraBarras: ['--vc-altura-extra-barras', 40],
  larguraEixoValor: ['--vc-eixo-valor-largura', 64],
  larguraEixoValorEstreito: ['--vc-eixo-valor-largura-estreita', 56],
  larguraEixoRotulo: ['--vc-eixo-rotulo-largura', 130],
  larguraEixoDepartamento: ['--vc-eixo-departamento-largura', 160],
  larguraEixoRotuloEstreito: ['--vc-eixo-rotulo-largura-estreita', 96],
  margemTopoColunas: ['--vc-margem-topo-colunas', 24],
  margemDireitaBarras: ['--vc-margem-direita-barras', 124],
  margemDireitaBarrasEstreita: ['--vc-margem-direita-barras-estreita', 64],
};

// Leitura única por montagem (useMemo): evita getComputedStyle a cada renderização.
export function useMedidasGrafico() {
  return useMemo(
    () => Object.fromEntries(Object.entries(MEDIDAS).map(([chave, [token, padrao]]) => [chave, lerTokenNumero(token, padrao)])),
    [],
  );
}
