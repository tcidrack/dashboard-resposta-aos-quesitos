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

O painel lê a tabela `respostas_quesitos` com a chave pública (`anon`), **sempre
com lista explícita de colunas**.

Isso é uma trava, não um detalhe de estilo: a `anon` fica visível no bundle do
navegador e tem privilégio de `SELECT` **apenas nas colunas públicas**. Pedir
`idade_beneficiario` ou `data_adesao` volta *permission denied*, e até um
`select=*` é negado — esses dois são os únicos campos do beneficiário gravados,
já que nome e carteirinha nunca chegam ao banco.

O modo de falha é favorável: quem escrever `select=*` recebe um **401 visível**,
não um vazamento silencioso.

Existiu uma view `vw_respostas_quesitos` cumprindo esse papel, de quando a
tabela não tinha policy de `SELECT`. A policy passou a ser obrigatória (o upsert
do robô precisa dela para o `UPDATE ... WHERE` enxergar a linha), a proteção
migrou para o privilégio de coluna — que vale igual na tabela — e a view virou
só mais um lugar para manter em dia. Foi removida.

O SQL que cria tabela, policies e privilégios é o `respostas_quesitos.sql`, na
pasta do robô (`Robô Resposta aos Quesitos - INAS`). Rode-o no SQL Editor do
Supabase antes de subir o painel — ele é idempotente e pode ser reaplicado.

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
