# Plano de execução — Redesign visual do frontend

> Referência visual: dashboard "Customer Wi-Fi" (sidebar branca à esquerda, topbar com busca e avatar, 4 KPIs coloridos com gradiente, cards arredondados). Apenas frontend; nenhuma alteração de backend, SPEC ou banco.

## Decisões tomadas (questionário)

| # | Tema | Decisão |
|---|------|---------|
| 1 | Layout | `AppShell` (sidebar + topbar) compartilhado por todas as páginas; home com 4 KPIs reais reusando o service de vendas já existente + atalhos dos módulos |
| 2 | Ícones | SVGs inline próprios (componente `Icon`), sem dependência nova |
| 3 | Visual | Tokens CSS globais da imagem + fonte Poppins via Google Fonts (sem npm) |
| 4 | Topbar | Busca de módulos (filtra/atalha o menu) + avatar com iniciais e menu Sair; **sem sino** (central de alertas fora do escopo do SPEC) |

## Restrições do projeto que valem para todas as fases

- TDD: teste escrito antes do código; cada teste crítico = um `it(...)` (`.claude/rules/testes.md`).
- Nenhum `fetch` em componente; dados via `frontend/src/services/`; testes mockam services.
- Moeda/data só pelos helpers `utils/format.js` e `utils/formatNumber.js`.
- Sem dependência nova. Sem lógica de negócio no frontend. Sem diferenciação de permissões.
- Rentabilidade ainda não tem tela (Fase 12 do PLAN): aparece no menu como item desabilitado "Em breve" (sem rota), para não inventar funcionalidade.
- Rastreabilidade: trabalho de UI sobre os módulos "Essenciais" do SPEC; registrar como Sprint/Fase "UI" no `PLAN.md` ao iniciar (tarefa U.0).
- Cada fase termina com `npm test` e `npm run build` em `frontend/` passando.

## Agents designados

| Agent | Papel | Status |
|-------|-------|--------|
| `frontend-engineer` | Implementa tokens, AppShell, componentes, páginas e testes | existente |
| `ui-ux-reviewer` | Auditoria somente leitura de UI/UX e acessibilidade (WCAG 2.1 AA) ao fim das fases 2, 4 e 5 | **criado** em `.claude/agents/ui-ux-reviewer.md` |
| `code-reviewer` | Revisão final de escopo/regras/testes contra SPEC e PLAN | existente |

Backend e database engineers não participam.

## Fases

### Fase U.0 — Preparação (`frontend-engineer`)
- Adicionar ao `PLAN.md` a Fase "UI — Redesign" apontando para este documento.
- Adicionar `<meta name="viewport">` e as `<link>` do Google Fonts (Poppins 400/500/600) em `frontend/index.html`.
- **Pronto quando:** `npm run build` passa e a fonte carrega.

### Fase U.1 — Design tokens (`frontend-engineer`)
- Criar `frontend/src/styles/tokens.css` (importado em `main.jsx`) com:
  - cores: fundo `#f4f7fb`, superfície, borda, texto/texto suave, primária azul `#4361ee`, e gradientes dos KPIs (azul, âmbar, ciano, verde), estados positivo/negativo/aviso;
  - raios (12/16px), sombras suaves, espaçamentos, tipografia (Poppins, escala de tamanhos), `--sidebar-largura`, breakpoints documentados.
- Criar `frontend/src/styles/base.css` (reset leve, `:focus-visible` global, `prefers-reduced-motion`, `.sr-only` compartilhado).
- Alinhar as variáveis `--vc-*` dos gráficos aos tokens (série primária, grade, destaque).
- **Pronto quando:** textos brancos sobre os 4 gradientes têm contraste >= 4,5:1 (ajustar tons escuros se preciso).

### Fase U.2 — Componentes base (`frontend-engineer`, depois `ui-ux-reviewer`)
Teste primeiro, depois código, em `frontend/src/components/`:
- `Icon/Icon.jsx` — SVGs de linha: dashboard, vendas, ranking, curva-abc, estoque, usuarios, rentabilidade, busca, sair, menu, fechar.
- `AppShell/AppShell.jsx` — sidebar (logo + marca, itens com `aria-current="page"`, item Rentabilidade desabilitado "Em breve", botão Sair no rodapé), topbar (botão hambúrguer, título da página, `BuscaModulos`, `AvatarMenu`), área `<main>` com slot para o conteúdo. Gaveta com fechamento por Esc/clique fora no mobile (< 900px).
- `AppShell/BuscaModulos.jsx` — campo que filtra os módulos por nome e navega com Enter/clique (`role="combobox"`/lista com teclado).
- `AppShell/AvatarMenu.jsx` — iniciais do usuário (vindas de `authService`) + menu com Sair.
- `KpiCard/KpiCard.jsx` — card com gradiente (variantes `azul|ambar|ciano|verde`), rótulo, valor grande, variação opcional (seta + texto, nunca só cor).
- `PageHeader/PageHeader.jsx` — título + subtítulo + área de ações (filtro de período).
- `EstadoVazio`/`Skeleton` simples para carregando e vazio.

Testes críticos (um `it` cada): renderiza itens do menu e marca o ativo; Rentabilidade aparece desabilitada; busca filtra módulos; Esc fecha a gaveta; Sair chama `onLogout`; KpiCard exibe valor formatado e variação com texto acessível.

**Revisão:** `ui-ux-reviewer` sobre os componentes (foco, teclado, contraste, alvos >= 44px).

### Fase U.3 — Integração no App (`frontend-engineer`)
- `App.jsx`: rota autenticada renderiza `<AppShell rotaAtual=… onLogout=…>` envolvendo a página; Login permanece fora do shell. Manter a navegação por hash (sem roteador novo).
- Remover o cabeçalho próprio ("Voltar ao painel"/"Sair") de `VendasPage`, `RankingProdutosPage`, `CurvaAbcPage`, `EstoquePage` e `UsuariosPage`; cada uma passa a usar `PageHeader`.
- Atualizar os testes dessas páginas e `App.test.jsx` (que hoje buscam esses textos) — ajustando o teste antes da mudança de código.
- **Pronto quando:** é possível ir de qualquer módulo a qualquer outro em 1 clique pela sidebar.

### Fase U.4 — Home com KPIs reais (`frontend-engineer`, depois `ui-ux-reviewer`)
- `DashboardPage`: faixa de 4 `KpiCard` — Faturamento, Ticket médio, Quantidade de cupons, Itens por compra — via `obterFaturamento` (já existe), período padrão últimos 30 dias, com comparativo ao período anterior quando houver.
- Seletor rápido de período no topo (Hoje / 7 dias / 30 dias / Mês) usando `utils/periodo.js` e `PeriodFilter`; os três estados (carregando com skeleton, erro com `MensagemErro`, sucesso) tratados.
- Abaixo: grade de atalhos dos módulos (card com ícone + descrição curta) e, se couber sem novo service, o gráfico de faturamento diário já existente em `VendasCharts` reutilizado.
- Testes críticos: mostra os 4 KPIs com valores formatados; mostra estado de erro; mostra skeleton enquanto carrega; troca de período refaz a chamada.

### Fase U.5 — Reestilização dos módulos (`frontend-engineer`, depois `ui-ux-reviewer`)
- Vendas: cards de indicadores passam a `KpiCard`; gráficos em cards com cabeçalho e cores dos tokens.
- Ranking de Produtos, Curva ABC, Estoque, Usuários, Login: trocar cores hex por tokens, cards 16px, tabelas com cabeçalho fixo e linha zebrada suave, scroll horizontal contido no card, badges de classe ABC (A/B/C) com cor + letra.
- Eliminar `style={{…}}` inline remanescentes.
- Login: layout em duas colunas no desktop (marca + formulário), campo "Servidor" em seção recolhível "Avançado".
- Testes: ajustar apenas os que dependem de textos/estrutura removidos; nenhum comportamento de negócio muda.

### Fase U.6 — Verificação e entrega
- `frontend-engineer`: `npm test` e `npm run build` em `frontend/`.
- `ui-ux-reviewer`: auditoria completa (360px, 768px, 1280px; teclado; contraste) → corrigir BLOQUEANTE/IMPORTANTE (volta ao `frontend-engineer`).
- `code-reviewer`: confirma que nada saiu do escopo do SPEC (sem sino/alertas, sem permissões por perfil, sem lógica de negócio no frontend, sem dependência nova).
- Conferência visual manual rodando a aplicação (skill `run`) e comparando com a imagem de referência.

## Ordem e dependências

```
U.0 → U.1 → U.2 → U.3 → U.4 → U.5 → U.6
              └─ revisão ux (U.2)  └─ revisão ux (U.4/U.5)
```

## Análise de UI/UX e melhorias sugeridas

### Achados no estado atual
1. **Navegação (IMPORTANTE):** só há navegação na home; trocar de módulo exige voltar ao painel. → resolvido pela sidebar (U.2/U.3).
2. **Home vazia (IMPORTANTE):** sem nenhum indicador; vai contra o objetivo do produto. → U.4.
3. **Sem sistema de design (IMPORTANTE):** cores/raios repetidos em 6 CSS, estilos inline na home, sem fonte definida. → U.1/U.5.
4. **Cabeçalho duplicado em 5 páginas (IMPORTANTE):** manutenção cara e inconsistente. → U.3.
5. **Meta viewport ausente (IMPORTANTE):** layout mobile fica ampliado/ruim. → U.0.
6. **Carregando só com texto (SUGESTÃO):** "Carregando indicadores..." causa salto de layout. → skeletons com a mesma altura dos cards.
7. **Estados vazios como texto em itálico (SUGESTÃO):** ex. "Meta não configurada". → `EstadoVazio` com ícone e orientação do que fazer.
8. **Acessibilidade (ponto positivo + atenção):** `aria`, `role=status` e `sr-only` já existem — manter; adicionar `:focus-visible` global, alvos de toque >= 44px e `prefers-reduced-motion`.

### Melhorias adicionais recomendadas (fora desta entrega, mediante decisão)
- **Período persistente entre módulos:** guardar o período escolhido (localStorage) e aplicá-lo a todas as telas, evitando reescolher a cada módulo.
- **Atalhos de período** (Hoje, 7 dias, Mês atual, Mês anterior) também no `PeriodFilter`, em vez de só dois campos de data.
- **Exportar CSV** nas tabelas de Ranking/Curva ABC/Estoque (no frontend, a partir dos dados já carregados).
- **Tema escuro** habilitado pelos tokens (fase futura).
- **Tooltips explicativos** nos indicadores (ex.: o que é "itens por compra"), reduzindo dúvida do gestor.
- **Indicador de "dados atualizados até"** (data do último job de cache) — evita a dúvida "esses dados estão frescos?", problema central do ERP atual. Depende de um endpoint de backend, então exige confirmação/atualização do PLAN.
- **Skip link** ("Pular para o conteúdo") e título de página dinâmico (`document.title`) por módulo.

## Riscos
- Poppins via CDN exige internet no navegador do cliente; fallback `system-ui` definido nos tokens.
- Contraste do texto branco sobre âmbar/ciano claro: ajustar tons na U.1.
- Vários testes existentes dependem de textos do cabeçalho antigo: ajustar em U.3 antes de mexer no código.
