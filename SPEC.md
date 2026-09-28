# SPEC.md

# GestãoEverSoftPlus

## Problema
O ERP atual possui um relatório de gestão, porém ele é lento e tecnologicamente desatualizado (sem gráficos, sem dashboards interativos). O gestor não tem uma visão ampla e rápida do negócio. O objetivo do projeto é substituir/modernizar esse relatório por um dashboard web com gráficos e indicadores visuais, dando ao gestor uma central de decisão sobre o que está acontecendo no negócio.

## Usuários
- **Dono**
- **Gestor**
- **Gerente de loja**

Contexto: loja única (não multi-filial). Todos os perfis acessam via tela de login. Nesta fase, os três perfis têm o mesmo nível de acesso — **diferenciação de permissões entre perfis é uma decisão em aberto para uma fase futura**.

## Funcionalidades

### Essenciais
Primeira etapa do projeto, construída por fases sobre os seguintes tópicos:

1. **Vendas e faturamento**
   - Faturamento do dia, semana e mês
   - Comparativo com período anterior (via tabela de histórico/cache no banco, para não precisar consultar meses anteriores em tempo real; incluir também comparativo de compras)
   - Meta x realizado
   - Ticket médio
   - Quantidade de clientes/cupons
   - Itens vendidos por compra
   - Vendas por hora
   - Vendas por dia da semana
   - Vendas por departamento (com opção de filtrar por grupo, setor e família, e navegar dentro de cada um)
   - Vendas por forma de pagamento
   - Ranking de produtos mais vendidos e de categorias mais vendidas (visão dentro deste tópico)
   - Produtos que mais cresceram/perderam vendas (visão dentro deste tópico)

2. **Ranking de produtos**
   - Top 10 produtos mais vendidos
   - Top 10 produtos por faturamento
   - Top 10 produtos por margem
   - Produtos com maior crescimento
   - Produtos com maior queda
   - Produtos vendidos pela primeira vez
   - Produtos parados sem venda
   - Produtos com alta demanda e baixo estoque

3. **Curva ABC**
   - Classificação cruzada: ABC de vendas + ABC de margem + ABC de estoque por produto
   - Dimensão de análise selecionável (como na Curva ABC do ERP): Grupo, Marca, Família, Produto, Cliente, Fornecedor ou Setor. Um seletor da dimensão escolhida permite filtrar um item específico; com a opção "Todos" (padrão), a curva traz todos os itens da dimensão; com um item escolhido, a curva traz os produtos desse item
   - Métricas: venda = faturamento (`vendaitem.vtotal`); margem = lucro em R$ com o CMV (`vendaitem.pcusto`); estoque = valor em estoque (`produto.qtestoque` × `produto.precocusto`, estoque negativo conta como 0; produtos bloqueados, `produto.situacao = 'B'`, não entram no valor de estoque — as vendas deles continuam contando). Cortes das classes: A = primeiros 80% do valor acumulado, B = até 95%, C = o restante
   - Cliente: `vendacupom.cliente` → `clifor.cod`; todo cupom tem cliente e o cliente 0 é a venda a consumidor (linha "Venda consumidor"); um código de cliente sem registro em `clifor` aparece como item próprio "Sem nome", separado do cliente 0; a classificação de estoque não se aplica a Cliente
   - Fornecedor: a curva é de **compras**, como no ERP: valor comprado por fornecedor = soma de `compranota.TotalNota` (`ES = 'E'`, `Status = 1`) no período, com `compranota.fornecedor` → `clifor.cod`; margem e estoque não se aplicam; não há seleção de um fornecedor específico
   - Seletor de item (`GET /api/curva-abc/itens`): lista os cadastros reais da dimensão em ordem alfabética — grupo, setor, família e marca (todos), cliente (`clifor.tipo = 1`, só código e nome) e produto (apenas `produto.situacao = 'A'`, com busca por digitação obrigatória de no mínimo 2 caracteres); fornecedor não tem seleção. As linhas de id 0 ("Venda consumidor", "Sem grupo", "Sem setor", "Sem família", "Sem marca") aparecem na curva mas não podem ser detalhadas
   - Margem na Curva ABC: soma o lucro apenas dos itens com custo e sinaliza `semCusto`; o Ranking de Produtos devolve lucro nulo quando falta custo em algum item — a mesma diferença deve ser tratada de forma consciente na Rentabilidade
   - Objetivo: identificar produtos que vendem muito mas dão pouca margem, produtos saudáveis, e oportunidades

4. **Rentabilidade**
   - Margem bruta
   - Margem por produto
   - Margem por categoria (grupo, setor ou família — as três dimensões, no mesmo padrão da Curva ABC)
   - Margem por fornecedor (adiado por decisão do usuário: sem fonte de dados barata que ligue produto a fornecedor atual)
   - Produtos que mais geram lucro
   - Produtos que mais geram faturamento
   - Produtos que vendem muito e dão pouco lucro
   - Produtos com margem abaixo do mínimo (o mínimo é digitado pelo usuário na tela, não uma configuração fixa)
   - Evolução da margem ao longo do tempo

5. **Estoque inteligente**
   - Estoque atual, mínimo e máximo
   - Produtos em ruptura e próximos da ruptura
   - Produtos parados / sem giro
   - Cobertura de estoque em dias
   - Produtos com excesso de estoque
   - Valor total parado em estoque
   - Produtos próximos do vencimento (adiado por decisão do usuário: fonte de dados não confirmada)
   - Estoque por departamento (grupo/setor/família)
   - Regras: estoque atual/mínimo/máximo = `produto.qtestoque`/`qtminima`/`qtmaxima`; produtos bloqueados (`situacao = 'B'`) e produtos que não controlam estoque (`Estoque = 'N'`) ficam fora de tudo nas rotas de estoque; ruptura = estoque <= 0 em produto com venda no período; próximo da ruptura = 0 < estoque <= mínimo ou cobertura < 7 dias (com venda no período); excesso = estoque > máximo (máximo preenchido); cobertura = estoque ÷ venda média diária; parado = estoque > 0 sem venda no período, com valor parado = estoque × `precocusto`; o período usa só dias fechados (fim limitado a ontem)

Todas as funcionalidades acima devem ser filtráveis por período.

### Fora do escopo
Registrado como backlog para fases futuras, não fazem parte desta entrega:

- Central de alertas (tópico 6)
- Inteligência para reposição / sugestão automática de compra (tópico 7)
- Previsão de vendas (tópico 8)
- Gestão de preços (tópico 9)
- Promoções inteligentes (tópico 10)
- Clientes (tópico 11)
- Cesta de compras / análise de produtos comprados juntos (tópico 12)
- Fornecedores (tópico 13)
- Perdas e desperdícios (tópico 14)
- Gestão de operadores/caixas (tópico 15)
- Mapa de calor de horários de movimento (tópico 16)
- "Assistente do Gestor" (insights automáticos), tela "O que vai acontecer?" (previsões), "Oportunidades escondidas" e "Índice de Saúde da Empresa"
- Edição de preço de produto pelo gestor diretamente no sistema (mencionada como ideia futura)
- Diferenciação de permissões entre os perfis dono/gestor/gerente de loja

## Módulos

1. **Autenticação/Usuários** — login e gestão de acesso dos 3 perfis (sem diferenciação de permissão nesta fase)
2. **Vendas e Faturamento** — faturamento por período, comparativos, meta x realizado, ticket médio, vendas por hora/dia da semana/departamento/forma de pagamento
3. **Ranking de Produtos** — rankings de produtos por venda, faturamento, margem, crescimento/queda
4. **Curva ABC** — classificação cruzada venda/margem/estoque
5. **Rentabilidade** — margens por produto, categoria, fornecedor e evolução no tempo
6. **Estoque Inteligente** — níveis de estoque, rupturas, cobertura, produtos parados

### Regras de negócio identificadas (origem: banco de dados atual)
- Uma venda só é considerada válida se o tipo dela for de venda: join entre `vendacupom` e `flagvc` por `vendacupom.Flag = flagvc.flag` com `flagvc.Venda = 1` (decisão do usuário; a regra original `flagvc.flag = 1` corresponde a "Pedido" e zeraria o faturamento com os dados reais, em que as vendas são NFC-e, `Flag = 14`)
- `vendacupom.status = 0` → venda ativa; `vendacupom.status = 5` → cancelada
- `vendacupom.valortotal` já é valor líquido
- Vendas por forma de pagamento: join de `vendacupom` com `formapag` pelo campo `formapag`/`idFormaPag`
- `vendacupom` linka com `vendaitem` pelo campo `idcupom`
- `vendaitem` linka com `produto` pelo campo `produto = idproduto`
- `produto` linka com as tabelas `setor`, `grupo` e `familia` (departamentos) — toda visão por departamento deve permitir escolher se a navegação é por grupo, setor ou família, e dentro de cada um
- Clientes estão na tabela `clifor`
- Todas as consultas devem ser construídas por período (filtro de data)

## Stack
- **Backend:** Node.js
- **Frontend:** React
- **Banco de dados:** MariaDB (banco já existente do ERP)
- **Biblioteca de gráficos:** a definir — decisão em aberto (avaliar ECharts, Recharts ou Chart.js e escolher a que apresentar melhor resultado visual)

## Constraints técnicas
- Aplicação web rodando localmente em ambiente **Windows**
- Múltiplos usuários simultâneos (número exato não definido)
- Prazo: implementação imediata
- As tabelas de origem (`vendacupom`, `vendaitem`, `produto`, etc.) possuem grande volume de registros — consultas diretas e repetidas sobre períodos anteriores devem ser evitadas
- **Estratégia de otimização proposta:** criar tabelas de agregação/cache no banco (ex: totais de vendas e compras por período já fechado), populadas via job/rotina de atualização, para que os comparativos com períodos anteriores não exijam varrer as tabelas transacionais originais a cada consulta. Este ponto deve ser detalhado tecnicamente na fase de design/implementação.
- Aplicação precisa, além de ler, gravar dados de volta no banco (ex.: as tabelas de cache/histórico de períodos)

## Critérios de aceitação
- Usuário consegue fazer login e acessar o dashboard (módulo de Autenticação)
- Todas as telas de Vendas, Ranking de Produtos, Curva ABC, Rentabilidade e Estoque permitem selecionar um período (dia, semana, mês ou intervalo customizado)
- O módulo de Vendas exibe faturamento, comparativo com período anterior, meta x realizado, ticket médio, quantidade de cupons, vendas por hora, por dia da semana, por forma de pagamento e por departamento
- Vendas por departamento permitem escolher a navegação por grupo, setor ou família, e filtrar itens dentro de cada nível
- O módulo de Ranking de Produtos exibe top produtos por vendas, faturamento e margem, além de produtos em crescimento/queda, novos e parados
- O módulo de Curva ABC exibe a classificação cruzada (venda/margem/estoque) por dimensão selecionável (produto, grupo, setor, família, marca ou cliente) e, para fornecedor, a curva de compras; itens sem custo cadastrado (`semCusto`) são sinalizados
- O módulo de Rentabilidade exibe margem bruta, por produto, categoria e fornecedor, e evolução da margem no tempo
- O módulo de Estoque exibe estoque atual x mínimo x máximo, rupturas, produtos parados, cobertura em dias e valor parado em estoque
- Apenas vendas com `flagvc.Venda = 1` e `status = 0` (ativas) são consideradas nos indicadores de venda, salvo indicação contrária explícita na tela (ex: relatório de cancelamentos)
- Consultas de comparativo entre períodos utilizam a tabela de histórico/cache, não consultas diretas às tabelas transacionais completas
- Sistema acessível localmente em rede Windows, suportando múltiplos usuários logados simultaneamente

## Decisões em aberto
- Biblioteca de gráficos definitiva (ECharts, Recharts ou Chart.js)
- Diferenciação de permissões entre dono, gestor e gerente de loja (fase futura)
- Edição de preço de produto pelo próprio gestor (fase futura)
- Número exato de usuários simultâneos esperados
- Detalhamento técnico da estratégia de agregação/cache (frequência do job, estrutura das tabelas)
