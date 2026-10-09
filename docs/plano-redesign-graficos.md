# Plano de execução — Redesign dos gráficos (cards, alinhamento e tabela)

> Referência: painéis "Page Analytics / Survey Analytics" (cards brancos com "cartela" cinza-azulada para o gráfico, barras finas arredondadas com pico destacado, barras de progresso, legenda no topo). Escopo: gráficos de `frontend/src/pages/Vendas/components/VendasCharts.*`. Apenas frontend; sem dependência nova; sem alteração de backend.

## Decisões tomadas (questionário)

| # | Tema | Decisão |
|---|------|---------|
| 1 | Tabela | Toggle **Gráfico \| Tabela** no cabeçalho do card; a tabela substitui o gráfico no mesmo espaço. Substitui o `<details>` "Ver como tabela". A visualização em tabela é **mantida** em todos os gráficos |
| 2 | Destaque | Barra de maior valor em cor secundária + rótulo no pico + legenda "Pico do período". Não depende só de cor: o tooltip e a tabela também indicam |
| 3 | Barras | Finas e arredondadas, grade só horizontal sem linha de eixo, valor no fim das barras horizontais |
| 4 | Opcionais | Mini-barra de participação + linha de total na tabela; exportar CSV por card; lembrar escolha Gráfico/Tabela em `localStorage` |

## Restrições que valem para todas as fases

- TDD: teste antes do código; um `it(...)` por teste crítico (`.claude/rules/testes.md`). Testes de `VendasCharts` que usam o texto "Ver como tabela" são ajustados **antes** da mudança de código.
- Sem dependência nova (CSV gerado no frontend com `Blob`). Sem `fetch` em componente. Formatação só pelos helpers (`format.js`, `formatNumber.js`). Sem hex/rgba/px fora de `tokens.css`; sem `style={{}}` (usar custom properties por classe).
- Sem lógica de negócio: o "pico" é só a marcação do máximo já retornado pela API; participação e total vêm da API (`participacaoPercentual`, `faturamento`). Se a API não trouxer um total, a linha de total soma apenas o que está exibido e rotula "Total exibido" (ver G.4).
- `localStorage` sempre em `try/catch`, e a tela renderiza igual sem ele.
- **Rastreabilidade (atenção):** o SPEC não menciona exportação CSV. Pela regra de `convencoes-gerais.md`, a tarefa G.0 registra o CSV (e o resto) como Fase "UI-Gráficos" no `PLAN.md` e uma linha no SPEC antes de implementar; o item de CSV só começa depois disso.
- Cada fase termina com `npm test` e `npm run build` em `frontend/` passando. Sem commit/push sem pedido explícito.

## Agents designados

| Agent | Papel | Status |
|-------|-------|--------|
| `frontend-engineer` | Implementa tokens, componentes, CSS, testes | existente |
| `code-reviewer` | Revisão de escopo, regras e testes ao fim de G.3 e G.5 | existente |
| `ui-ux-reviewer` | Auditoria visual/acessibilidade (somente leitura) ao fim de G.2 e G.5 | existente em `.claude/agents/ui-ux-reviewer.md`, mas **não está registrado nesta sessão**; reiniciar a sessão para usá-lo. Alternativa: `general-purpose` instruído a seguir esse arquivo, somente leitura |

Backend e database engineers não participam.

## Fases

### G.0 — Preparação (`frontend-engineer`)
- Registrar no `PLAN.md` (Sprint 7) a Fase "UI-Gráficos" apontando para este documento; acrescentar ao `spec.md` uma linha sobre exportação CSV e o toggle gráfico/tabela (confirmar com o usuário se o SPEC puder ser editado por este agent; senão, apenas sinalizar).
- **Pronto quando:** PLAN com G.0–G.6 listadas.

### G.1 — Tokens de gráfico (`frontend-engineer`)
Em `tokens.css`:
- `--cor-superficie-grafico` (cartela cinza-azulada, ex. `#f6f9fd`), `--raio-xl` (cartela 12–16px), `--altura-grafico` (280px) e `--altura-grafico-compacto`.
- Séries: `--vc-serie` (ciano/azul base), `--vc-serie-destaque` (azul-escuro do pico), `--vc-serie-2..4` derivadas dos gradientes de KPI, para uso futuro.
- `--vc-grade` mais claro; `--vc-barra-largura` (barSize).
- Conferir contraste: texto suave sobre a cartela ≥ 4,5:1; barras e marcador ≥ 3:1 contra a cartela (WCAG 1.4.11).

### G.2 — Layout e alinhamento do card (`frontend-engineer`, depois `ui-ux-reviewer`)
Teste primeiro, depois código:
- Novo componente `CartaoGrafico` reutilizável (sai de dentro de `VendasCharts.jsx` para `frontend/src/components/CartaoGrafico/`): cabeçalho com **título à esquerda** + **área de ações à direita** (altura fixa), subtítulo opcional, corpo com **cartela interna** (`--cor-superficie-grafico`), altura mínima do corpo `--altura-grafico`, `height: 100%` para igualar cards da mesma linha.
- Mesma largura de eixo e margens para gráficos do mesmo tipo (`larguraRotulo` por tipo, não por gráfico).
- Estados carregando (Skeleton com a altura do corpo, sem salto), erro (`MensagemErro`) e vazio (`EstadoVazio`) preenchem o corpo mantendo a altura.
- Testes críticos: cabeçalho renderiza título e ações; corpo mantém estado carregando/erro/vazio; sem `style` inline.

### G.3 — Toggle Gráfico | Tabela (`frontend-engineer`, depois `code-reviewer`)
- Componente `AlternarVisao` (controle segmentado, dois botões com `aria-pressed`, alvo ≥ 44px, navegável por teclado) na área de ações do `CartaoGrafico`.
- A tabela (`TabelaDados`) passa a renderizar **no lugar** do gráfico, com a mesma altura do corpo e scroll contido; `role="img"` + descrição do gráfico mantidos; `aria-label` da tabela mantido.
- Padrão: Gráfico; em tela estreita com muitos rótulos (departamento) o padrão pode ser Tabela (`useTelaEstreita`).
- Persistência opcional da escolha por card em `localStorage` (`vendas-charts:visao:<card>`), em `try/catch`.
- Remover o `<details>`/"Ver como tabela" e ajustar os testes antigos antes.
- Testes críticos (um `it` cada): alterna para tabela e mostra os mesmos dados; volta ao gráfico; `aria-pressed` reflete a visão; escolha lembrada; funciona se `localStorage` lançar exceção.

### G.4 — Tabela enriquecida (`frontend-engineer`)
- Coluna de valor com mini-barra de participação (barra CSS decorativa `aria-hidden`; o número continua visível).
- Linha de total no `<tfoot>` ("Total" se o conjunto estiver completo; "Total exibido" se a tabela estiver truncada), valores via helpers.
- Cabeçalho fixo, zebra (`--cor-zebra`) e números alinhados à direita, como nas outras telas.
- Testes: mini-barra proporcional à participação; total calculado dos itens exibidos e formatado; coluna numérica à direita.

### G.5 — Visual das barras, destaque e exportação (`frontend-engineer`, depois `ui-ux-reviewer` e `code-reviewer`)
- Barras: `barSize` limitado, `radius` 8px, `axisLine={false}`/`tickLine={false}`, grade só horizontal nas barras verticais e mais clara; tick 12px ligado ao token de fonte.
- Pico: barra de maior valor com `--vc-serie-destaque` (via `Cell`), marcador/rótulo no topo e legenda "Pico do período" acima do gráfico; empate usa a primeira ocorrência; sem dados ou todos zero → sem destaque.
- Barras horizontais (forma de pagamento, departamento): rótulo de valor no fim da barra (`LabelList` com `formatCurrencyCompact`) e participação quando existir.
- Tooltip: raio 12px, sombra elevada, rótulo em destaque e valor em negrito.
- **Exportar CSV** por card: botão "Exportar CSV" na área de ações, gerando o arquivo com `Blob` a partir dos dados já carregados (separador `;`, decimal vírgula, BOM UTF-8 para Excel pt-BR, nome `vendas-<card>-<inicio>-<fim>.csv`, datas ISO). Sem dados de `clifor`. Valores não são recalculados.
- Testes críticos: barra do pico recebe a cor de destaque; legenda só aparece com pico; rótulo de valor nas barras horizontais; CSV tem cabeçalho e linhas corretas e escapa `;`/aspas; botão desabilitado sem dados.

### G.6 — Verificação e entrega
- `frontend-engineer`: `npm test` e `npm run build`.
- `ui-ux-reviewer`: auditoria em 360/768/1280px — alinhamento das alturas, contraste, foco do toggle, alvo de toque, tabela no lugar do gráfico.
- `code-reviewer`: escopo (SPEC atualizado para CSV), sem lógica de negócio, sem dependência nova, TDD e testes críticos.
- Conferência visual manual com o app rodando, comparando com a imagem de referência.
- Marcar as fases no `PLAN.md`.

## Ordem e dependências

```
G.0 → G.1 → G.2 → G.3 → G.4 → G.5 → G.6
              └ revisão UX     └ revisão code     └ revisões finais
```
G.4 pode rodar em paralelo com G.3 (arquivos distintos: `TabelaDados` vs. `AlternarVisao`), mas ambos tocam `VendasCharts.jsx`, então a ordem sequencial é mais segura.

## Riscos
- O recharts não mede largura no jsdom: o layout real só é validado no navegador (conferência visual na G.6).
- Trocar o `<details>` quebra testes existentes; ajustá-los primeiro.
- Cor do pico sozinha é insuficiente: manter rótulo, legenda e tabela.
- CSV é ampliação de escopo: depende de G.0.
- O `ui-ux-reviewer` precisa de nova sessão para ser invocado por nome.
