# Dashboard de Respostas aos Quesitos — INAS/DF

Painel standalone (React + Vite) para acompanhamento das **respostas aos quesitos** geradas
pelo robô do INAS/DF. Mesmo desenho do `pareceres-dashboard`, com os indicadores próprios
desta demanda.

## O que mostra

- **Indicadores** do período: respostas emitidas, valor total e médio, itens analisados,
  % ainda em carência, % no rol do INAS, % no Rol da ANS e % autorizado.
- **Evolução mensal**: quantas respostas saem por mês e quanto envolvem em valor.
- **Enquadramento** por quesito (d, e, f, g) e **natureza do atendimento** (quesito i).
- **Carência** (quesito c) e **viabilidade administrativa** (quesito l).
- **Coparticipação**: ranking dos percentuais do quesito n) mais aplicados.
- **Detalhamento** em tabela paginada, com exportação para Excel.
- **Glossário** dos indicadores.

Dados ao vivo do Supabase, atualizados automaticamente a cada 2 minutos.

## Origem dos dados e privacidade

O painel lê a **view `vw_respostas_quesitos`**, não a tabela `respostas_quesitos`.

Isso é uma trava, não um detalhe: a chave `anon` fica visível no bundle do navegador. A view
expõe todas as colunas **exceto `idade_beneficiario` e `data_adesao`**, que são os únicos campos
do beneficiário gravados — nome e carteirinha nunca chegam ao banco. E, na tabela, a `anon` tem
**privilégio de SELECT apenas nas colunas públicas**: pedir `idade_beneficiario` direto na
tabela volta *permission denied*, e até um `select=*` é negado.

O SQL que cria tabela, policies e view é o `respostas_quesitos.sql`, na pasta do robô
(`Robô Resposta aos Quesitos - INAS`). Rode-o no SQL Editor do Supabase antes de subir o
painel — ele é idempotente e pode ser reaplicado.

A view roda como **`security_invoker`**: respeita o RLS e os privilégios de quem chama, em vez
de rodar com o privilégio do dono. Ela só devolve linhas porque a tabela tem policy de `SELECT`
para a `anon` — policy que existe porque o **upsert do robô** precisa dela (o `UPDATE ... WHERE
guias` tem de enxergar a linha). Remover essa policy quebra as duas coisas de uma vez: o painel
fica vazio e o registro do robô volta a falhar em silêncio.

No Table Editor a view aparece marcada como *"Unrestricted"*. É assim para qualquer view — elas
não têm RLS próprio — e não indica falta de proteção.

## Como rodar

Pré-requisito: Node.js 18+.

```bash
npm install
npm run dev      # ambiente de desenvolvimento (http://localhost:5173)
```

Para gerar a versão de produção (a pasta `dist/` é o que se hospeda/entrega):

```bash
npm run build
npm run preview  # confere o build localmente
```

## Configuração (.env)

As credenciais ficam em `.env` (veja `.env.example`) — são as mesmas chaves públicas (anon) do
projeto Supabase usado pelo Robô Parecer, onde a tabela também vive:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Deploy (Vercel)

Repositório: <https://github.com/tcidrack/dashboard-resposta-aos-quesitos>

Mesmo caminho do `pareceres-dashboard`: importar o repositório com preset **Vite**
(build `npm run build`, saída `dist/`), ligado à branch `main` — todo push na `main` dispara
build e publica sozinho. Não há `vercel.json`; os padrões do preset bastam.

As duas variáveis precisam existir no painel da Vercel (*Settings → Environment Variables*),
nos três escopos — Production, Preview e Development:

| Variável | Valor |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase (o mesmo do Robô Parecer) |
| `VITE_SUPABASE_ANON_KEY` | chave **anon** — nunca a `service_role` |

Atenção: o Vite injeta as `VITE_*` em tempo de **build**, não de runtime. Se faltarem, o site
sobe e renderiza, mas nunca carrega dado nenhum — `src/lib/supabase.js` só registra um
`console.error`. Depois de alterar uma variável é preciso **redeployar**.

## Personalização

- **Título/logo**: `src/App.jsx` (header) e `index.html` (`<title>`).
- **Período inicial**: abre no mês corrente (`primeiroDiaDoMesBR` em `src/tabs/Quesitos.jsx`).
  Limpar os filtros faz os cards mostrarem o total geral de toda a base.
- **Textos explicativos**: banner de introdução e glossário em `src/App.jsx`; legendas dos
  gráficos em `src/tabs/Quesitos.jsx`.
