import { useState, useCallback, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer,
  ComposedChart, Line, PieChart, Pie, Cell,
} from "recharts";
import { supabase } from "../lib/supabase";
import { dataHojeBR } from "../lib/dateUtils";
import {
  num, formatarMoedaBR, formatarMoedaCompactaBR, formatarPercentualBR,
} from "../lib/formatUtils";
import { usePollingFetch } from "../hooks/usePollingFetch";
import { useMediaQuery } from "../hooks/useMediaQuery";

// A VIEW, nunca a tabela: ela existe justamente para não trafegar idade nem
// data de adesão do beneficiário para o navegador (ver respostas_quesitos.sql).
const FONTE = "vw_respostas_quesitos";

// Teto de linhas por consulta. Indicadores, gráficos e tabela saem todos desse
// mesmo conjunto, então é ele que define o alcance do painel.
const LIMITE_LINHAS = 5000;

const fmtInteiro = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR"));

// Enquadramento: um grupo por quesito, uma série por resposta possível.
// Os rótulos não citam a letra do quesito (d, e, f...) de propósito: dizem o
// que a coluna significa. "Enquadra na Carência" é a resposta do quesito d, e
// não se confunde com a coluna "Carência", que é a situação do beneficiário.
const QUESITOS_ENQUADRAMENTO = [
  { campo: "resposta_d", rotulo: "Enquadra na Carência" },
  { campo: "resposta_e", rotulo: "Rol INAS" },
  { campo: "resposta_f", rotulo: "Rol ANS" },
  { campo: "resposta_g", rotulo: "Protocolo Clínico" },
];
const SERIES_ENQUADRAMENTO = ["Sim", "Não", "Parcialmente"];

const METRICAS_RANKING = {
  quantidade:  { label: "Quantidade de respostas", fmt: fmtInteiro,      fmtEixo: fmtInteiro },
  valor_total: { label: "Valor total",             fmt: formatarMoedaBR, fmtEixo: formatarMoedaCompactaBR },
};

// Coluna DATE ("YYYY-MM-DD") — sem new Date() para não deslocar o dia por timezone
function formatarDataBR(iso) {
  if (!iso) return "—";
  return iso.split("-").reverse().join("/");
}

function formatarDataHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    `${String(d.getDate()).padStart(2, "0")}/` +
    `${String(d.getMonth() + 1).padStart(2, "0")}/` +
    `${d.getFullYear()} ` +
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  );
}

// Dashboard de apresentação: abre no mês corrente (não só "hoje") para já mostrar dados.
function primeiroDiaDoMesBR() {
  return dataHojeBR().slice(0, 8) + "01";
}

// Texto livre do combobox de viabilidade: compara sem acento/caixa, e por
// igualdade — "não autorizado" contém "autorizado", então includes() erraria.
function normalizarTexto(v) {
  return (v || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function rotuloCarencia(v) {
  if (v === true) return "Ainda em carência";
  if (v === false) return "Carência cumprida";
  return "Não respondido";
}

// Cabeçalho explicativo de seção — texto de apresentação, sem lógica.
function SecaoTitulo({ titulo, descricao, cor }) {
  return (
    <div className="secao" style={{ color: cor }}>
      <h2>{titulo}</h2>
      {descricao && <p>{descricao}</p>}
    </div>
  );
}

// Conta ocorrências de um campo categórico, ignorando vazios.
function contarPor(dados, campo) {
  const grupos = new Map();
  for (const r of dados) {
    const valor = (r[campo] || "").trim();
    if (!valor) continue;
    grupos.set(valor, (grupos.get(valor) || 0) + 1);
  }
  return [...grupos.entries()]
    .map(([nome, valor]) => ({ nome, valor }))
    .sort((a, b) => b.valor - a.valor);
}

// Percentual de linhas cujo campo casa com o valor esperado, sobre as que
// responderam aquele campo (não respondidas nunca contam como "não").
function percentualDe(dados, campo, esperado) {
  let respondidas = 0;
  let casaram = 0;
  for (const r of dados) {
    const valor = normalizarTexto(r[campo]);
    if (!valor) continue;
    respondidas += 1;
    if (valor === esperado) casaram += 1;
  }
  return respondidas > 0 ? (casaram / respondidas) * 100 : null;
}

function truncar(s, max) {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export default function Quesitos({ tema, cores }) {
  const [busca, setBusca] = useState("");
  const [dataInicio, setDataInicio] = useState(primeiroDiaDoMesBR);
  const [dataFim, setDataFim] = useState("");
  const [filtroNatureza, setFiltroNatureza] = useState("");
  const [filtroViabilidade, setFiltroViabilidade] = useState("");
  const [filtroCarencia, setFiltroCarencia] = useState("");
  const [metrica, setMetrica] = useState("quantidade");
  const [naturezas, setNaturezas] = useState([]);
  const [viabilidades, setViabilidades] = useState([]);
  const ITENS_POR_PAGINA = 20;
  const [pagina, setPagina] = useState(1);

  // Eixos, raios e rótulos do Recharts são props em pixel — CSS não os alcança.
  const isMobile = useMediaQuery("(max-width: 600px)");
  const alturaGrafico = isMobile ? 240 : 280;

  const accentColor = tema === "escuro" ? "#FFCB05" : "#FF0073";
  const corSecundaria = tema === "escuro" ? "#60A5FA" : "#0070FF";
  const corTerceira = tema === "escuro" ? "#C4B5FD" : "#7C3AED";
  // Paleta categórica validada por tema (validate_palette.js do skill dataviz)
  const PALETA = tema === "escuro"
    ? ["#60A5FA", "#FFCB05", "#C4B5FD", "#34D399", "#FB923C"]
    : ["#0070FF", "#FF0073", "#7C3AED", "#00876C", "#B45309"];

  const fetchRespostas = useCallback(async (signal) => {
    let q = supabase
      .from(FONTE)
      .select("id, created_at, guias, data_documento, status, carencia_pendente, " +
              "carencia_lab, carencia_demais, carencia_parto, carencia_urgencia, " +
              "carencia_consultas, carencia_exames, resposta_d, resposta_e, " +
              "resposta_f, resposta_g, i_resposta, j_opcao, k_opcao, l_texto, " +
              "m_resposta, n_percentuais, qtd_itens, valor_total")
      .order("created_at", { ascending: false });
    if (dataInicio) q = q.gte("data_documento", dataInicio);
    if (dataFim) q = q.lte("data_documento", dataFim);
    if (filtroNatureza) q = q.eq("i_resposta", filtroNatureza);
    if (filtroViabilidade) q = q.eq("l_texto", filtroViabilidade);
    if (filtroCarencia) q = q.eq("carencia_pendente", filtroCarencia === "pendente");
    q = q.limit(LIMITE_LINHAS);
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (error) {
      // Abort é supersessão normal (troca de filtro), não falha — logar só o
      // que de fato deu errado mantém o console significativo.
      if (!signal?.aborted) console.error("[quesitos] Falha ao buscar as linhas:", error);
      return [];
    }
    return data || [];
  }, [dataInicio, dataFim, filtroNatureza, filtroViabilidade, filtroCarencia]);

  const { data: dados, loading } = usePollingFetch(
    fetchRespostas,
    120000,
    [dataInicio, dataFim, filtroNatureza, filtroViabilidade, filtroCarencia]
  );

  // KPIs derivados das mesmas linhas que alimentam tabela e gráficos — uma só
  // fonte de verdade, então os cards nunca discordam do que está listado abaixo.
  const kpis = useMemo(() => {
    let somaValor = 0;
    let nComValor = 0;
    let somaItens = 0;
    let respondeuCarencia = 0;
    let emCarencia = 0;
    for (const r of dados) {
      const valor = num(r.valor_total);
      if (valor != null) { somaValor += valor; nComValor += 1; }
      const itens = num(r.qtd_itens);
      if (itens != null) somaItens += itens;
      if (r.carencia_pendente != null) {
        respondeuCarencia += 1;
        if (r.carencia_pendente) emCarencia += 1;
      }
    }
    return {
      respostas: dados.length,
      valorTotal: somaValor,
      ticketMedio: nComValor > 0 ? somaValor / nComValor : null,
      itens: somaItens,
      pctCarencia: respondeuCarencia > 0 ? (emCarencia / respondeuCarencia) * 100 : null,
      pctInas: percentualDe(dados, "resposta_e", "sim"),
      pctAns: percentualDe(dados, "resposta_f", "sim"),
      pctAutorizado: percentualDe(dados, "l_texto", "autorizado"),
    };
  }, [dados]);

  // Valores únicos para os dropdowns (carga única na montagem)
  useEffect(() => {
    let ativo = true;
    (async () => {
      const [natRes, viaRes] = await Promise.all([
        supabase.from(FONTE).select("i_resposta").not("i_resposta", "is", null).limit(LIMITE_LINHAS),
        supabase.from(FONTE).select("l_texto").not("l_texto", "is", null).limit(LIMITE_LINHAS),
      ]);
      if (!ativo) return;
      if (natRes.error) console.error("[quesitos] Falha ao carregar naturezas:", natRes.error);
      if (viaRes.error) console.error("[quesitos] Falha ao carregar viabilidades:", viaRes.error);
      setNaturezas([...new Set((natRes.data || []).map((r) => r.i_resposta))].sort());
      setViabilidades([...new Set((viaRes.data || []).map((r) => r.l_texto))].sort());
    })();
    return () => { ativo = false; };
  }, []);

  let filtrados = dados;
  if (busca.trim()) {
    const termo = busca.trim().replace(/\D/g, "");
    if (termo) filtrados = filtrados.filter((r) => (r.guias || "").includes(termo));
  }

  // Volume e valor por mês do documento
  const chartMensal = useMemo(() => {
    const meses = new Map();
    for (const r of dados) {
      const mes = (r.data_documento || r.created_at || "").slice(0, 7);
      if (!mes) continue;
      let m = meses.get(mes);
      if (!m) { m = { respostas: 0, valor: 0 }; meses.set(mes, m); }
      m.respostas += 1;
      const valor = num(r.valor_total);
      if (valor != null) m.valor += valor;
    }
    return [...meses.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([mes, v]) => ({ mes: `${mes.slice(5)}/${mes.slice(0, 4)}`, ...v }));
  }, [dados]);

  // Enquadramento: contagem de Sim/Não/Parcialmente por quesito
  const chartEnquadramento = useMemo(() => {
    return QUESITOS_ENQUADRAMENTO.map(({ campo, rotulo }) => {
      const linha = { quesito: rotulo };
      for (const serie of SERIES_ENQUADRAMENTO) linha[serie] = 0;
      for (const r of dados) {
        const valor = (r[campo] || "").trim();
        if (SERIES_ENQUADRAMENTO.includes(valor)) linha[valor] += 1;
      }
      return linha;
    }).filter((l) => SERIES_ENQUADRAMENTO.some((s) => l[s] > 0));
  }, [dados]);

  // Rosca da natureza do atendimento (quesito i)
  const composicaoNatureza = useMemo(() => {
    let itens = contarPor(dados, "i_resposta");
    const total = itens.reduce((a, i) => a + i.valor, 0);
    if (total <= 0) return [];
    // mais grupos que cores na paleta: agrega os menores em "Outros"
    if (itens.length > PALETA.length) {
      const maiores = itens.slice(0, PALETA.length - 1);
      const outros = itens.slice(PALETA.length - 1).reduce((acc, i) => acc + i.valor, 0);
      itens = [...maiores, { nome: "Outros", valor: outros }];
    }
    // ordem alfabética estável: a cor segue a categoria entre filtros
    return itens
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .map((i) => ({ ...i, pct: (i.valor / total) * 100 }));
  }, [dados, PALETA.length]);

  const chartViabilidade = useMemo(() => contarPor(dados, "l_texto"), [dados]);

  const chartCarencia = useMemo(() => {
    const grupos = new Map();
    for (const r of dados) {
      const nome = rotuloCarencia(r.carencia_pendente);
      grupos.set(nome, (grupos.get(nome) || 0) + 1);
    }
    return [...grupos.entries()]
      .map(([nome, valor]) => ({ nome, valor }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [dados]);

  // Coparticipação: o robô grava os percentuais mantidos num só campo,
  // separados por " | " — aqui cada um vira uma linha do ranking.
  const rankingCoparticipacao = useMemo(() => {
    const grupos = new Map();
    for (const r of dados) {
      const bruto = (r.n_percentuais || "").trim();
      if (!bruto) continue;
      const valor = num(r.valor_total) || 0;
      for (const parte of bruto.split(" | ")) {
        const nome = parte.trim();
        if (!nome) continue;
        let g = grupos.get(nome);
        if (!g) { g = { quantidade: 0, valor_total: 0 }; grupos.set(nome, g); }
        g.quantidade += 1;
        g.valor_total += valor;
      }
    }
    return [...grupos.entries()]
      .map(([nome, g]) => ({ nome, valor: g[metrica] }))
      .filter((g) => g.valor > 0)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 10);
  }, [dados, metrica]);

  const totalPaginas = Math.ceil(filtrados.length / ITENS_POR_PAGINA);
  const paginaSegura = Math.min(Math.max(1, pagina), Math.max(1, totalPaginas));
  const inicio = (paginaSegura - 1) * ITENS_POR_PAGINA;
  const paginaDados = filtrados.slice(inicio, inicio + ITENS_POR_PAGINA);

  const PAGINAS_VISIVEIS = 5;
  const metade = Math.floor(PAGINAS_VISIVEIS / 2);
  let inicioPaginas = Math.max(1, paginaSegura - metade);
  let fimPaginas = Math.min(totalPaginas, inicioPaginas + PAGINAS_VISIVEIS - 1);
  if (fimPaginas - inicioPaginas + 1 < PAGINAS_VISIVEIS) {
    inicioPaginas = Math.max(1, fimPaginas - PAGINAS_VISIVEIS + 1);
  }
  const paginasVisiveis = Array.from(
    { length: fimPaginas - inicioPaginas + 1 },
    (_, i) => inicioPaginas + i
  );

  function irParaPagina(p) {
    setPagina(Math.min(Math.max(1, p), totalPaginas));
  }

  // Voltar pra primeira página quando o recorte muda. Ajustar durante o render
  // (padrão "You Might Not Need an Effect") em vez de num efeito.
  const chaveFiltros = [busca, dataInicio, dataFim, filtroNatureza, filtroViabilidade, filtroCarencia].join("\u0000");   // separador que nao aparece nos valores
  const [chaveAnterior, setChaveAnterior] = useState(chaveFiltros);
  if (chaveAnterior !== chaveFiltros) {
    setChaveAnterior(chaveFiltros);
    setPagina(1);
  }

  function limparFiltros() {
    setBusca("");
    setDataInicio("");
    setDataFim("");
    setFiltroNatureza("");
    setFiltroViabilidade("");
    setFiltroCarencia("");
  }

  function exportarExcel() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["", "", "", "Respostas emitidas", kpis.respostas],
      ["", "", "", "Valor total", Number(kpis.valorTotal.toFixed(2))],
      ["", "", "", "Valor médio por resposta", kpis.ticketMedio != null ? Number(kpis.ticketMedio.toFixed(2)) : "—"],
      ["", "", "", "Itens analisados", kpis.itens],
      ["", "", "", "% ainda em carência", kpis.pctCarencia != null ? Number(kpis.pctCarencia.toFixed(2)) : "—"],
      ["", "", "", "% no rol do INAS", kpis.pctInas != null ? Number(kpis.pctInas.toFixed(2)) : "—"],
      ["", "", "", "% no Rol da ANS", kpis.pctAns != null ? Number(kpis.pctAns.toFixed(2)) : "—"],
      ["", "", "", "% autorizado", kpis.pctAutorizado != null ? Number(kpis.pctAutorizado.toFixed(2)) : "—"],
      [],
      ["Guias", "Data do Documento", "Processado em", "Carência", "Enquadra na Carência",
       "Rol INAS", "Rol ANS", "Natureza", "Viabilidade", "Itens", "Valor Total", "Situação"],
      ...filtrados.map((r) => [
        r.guias || "—",
        formatarDataBR(r.data_documento),
        formatarDataHora(r.created_at),
        rotuloCarencia(r.carencia_pendente),
        r.resposta_d || "—",
        r.resposta_e || "—",
        r.resposta_f || "—",
        r.i_resposta || "—",
        r.l_texto || "—",
        num(r.qtd_itens) ?? "—",
        num(r.valor_total) ?? "—",
        r.status || "—",
      ]),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Respostas");
    XLSX.writeFile(wb, "respostas-aos-quesitos.xlsx");
  }

  const cardStyle = { backgroundColor: cores.card, color: cores.texto, cursor: "pointer" };

  // Rótulo direto da rosca em token de texto do tema (nunca na cor da fatia)
  function renderRotuloRosca({ cx, cy, midAngle, outerRadius, percent, name }) {
    const RAD = Math.PI / 180;
    const r = outerRadius + 16;
    const x = cx + r * Math.cos(-midAngle * RAD);
    const y = cy + r * Math.sin(-midAngle * RAD);
    return (
      <text x={x} y={y} fill={cores.texto} fontSize={11} textAnchor={x > cx ? "start" : "end"} dominantBaseline="central">
        {`${name} (${(percent * 100).toFixed(1).replace(".", ",")}%)`}
      </text>
    );
  }

  return (
    <>
      {/* INDICADORES */}
      <SecaoTitulo
        titulo="Indicadores do período"
        descricao="Resumo das respostas emitidas. Ao limpar os filtros, os cards mostram o total geral (toda a base); com filtros aplicados, refletem o recorte selecionado."
        cor="#fff"
      />

      {/* CARDS */}
      <div className="cards">
        <div className="card animated-card" style={cardStyle}>
          <h3>Respostas Emitidas</h3>
          <p>{kpis.respostas.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>no período filtrado</p>
        </div>
        <div className="card animated-card" style={cardStyle}>
          <h3>Valor Total</h3>
          <p>{formatarMoedaBR(kpis.valorTotal)}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>soma dos itens das guias</p>
        </div>
        <div className="card animated-card" style={cardStyle}>
          <h3>Valor Médio por Resposta</h3>
          <p>{formatarMoedaBR(kpis.ticketMedio)}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>Σ valor ÷ nº de respostas com valor</p>
        </div>
        <div className="card animated-card" style={cardStyle}>
          <h3>Itens Analisados</h3>
          <p>{fmtInteiro(kpis.itens)}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>procedimentos e materiais das guias</p>
        </div>
        <div className="card animated-card" style={cardStyle}>
          <h3>Ainda em Carência</h3>
          <p>{formatarPercentualBR(kpis.pctCarencia)}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>sobre as respostas que informaram a situação de carência</p>
        </div>
        <div className="card animated-card" style={cardStyle}>
          <h3>No Rol do INAS</h3>
          <p>{formatarPercentualBR(kpis.pctInas)}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>procedimento previsto no regulamento do INAS/DF</p>
        </div>
        <div className="card animated-card" style={cardStyle}>
          <h3>No Rol da ANS</h3>
          <p>{formatarPercentualBR(kpis.pctAns)}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>procedimento previsto no Rol da ANS</p>
        </div>
        <div className="card animated-card" style={cardStyle}>
          <h3>Autorizado</h3>
          <p>{formatarPercentualBR(kpis.pctAutorizado)}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>desfecho administrativo do pedido</p>
        </div>
      </div>

      {dados.length >= LIMITE_LINHAS && (
        <p style={{ color: cores.texto, fontSize: 13, opacity: 0.8, margin: "0 0 12px" }}>
          O filtro atingiu o teto de {LIMITE_LINHAS.toLocaleString("pt-BR")} respostas: indicadores,
          gráficos e tabela refletem apenas as mais recentes. Refine o período para um recorte exato.
        </p>
      )}

      {/* EVOLUÇÃO E COMPOSIÇÃO */}
      {dados.length > 0 && (
        <SecaoTitulo
          titulo="Evolução e composição"
          descricao="Quantas respostas saem a cada mês, quanto elas envolvem em valor e como se distribuem as conclusões."
          cor="#fff"
        />
      )}

      {/* GRÁFICO TEMPORAL */}
      {chartMensal.length > 0 && (
        <div className="card animated-card" style={cardStyle}>
          <h3>Respostas e Valor por Mês</h3>
          <p className="grafico-legenda" style={{ color: cores.texto }}>
            Barras contam as respostas emitidas em cada mês; a linha roxa mostra o valor total envolvido.
          </p>
          <div style={{ width: "100%", height: alturaGrafico }}>
            <ResponsiveContainer>
              <ComposedChart data={chartMensal}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} vertical={false} />
                <XAxis
                  dataKey="mes"
                  stroke={cores.texto}
                  tick={{ fontSize: 11 }}
                  interval={isMobile ? "preserveStartEnd" : "preserveEnd"}
                />
                <YAxis yAxisId="qtd" stroke={cores.texto} tick={{ fontSize: 11 }} tickFormatter={fmtInteiro} />
                <YAxis yAxisId="valor" orientation="right" stroke={cores.texto} tick={{ fontSize: 11 }} tickFormatter={formatarMoedaCompactaBR} />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  formatter={(v, n) => (n === "Valor total" ? formatarMoedaBR(v) : fmtInteiro(v))}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="qtd" dataKey="respostas" name="Respostas emitidas" fill={corSecundaria} radius={[4, 4, 0, 0]} />
                <Line yAxisId="valor" type="monotone" dataKey="valor" name="Valor total" stroke={corTerceira} strokeWidth={2} dot={{ r: 4, fill: corTerceira }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ENQUADRAMENTO E NATUREZA */}
      {dados.length > 0 && (
        <div className="graficos-grid">
          {chartEnquadramento.length > 0 && (
            <div className="card animated-card" style={cardStyle}>
              <h3>Enquadramento por Quesito</h3>
              <p className="grafico-legenda" style={{ color: cores.texto }}>
                Como o pedido foi enquadrado: carência prevista no regulamento, rol do INAS, Rol da ANS e protocolo clínico.
              </p>
              <div style={{ width: "100%", height: alturaGrafico }}>
                <ResponsiveContainer>
                  <BarChart data={chartEnquadramento}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} vertical={false} />
                    <XAxis dataKey="quesito" stroke={cores.texto} tick={{ fontSize: isMobile ? 10 : 11 }} />
                    <YAxis stroke={cores.texto} tick={{ fontSize: 11 }} tickFormatter={fmtInteiro} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => fmtInteiro(v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {SERIES_ENQUADRAMENTO.map((serie, i) => (
                      <Bar key={serie} dataKey={serie} name={serie} fill={PALETA[i % PALETA.length]} radius={[4, 4, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {composicaoNatureza.length > 0 && (
            <div className="card animated-card" style={cardStyle}>
              <h3>Natureza do Atendimento</h3>
              <p className="grafico-legenda" style={{ color: cores.texto }}>
                Quanto do que chega é urgência, emergência ou eletiva.
              </p>
              <div style={{ width: "100%", height: alturaGrafico }}>
                <ResponsiveContainer>
                  <PieChart>
                    {/* No mobile os rótulos externos só seriam cortados — a legenda
                        e o tooltip já nomeiam as fatias. */}
                    <Pie
                      data={composicaoNatureza}
                      dataKey="valor"
                      nameKey="nome"
                      innerRadius={isMobile ? 45 : 60}
                      outerRadius={isMobile ? 70 : 90}
                      paddingAngle={2}
                      label={isMobile ? false : renderRotuloRosca}
                      labelLine={isMobile ? false : { stroke: cores.texto, strokeOpacity: 0.4 }}
                    >
                      {composicaoNatureza.map((f, i) => (
                        <Cell key={f.nome} fill={PALETA[i % PALETA.length]} stroke={cores.card} strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ fontSize: 12 }}
                      formatter={(v, n, item) => [
                        `${fmtInteiro(v)} · ${formatarPercentualBR(item?.payload?.pct)}`,
                        n,
                      ]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CARÊNCIA E VIABILIDADE */}
      {dados.length > 0 && (
        <div className="graficos-grid">
          {chartCarencia.length > 0 && (
            <div className="card animated-card" style={cardStyle}>
              <h3>Situação de Carência</h3>
              <p className="grafico-legenda" style={{ color: cores.texto }}>
                Quantos beneficiários já haviam cumprido a carência quando o pedido foi analisado.
              </p>
              <div style={{ width: "100%", height: alturaGrafico }}>
                <ResponsiveContainer>
                  <BarChart data={chartCarencia}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} vertical={false} />
                    <XAxis dataKey="nome" stroke={cores.texto} tick={{ fontSize: isMobile ? 10 : 11 }} />
                    <YAxis stroke={cores.texto} tick={{ fontSize: 11 }} tickFormatter={fmtInteiro} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => fmtInteiro(v)} />
                    <Bar dataKey="valor" name="Respostas" fill={corSecundaria} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {chartViabilidade.length > 0 && (
            <div className="card animated-card" style={cardStyle}>
              <h3>Viabilidade Administrativa</h3>
              <p className="grafico-legenda" style={{ color: cores.texto }}>
                Desfecho administrativo do pedido — autorizado, não autorizado ou parcialmente autorizado.
              </p>
              <div style={{ width: "100%", height: alturaGrafico }}>
                <ResponsiveContainer>
                  <BarChart data={chartViabilidade}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} vertical={false} />
                    <XAxis
                      dataKey="nome"
                      stroke={cores.texto}
                      tick={{ fontSize: isMobile ? 10 : 11 }}
                      tickFormatter={isMobile ? (v) => truncar(v, 10) : undefined}
                      interval={0}
                      angle={isMobile ? -35 : 0}
                      textAnchor={isMobile ? "end" : "middle"}
                      height={isMobile ? 64 : 30}
                    />
                    <YAxis stroke={cores.texto} tick={{ fontSize: 11 }} tickFormatter={fmtInteiro} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => fmtInteiro(v)} />
                    <Bar dataKey="valor" name="Respostas" fill={accentColor} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* COPARTICIPAÇÃO */}
      {rankingCoparticipacao.length > 0 && (
        <>
          <SecaoTitulo
            titulo="Coparticipação"
            descricao="Os percentuais de coparticipação que mais aparecem nas respostas. Troque a métrica para ordenar por quantidade ou por valor envolvido."
            cor="#fff"
          />
          <div className="filtro" style={{ marginTop: 16 }}>
            <div className="linha-filtros">
              <div className="grupo-filtro">
                <label>Métrica:</label>
                <select
                  className="filtro-processo"
                  value={metrica}
                  onChange={(e) => setMetrica(e.target.value)}
                >
                  {Object.entries(METRICAS_RANKING).map(([k, m]) => (
                    <option key={k} value={k}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="card animated-card" style={{ ...cardStyle, marginTop: 16 }}>
            <h3>{METRICAS_RANKING[metrica].label} por Percentual Aplicado</h3>
            <div style={{ width: "100%", height: isMobile ? 320 : 300 }}>
              <ResponsiveContainer>
                <BarChart
                  data={rankingCoparticipacao.map((d) => ({ ...d, nome: truncar(d.nome, isMobile ? 14 : 45) }))}
                  layout="vertical"
                >
                  <XAxis type="number" stroke={cores.texto} tick={{ fontSize: 11 }} tickFormatter={METRICAS_RANKING[metrica].fmtEixo} />
                  <YAxis type="category" dataKey="nome" width={isMobile ? 96 : 280} stroke={cores.texto} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => METRICAS_RANKING[metrica].fmt(v)} />
                  <Bar dataKey="valor" fill={accentColor} name={METRICAS_RANKING[metrica].label} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* FILTROS */}
      <SecaoTitulo
        titulo="Filtros e detalhamento"
        descricao="Refine por número de guia, natureza, viabilidade, carência ou período. A tabela lista cada resposta e pode ser exportada em Excel."
        cor="#fff"
      />
      <div className="filtro" style={{ marginTop: 16 }}>
        <div className="linha-filtros">
          <div className="grupo-filtro">
            <label>Buscar:</label>
            <input
              className="filtro-processo"
              type="text"
              placeholder="Número da guia"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div className="grupo-filtro">
            <label>Natureza:</label>
            <select
              className="filtro-processo"
              value={filtroNatureza}
              onChange={(e) => setFiltroNatureza(e.target.value)}
            >
              <option value="">Todas</option>
              {naturezas.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="grupo-filtro">
            <label>Viabilidade:</label>
            <select
              className="filtro-processo"
              value={filtroViabilidade}
              onChange={(e) => setFiltroViabilidade(e.target.value)}
            >
              <option value="">Todas</option>
              {viabilidades.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="grupo-filtro">
            <label>Carência:</label>
            <select
              className="filtro-processo"
              value={filtroCarencia}
              onChange={(e) => setFiltroCarencia(e.target.value)}
            >
              <option value="">Todas</option>
              <option value="cumprida">Carência cumprida</option>
              <option value="pendente">Ainda em carência</option>
            </select>
          </div>
          <div className="grupo-filtro">
            <label>Período:</label>
            <input
              className="filtro-data"
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
            />
            <span className="ate-text">até</span>
            <input
              className="filtro-data"
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
            />
          </div>
          <button className="btn-tema" onClick={limparFiltros}>
            <span className="material-symbols-outlined">mop</span>
            Limpar Filtros
          </button>
        </div>
      </div>

      {/* TABELA */}
      <div className="tabela-container" style={{ backgroundColor: cores.card, color: cores.texto, marginTop: "20px" }}>
        <div className="tabela-cabecalho">
          <h3 style={{ margin: 0 }}>Detalhamento</h3>
          <span style={{ fontSize: "13px", opacity: 0.8 }}>
            Mostrando {filtrados.length === 0 ? 0 : inicio + 1}—{Math.min(inicio + ITENS_POR_PAGINA, filtrados.length)} de {filtrados.length.toLocaleString("pt-BR")}
          </span>
        </div>
        <div className="tabela-scroll">
          <table className="tabela-detalhe">
            <thead>
              <tr>
                <th style={{ color: cores.texto }}>Guias</th>
                <th style={{ color: cores.texto }}>Data do Documento</th>
                <th style={{ color: cores.texto }}>Processado em</th>
                <th style={{ color: cores.texto }}>Carência</th>
                <th style={{ color: cores.texto }}>Enquadra na Carência</th>
                <th style={{ color: cores.texto }}>Rol INAS</th>
                <th style={{ color: cores.texto }}>Rol ANS</th>
                <th style={{ color: cores.texto }}>Natureza</th>
                <th style={{ color: cores.texto }}>Viabilidade</th>
                <th style={{ color: cores.texto }}>Itens</th>
                <th style={{ color: cores.texto }}>Valor Total</th>
                <th style={{ color: cores.texto }}>Situação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} style={{ color: cores.texto, padding: 32 }}>Carregando...</td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={12} style={{ color: cores.texto, padding: 32 }}>Nenhum registro encontrado.</td></tr>
              ) : paginaDados.map((r) => (
                <tr key={r.id}>
                  <td style={{ color: cores.texto }}>{r.guias || "—"}</td>
                  <td style={{ color: cores.texto }}>{formatarDataBR(r.data_documento)}</td>
                  <td style={{ color: cores.texto }}>{formatarDataHora(r.created_at)}</td>
                  <td style={{ color: cores.texto }}>{rotuloCarencia(r.carencia_pendente)}</td>
                  <td style={{ color: cores.texto }}>{r.resposta_d || "—"}</td>
                  <td style={{ color: cores.texto }}>{r.resposta_e || "—"}</td>
                  <td style={{ color: cores.texto }}>{r.resposta_f || "—"}</td>
                  <td style={{ color: cores.texto }}>{r.i_resposta || "—"}</td>
                  <td style={{ color: cores.texto }}>{r.l_texto || "—"}</td>
                  <td style={{ color: cores.texto }}>{num(r.qtd_itens) ?? "—"}</td>
                  <td style={{ color: cores.texto }}>{formatarMoedaBR(r.valor_total)}</td>
                  <td style={{ color: cores.texto }}>{r.status || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPaginas > 1 && (
          <div className="paginacao" style={{ borderTop: "1px solid rgba(128,128,128,0.2)" }}>
            <button className="paginacao-btn" onClick={() => irParaPagina(paginaSegura - 1)} disabled={paginaSegura <= 1}
              style={{ background: tema === "escuro" ? "#374151" : "#e5e7eb", color: cores.texto, fontWeight: "bold", padding: "6px 12px" }}>
              Anterior
            </button>
            {paginasVisiveis[0] > 1 && (
              <>
                <button className="paginacao-btn" onClick={() => irParaPagina(1)} style={{ background: cores.card, color: cores.texto }}>1</button>
                {paginasVisiveis[0] > 2 && <span style={{ color: cores.texto, opacity: 0.5 }}>...</span>}
              </>
            )}
            {paginasVisiveis.map((p) => (
              <button key={p} className={`paginacao-btn ${p === paginaSegura ? "paginacao-ativa" : ""}`}
                onClick={() => irParaPagina(p)}
                style={{ background: p === paginaSegura ? accentColor : (tema === "escuro" ? "#374151" : "#e5e7eb"), color: p === paginaSegura ? "#fff" : cores.texto }}>
                {p}
              </button>
            ))}
            {paginasVisiveis[paginasVisiveis.length - 1] < totalPaginas && (
              <>
                {paginasVisiveis[paginasVisiveis.length - 1] < totalPaginas - 1 && <span style={{ color: cores.texto, opacity: 0.5 }}>...</span>}
                <button className="paginacao-btn" onClick={() => irParaPagina(totalPaginas)} style={{ background: cores.card, color: cores.texto }}>{totalPaginas}</button>
              </>
            )}
            <button className="paginacao-btn" onClick={() => irParaPagina(paginaSegura + 1)} disabled={paginaSegura >= totalPaginas}
              style={{ background: tema === "escuro" ? "#374151" : "#e5e7eb", color: cores.texto, fontWeight: "bold", padding: "6px 12px" }}>
              Próximo
            </button>
          </div>
        )}
      </div>

      {/* AÇÕES */}
      <div className="acoes-tabela">
        <button className="btn-tema" onClick={exportarExcel}>
          <span className="material-symbols-outlined">download</span>
          Exportar Planilha
        </button>
      </div>
    </>
  );
}
