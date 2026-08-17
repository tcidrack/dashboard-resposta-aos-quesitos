import { useEffect, useState } from "react";
import "./App.css";
import Quesitos from "./tabs/Quesitos";

export default function App() {
  const [tema, setTema] = useState(() => localStorage.getItem("tema") || "claro");

  const cores = {
    claro: { fundo: "#0070FF", card: "#E5F0FF", texto: "#000" },
    escuro: { fundo: "#111827", card: "#1E293B", texto: "#fff" },
  };

  useEffect(() => {
    localStorage.setItem("tema", tema);
  }, [tema]);

  function trocarTema() {
    setTema(tema === "claro" ? "escuro" : "claro");
  }

  const coresAtivas = cores[tema];

  return (
    <div
      className={`container ${tema === "escuro" ? "tema-escuro" : "tema-claro"}`}
      style={{ backgroundColor: coresAtivas.fundo }}
    >
      {/* GOOGLE MATERIAL ICONS */}
      <link
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined"
        rel="stylesheet"
      />

      {/* HEADER */}
      <div className="header">
        <div className="logo-area">
          <img
            src="https://maida.health/wp-content/themes/melhortema/assets/images/logo-light.svg"
            alt="Logo Maida"
          />
          <h1>Dashboard de Respostas aos Quesitos · INAS/DF</h1>
        </div>

        <div className="acoes-header">
          <button className="btn-tema btn-tema-toggle" onClick={trocarTema}>
            <span className="material-symbols-outlined">
              {tema === "claro" ? "bedtime" : "brightness_7"}
            </span>
            {tema === "claro" ? "Escuro" : "Claro"}
          </button>
        </div>
      </div>

      {/* INTRODUÇÃO / CONTEXTO PARA APRESENTAÇÃO */}
      <div className="intro-banner" style={{ backgroundColor: coresAtivas.card, color: coresAtivas.texto }}>
        <h2>Como ler este painel</h2>
        <p>
          Este dashboard acompanha as <strong>respostas aos quesitos</strong> elaboradas para as
          demandas judiciais do INAS/DF. Cada linha é um documento emitido, identificado pelas{" "}
          <strong>guias</strong> analisadas. Os indicadores no topo resumem o período — volume,
          valor envolvido, situação de <strong>carência</strong> e enquadramento no{" "}
          <strong>rol do INAS</strong> e no <strong>Rol da ANS</strong>. Os gráficos mostram a
          evolução mensal e a distribuição das conclusões; a tabela detalha cada resposta. Use os
          filtros para recortar por natureza do atendimento, viabilidade administrativa, carência ou
          período — os dados são atualizados automaticamente a cada 2 minutos.
        </p>
        <p>
          <strong>Privacidade:</strong> o painel não exibe nenhum dado do beneficiário. Nome e
          carteirinha nunca são gravados, e idade e data de adesão ficam fora da view que alimenta
          esta tela.
        </p>
      </div>

      {/* CONTEÚDO — DASHBOARD DE RESPOSTAS AOS QUESITOS */}
      <Quesitos tema={tema} cores={coresAtivas} />

      {/* GLOSSÁRIO */}
      <div className="glossario" style={{ backgroundColor: coresAtivas.card, color: coresAtivas.texto }}>
        <h2>Glossário dos indicadores</h2>
        <dl>
          <div>
            <dt>Respostas emitidas</dt>
            <dd>Quantidade de documentos de resposta aos quesitos gerados no período filtrado.</dd>
          </div>
          <div>
            <dt>Valor total</dt>
            <dd>Soma dos itens das guias analisadas (valor unitário × quantidade).</dd>
          </div>
          <div>
            <dt>Valor médio por resposta</dt>
            <dd>Valor total dividido pelo número de respostas que têm valor informado.</dd>
          </div>
          <div>
            <dt>Itens analisados</dt>
            <dd>Total de procedimentos e materiais listados nas guias das respostas do período.</dd>
          </div>
          <div>
            <dt>Ainda em carência</dt>
            <dd>
              Participação das respostas em que o beneficiário seguia em carência, sobre as que
              informaram a situação de carência.
            </dd>
          </div>
          <div>
            <dt>No rol do INAS</dt>
            <dd>Percentual de respostas em que o procedimento consta do regulamento do INAS/DF.</dd>
          </div>
          <div>
            <dt>No Rol da ANS</dt>
            <dd>Percentual de respostas em que o procedimento consta do Rol da ANS.</dd>
          </div>
          <div>
            <dt>Autorizado</dt>
            <dd>Percentual de respostas cuja viabilidade administrativa ficou como "autorizado".</dd>
          </div>
          <div>
            <dt>Guias</dt>
            <dd>
              Números das guias que a resposta cobre, normalizados e ordenados. São a identificação
              do caso: regerar a resposta das mesmas guias atualiza o registro, sem duplicar.
            </dd>
          </div>
        </dl>
      </div>

      {/* RODAPÉ */}
      <footer className="rodape" style={{ color: "#fff" }}>
        maida.health · Painel de acompanhamento das respostas aos quesitos
      </footer>
    </div>
  );
}
