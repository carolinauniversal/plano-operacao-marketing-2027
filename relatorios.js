/* =============================================================================
   RELATÓRIOS — gestão e diretoria
   Lê os dados já carregados por index.html (projetos, gastos, realocacoes, tarefas,
   sessoes, usuarios) e busca as anotações das atividades sob demanda.

   Seções: Executivo · Financeiro · Atividades · Equipe e horas · Qualidade e fluxo
   Cada gráfico tem tabela equivalente ("Ver tabela") e exportação CSV.

   Convenções visuais (guia de data-viz):
   - cores de série em ordem fixa e presas à entidade (projeto/pessoa), nunca ao ranking
   - cores de status (bom/alerta/crítico) só quando a cor significa situação, sempre com rótulo
   - um eixo por gráfico; marcas finas; grade discreta; rótulos diretos só onde ajudam
============================================================================= */

const REL_COR = {
  serie: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  outros: '#b5b3ab',
  referencia: '#c3c2b7',
  bom: '#0ca30c', alerta: '#fab219', serio: '#ec835a', critico: '#d03b3b',
  seq: ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'],
  divPositivo: '#2a78d6', divNegativo: '#e34948',
  grade: '#e1e0d9', eixo: '#c3c2b7', mudo: '#898781', tinta: '#0b0b0b', tinta2: '#52514e', superficie: '#ffffff'
};
const REL_FONTE = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const relEstado = {
  montado: false,
  periodo: 'ano', inicioCustom: '', fimCustom: '',
  projeto: 'todos', pessoa: 'todos',
  anotacoes: null, anotacoesErro: null, carregandoAnotacoes: false,
  graficos: {}, tabelas: {}
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const relDia = 86400000;
const relNum = v => Number(v) || 0;
const relSoma = (lista, f) => lista.reduce((s, x) => s + relNum(f(x)), 0);
const relMedia = lista => lista.length ? lista.reduce((s, x) => s + x, 0) / lista.length : null;
const relPct = (a, b) => b ? (a / b) * 100 : null;
const relFmtPct = v => v == null ? '—' : `${(Math.round(v * 10) / 10).toLocaleString('pt-BR')}%`;
const relFmtInt = v => Math.round(v || 0).toLocaleString('pt-BR');
const relFmtDias = v => v == null ? '—' : `${(Math.round(v * 10) / 10).toLocaleString('pt-BR')} d`;
const relFmtMoeda = v => formatarMoeda(v);
function relFmtMoedaCurta(v) {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e6) return `${s}R$ ${(a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e3) return `${s}R$ ${(a / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `${s}R$ ${a.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}
const relCurto = (txt, n = 28) => (txt || '').length > n ? txt.slice(0, n - 1) + '…' : (txt || '');
const relChaveMes = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const RELMESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const relRotuloMes = chave => { const [a, m] = chave.split('-'); return `${RELMESES[Number(m) - 1]}/${a.slice(2)}`; };
const relInicioSemana = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const relData = v => v ? (String(v).length === 10 ? dataDeISO(v) : new Date(v)) : null;

function relIntervalo() {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const fimDoDia = d => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  let ini, fim = fimDoDia(hoje);
  switch (relEstado.periodo) {
    case 'mes': ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1); break;
    case 'trimestre': ini = new Date(hoje.getFullYear(), Math.floor(hoje.getMonth() / 3) * 3, 1); break;
    case 'ano': ini = new Date(hoje.getFullYear(), 0, 1); fim = fimDoDia(new Date(hoje.getFullYear(), 11, 31)); break;
    case '30': ini = new Date(hoje); ini.setDate(ini.getDate() - 29); break;
    case '90': ini = new Date(hoje); ini.setDate(ini.getDate() - 89); break;
    case 'personalizado':
      ini = relEstado.inicioCustom ? dataDeISO(relEstado.inicioCustom) : new Date(hoje.getFullYear(), 0, 1);
      fim = fimDoDia(relEstado.fimCustom ? dataDeISO(relEstado.fimCustom) : hoje);
      break;
    default: { // 'tudo': do primeiro ao último registro
      const datas = [
        ...gastos.map(g => relData(g.data)),
        ...tarefas.map(t => relData(t.criadoEm)),
        ...sessoes.map(s => relData(s.inicio))
      ].filter(Boolean);
      ini = datas.length ? new Date(Math.min(...datas)) : new Date(hoje.getFullYear(), 0, 1);
      ini.setHours(0, 0, 0, 0);
      const maxData = datas.length ? new Date(Math.max(...datas)) : hoje;
      fim = fimDoDia(maxData > hoje ? maxData : hoje);
    }
  }
  if (ini > fim) [ini, fim] = [fim, ini];
  return { ini, fim, hoje };
}

function relMesesEntre(ini, fim) {
  const out = [];
  const d = new Date(ini.getFullYear(), ini.getMonth(), 1);
  while (d <= fim && out.length < 240) { out.push(relChaveMes(d)); d.setMonth(d.getMonth() + 1); }
  return out;
}

// Baldes de tempo: semanas (até 16) ou meses
function relBaldes(ini, fim) {
  const limite = new Date(Math.min(fim, Date.now()));
  const semanas = Math.ceil((limite - relInicioSemana(ini)) / (7 * relDia));
  if (semanas <= 16) {
    const out = [];
    for (let d = relInicioSemana(ini); d <= limite; d = new Date(d.getTime() + 7 * relDia)) {
      const f = new Date(d.getTime() + 7 * relDia - 1);
      out.push({ ini: d, fim: f, rotulo: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, chave: dataLocalISO(d) });
    }
    return { tipo: 'semana', baldes: out };
  }
  return {
    tipo: 'mês',
    baldes: relMesesEntre(ini, limite).map(ch => {
      const [a, m] = ch.split('-').map(Number);
      return { ini: new Date(a, m - 1, 1), fim: new Date(a, m, 0, 23, 59, 59, 999), rotulo: relRotuloMes(ch), chave: ch };
    })
  };
}

// Cor estável por entidade (mesma cor em qualquer filtro)
function relCorProjeto(id) {
  const idx = [...projetos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).findIndex(p => p.id === id);
  return idx >= 0 && idx < 8 ? REL_COR.serie[idx] : REL_COR.outros;
}
function relCorPessoa(id) {
  // Só quem executa atividades ocupa uma cor (diretoria fica de fora)
  const idx = usuarios.filter(u => u.role !== 'diretoria').sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).findIndex(u => u.id === id);
  return idx >= 0 && idx < 8 ? REL_COR.serie[idx] : REL_COR.outros;
}
const relNomeProjeto = id => (projetos.find(p => p.id === id) || {}).nome || '—';
const relNomePessoa = id => nomeUsuario(id);

// Agrupa em top N + "Outros"
function relTopN(mapa, n = 10) {
  const ord = [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  const top = ord.slice(0, n);
  const resto = ord.slice(n).reduce((s, [, v]) => s + v, 0);
  if (resto > 0) top.push(['Outros', resto]);
  return top;
}

// Normaliza motivos livres para agrupar ("Aguardando fornecedor." == "aguardando fornecedor")
function relNormalizarMotivo(txt) {
  const limpo = String(txt || '').replace(/\s*\(registrado pela gestão[^)]*\)\s*$/i, '').trim().replace(/[.!\s]+$/, '');
  if (!limpo) return '(sem texto)';
  return limpo.charAt(0).toUpperCase() + limpo.slice(1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Chart.js: estilos e rótulos diretos
// ---------------------------------------------------------------------------
const relPluginRotulos = {
  id: 'relRotulos',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !opts.ativo) return;
    const { ctx } = chart;
    const horizontal = chart.options.indexAxis === 'y';
    ctx.save();
    ctx.font = `600 10px ${REL_FONTE}`;
    ctx.fillStyle = REL_COR.tinta2;
    ctx.textBaseline = 'middle';
    // Empilhados: rotula o total no fim da pilha
    if (opts.total) {
      const n = chart.data.labels.length;
      for (let j = 0; j < n; j++) {
        let total = 0, ultimo = null;
        chart.data.datasets.forEach((ds, i) => {
          const meta = chart.getDatasetMeta(i);
          if (meta.hidden || ds.data[j] == null) return;
          total += relNum(ds.data[j]);
          if (relNum(ds.data[j]) !== 0) ultimo = meta.data[j];
        });
        if (!ultimo || !total) continue;
        if (horizontal) { ctx.textAlign = 'left'; ctx.fillText(opts.formato(total), ultimo.x + 6, ultimo.y); }
        else { ctx.textAlign = 'center'; ctx.fillText(opts.formato(total), ultimo.x, ultimo.y - 9); }
      }
    } else {
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        if (meta.hidden) return;
        meta.data.forEach((el, j) => {
          const v = ds.data[j];
          if (v == null || v === 0) return;
          const txt = opts.formato(v, j);
          if (horizontal) {
            ctx.textAlign = v < 0 ? 'right' : 'left';
            ctx.fillText(txt, el.x + (v < 0 ? -6 : 6), el.y);
          } else {
            ctx.textAlign = 'center';
            ctx.fillText(txt, el.x, el.y + (v < 0 ? 10 : -9));
          }
        });
      });
    }
    ctx.restore();
  }
};
if (window.Chart) Chart.register(relPluginRotulos);

function relOpcoes({ horizontal = false, empilhado = false, eixo = v => v, valor = eixo, legenda = true, max = null, min = null, rotulos = null, paddingFim = 0 } = {}) {
  const valorEixo = {
    stacked: empilhado,
    beginAtZero: true,
    grid: { color: REL_COR.grade, drawTicks: false },
    border: { display: false },
    ticks: { color: REL_COR.mudo, font: { size: 10, family: REL_FONTE }, padding: 6, callback: v => eixo(v), maxTicksLimit: 6 }
  };
  if (max != null) valorEixo.max = max;
  if (min != null) valorEixo.min = min;
  const catEixo = {
    stacked: empilhado,
    grid: { display: false },
    border: { color: REL_COR.eixo },
    ticks: { color: REL_COR.tinta2, font: { size: 10, family: REL_FONTE }, autoSkip: !horizontal, maxRotation: 0 }
  };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 200 },
    indexAxis: horizontal ? 'y' : 'x',
    layout: { padding: horizontal ? { right: paddingFim || (rotulos ? 64 : 8) } : { top: rotulos ? 16 : 4 } },
    interaction: { mode: 'index', intersect: false, axis: horizontal ? 'y' : 'x' },
    plugins: {
      legend: {
        display: legenda,
        position: 'top', align: 'start',
        labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', color: REL_COR.tinta2, font: { size: 11, family: REL_FONTE }, padding: 12 }
      },
      tooltip: {
        backgroundColor: '#0b0b0b', padding: 8, cornerRadius: 6,
        titleFont: { size: 11, family: REL_FONTE }, bodyFont: { size: 11, family: REL_FONTE },
        filter: item => item.raw != null && item.raw !== 0,
        callbacks: { label: ctx => ` ${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${valor(horizontal ? ctx.parsed.x : ctx.parsed.y)}` }
      },
      relRotulos: rotulos ? { ativo: true, ...rotulos } : { ativo: false }
    },
    scales: horizontal ? { x: valorEixo, y: catEixo } : { x: catEixo, y: valorEixo }
  };
}

function relBarra(label, data, cor, extra = {}) {
  return { type: 'bar', label, data, backgroundColor: cor, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24, categoryPercentage: 0.72, barPercentage: 0.88, ...extra };
}
function relBarraEmpilhada(label, data, cor, extra = {}) {
  return { type: 'bar', label, data, backgroundColor: cor, borderColor: REL_COR.superficie, borderWidth: { top: 0, bottom: 0, left: 1, right: 1 }, borderRadius: 0, maxBarThickness: 26, categoryPercentage: 0.72, barPercentage: 0.9, ...extra };
}
function relLinha(label, data, cor, extra = {}) {
  // 'monotone' suaviza sem "passar" dos valores reais (contagens nunca ficam abaixo de zero)
  return { type: 'line', label, data, borderColor: cor, backgroundColor: cor, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 14, cubicInterpolationMode: 'monotone', ...extra };
}

// Altura proporcional ao número de barras horizontais
const relAlturaHorizontal = (n, min = 160) => Math.max(min, n * 26 + 70);

// ---------------------------------------------------------------------------
// Montagem da tela
// ---------------------------------------------------------------------------
function relCard(id, titulo, subtitulo, { altura = 260, largura = '', grafico = true } = {}) {
  return `
    <article id="rel-card-${id}" class="rel-card bg-white rounded-xl border border-neutral-200 p-4 flex flex-col min-w-0 ${largura}">
      <header class="mb-2">
        <h4 class="text-sm font-black text-neutral-900">${titulo}</h4>
        <p id="rel-sub-${id}" class="text-[11px] text-neutral-500">${subtitulo}</p>
      </header>
      ${grafico ? `
        <div id="rel-area-${id}" class="relative" style="height:${altura}px">
          <canvas id="rel-c-${id}" role="img" aria-label="${escaparHtml(titulo)}"></canvas>
          <p id="rel-vazio-${id}" class="hidden absolute inset-0 flex items-center justify-center text-xs text-neutral-400">Sem dados para o filtro selecionado.</p>
        </div>` : ''}
      <details class="rel-tabela mt-2" ${grafico ? '' : 'open'}>
        <summary class="cursor-pointer text-[11px] font-bold text-neutral-600 hover:text-red-600 select-none rel-nao-imprimir">${grafico ? 'Ver tabela' : 'Tabela'}</summary>
        <div id="rel-t-${id}" class="mt-2"></div>
      </details>
    </article>`;
}

function relSecao(id, titulo, descricao, cards, colunas = 'lg:grid-cols-2') {
  return `
    <section id="rel-sec-${id}" class="rel-secao space-y-3 scroll-mt-28">
      <div class="flex items-end justify-between gap-2 border-b-2 border-neutral-900 pb-1">
        <h3 class="text-base font-black uppercase tracking-wide text-neutral-900">${titulo}</h3>
        <p class="text-[11px] text-neutral-500 text-right">${descricao}</p>
      </div>
      <div class="grid grid-cols-1 ${colunas} gap-4">${cards}</div>
    </section>`;
}

function relMontar() {
  const raiz = document.getElementById('gestor-secao-relatorios');
  const sel = 'border border-neutral-300 rounded p-1.5 text-xs font-medium outline-none focus:ring-1 focus:ring-red-600 bg-white';
  raiz.innerHTML = `
    <div class="glass-card rounded-xl border border-neutral-200 p-4 space-y-3">
      <div class="flex flex-wrap justify-between items-start gap-3">
        <div>
          <h2 class="text-lg font-black text-neutral-900">Relatórios Gerenciais</h2>
          <p id="rel-resumo-filtro" class="text-xs text-neutral-500"></p>
        </div>
        <div class="flex flex-wrap gap-2 rel-nao-imprimir">
          <button type="button" onclick="relAtualizarDados()" class="px-3 py-1.5 border border-neutral-300 rounded text-xs font-bold hover:bg-neutral-100">↻ Atualizar dados</button>
          <button type="button" onclick="window.print()" class="px-3 py-1.5 bg-black hover:bg-neutral-800 text-white rounded text-xs font-bold">🖨 Imprimir / PDF</button>
        </div>
      </div>
      <!-- Uma única linha de filtros vale para todos os relatórios -->
      <div class="flex flex-wrap items-end gap-3 rel-nao-imprimir">
        <label class="text-[11px] font-bold uppercase text-neutral-600">Período<br>
          <select id="rel-f-periodo" class="${sel} mt-1" onchange="relAoFiltrar()">
            <option value="mes">Mês atual</option>
            <option value="trimestre">Trimestre atual</option>
            <option value="ano" selected>Ano atual</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="tudo">Todo o histórico</option>
            <option value="personalizado">Personalizado…</option>
          </select>
        </label>
        <span id="rel-f-custom" class="hidden flex items-end gap-2">
          <label class="text-[11px] font-bold uppercase text-neutral-600">De<br><input type="date" id="rel-f-ini" class="${sel} mt-1" onchange="relAoFiltrar()"></label>
          <label class="text-[11px] font-bold uppercase text-neutral-600">Até<br><input type="date" id="rel-f-fim" class="${sel} mt-1" onchange="relAoFiltrar()"></label>
        </span>
        <label class="text-[11px] font-bold uppercase text-neutral-600">Projeto<br>
          <select id="rel-f-projeto" class="${sel} mt-1" onchange="relAoFiltrar()"></select>
        </label>
        <label class="text-[11px] font-bold uppercase text-neutral-600">Pessoa<br>
          <select id="rel-f-pessoa" class="${sel} mt-1" onchange="relAoFiltrar()"></select>
        </label>
        <p class="text-[10px] text-neutral-400 max-w-xs">O filtro de pessoa vale para atividades, horas e qualidade. Os números financeiros consideram período e projeto.</p>
      </div>
      <nav class="flex flex-wrap gap-1.5 pt-2 border-t border-neutral-100 rel-nao-imprimir" aria-label="Seções do relatório">
        ${[['executivo', 'Visão executiva'], ['kpis', 'KPIs dos projetos'], ['financeiro', 'Financeiro'], ['atividades', 'Atividades e prazos'], ['equipe', 'Equipe e horas'], ['qualidade', 'Qualidade e fluxo']]
          .map(([id, r]) => `<button type="button" onclick="document.getElementById('rel-sec-${id}').scrollIntoView({behavior:'smooth'})" class="px-2.5 py-1 rounded-full bg-neutral-100 hover:bg-neutral-200 text-[11px] font-bold text-neutral-700">${r}</button>`).join('')}
      </nav>
    </div>

    <section id="rel-sec-executivo" class="rel-secao space-y-3 scroll-mt-28">
      <div class="flex items-end justify-between gap-2 border-b-2 border-neutral-900 pb-1">
        <h3 class="text-base font-black uppercase tracking-wide text-neutral-900">Visão executiva</h3>
        <p class="text-[11px] text-neutral-500">Os números-chave do período, num só lugar.</p>
      </div>
      <div id="rel-kpis" class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3"></div>
      <div id="rel-destaques" class="grid grid-cols-1 md:grid-cols-3 gap-3"></div>
    </section>

    ${relSecao('kpis', 'KPIs dos projetos', 'Como cada projeto está em relação às próprias metas.',
      relCard('k-saude', 'Situação dos KPIs por projeto', 'Quantos KPIs de cada projeto estão na meta, perto dela ou abaixo (última aferição até o fim do período).', { altura: 240 }) +
      relCard('k-pontualidade', 'Disciplina de aferição', '% dos períodos encerrados que têm valor registrado, e quanto foi registrado em dia (até 7 dias após o fim do período).', { altura: 240 }) +
      relCard('k-scorecard', 'Painel de KPIs', 'Meta, valor apurado, atingimento, tendência e pendências de cada KPI.', { grafico: false, largura: 'lg:col-span-2' }) +
      `<article id="rel-card-k-evolucao" class="rel-card bg-white rounded-xl border border-neutral-200 p-4 flex flex-col min-w-0 lg:col-span-2">
        <header class="mb-2"><h4 class="text-sm font-black text-neutral-900">Evolução de cada KPI</h4>
          <p class="text-[11px] text-neutral-500">Valor apurado em cada período × meta (cada KPI na própria unidade). Metas acumuladas mostram o total acumulado.</p></header>
        <div id="rel-kpi-minis" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"></div>
        <details class="rel-tabela mt-2"><summary class="cursor-pointer text-[11px] font-bold text-neutral-600 hover:text-red-600 select-none rel-nao-imprimir">Ver tabela</summary><div id="rel-t-k-evolucao" class="mt-2"></div></details>
      </article>` +
      relCard('k-afericoes', 'Aferições registradas no período', 'Histórico completo, com observações e quem registrou.', { grafico: false, largura: 'lg:col-span-2' })
    )}

    ${relSecao('financeiro', 'Financeiro', 'Orçamento, gastos, fornecedores e realocações.',
      relCard('f-mensal', 'Gastos por mês', 'Quanto foi lançado em cada mês do período.') +
      relCard('f-acumulado', 'Realizado acumulado × orçamento', 'Ritmo de consumo do orçamento ao longo do período.') +
      relCard('f-projetos', 'Orçado × realizado por projeto', 'Acumulado de todos os lançamentos, comparado ao orçamento de cada projeto.', { altura: 280 }) +
      relCard('f-pilares', 'Execução do orçamento por pilar', 'Percentual do orçamento de cada pilar já consumido (acumulado).', { altura: 300 }) +
      relCard('f-tipos', 'Gastos por tipo de despesa', 'As categorias que mais consomem no período (10 maiores + Outros).', { altura: 300 }) +
      relCard('f-fornecedores', 'Gastos por fornecedor', 'Os fornecedores com maior volume no período.', { altura: 300 }) +
      relCard('f-pagamento', 'Gastos por forma de pagamento', 'Como os pagamentos do período foram feitos.', { altura: 200 }) +
      relCard('f-projeto-mes', 'Gastos por projeto ao longo do tempo', 'Composição mensal dos gastos entre os projetos.') +
      relCard('f-realocacoes', 'Realocações de orçamento por pilar', 'Valores recebidos (+) e cedidos (−) por pilar no período.', { altura: 260, largura: 'lg:col-span-2' }) +
      relCard('f-lancamentos', 'Lançamentos do período', 'Todos os lançamentos, para conferência e auditoria.', { grafico: false, largura: 'lg:col-span-2' })
    )}

    ${relSecao('atividades', 'Atividades e prazos', 'Andamento, fluxo de entregas, prazos e estimativas.',
      relCard('a-status', 'Situação atual por projeto', 'Quantidade de atividades em cada etapa, hoje.', { altura: 260 }) +
      relCard('a-fluxo', 'Atividades criadas × concluídas', 'Entrada e saída de trabalho ao longo do período.') +
      relCard('a-prazo', 'Entregas no prazo × fora do prazo', 'Atividades concluídas em cada mês, pelo cumprimento do prazo.') +
      relCard('a-prioridade', 'Atividades por prioridade', 'Abertas, atrasadas e concluídas no período em cada prioridade.') +
      relCard('a-aging', 'Tempo das atividades em aberto', 'Há quantos dias as atividades abertas foram criadas.') +
      relCard('a-ciclo', 'Tempo médio de entrega por projeto', 'Dias da criação à conclusão (lead time) e do início à conclusão (ciclo), nas concluídas do período.', { altura: 260 }) +
      relCard('a-estimativa', 'Horas estimadas × trabalhadas por projeto', 'Quanto do tempo previsto já foi consumido em cada projeto.', { altura: 260 }) +
      relCard('a-desvio', 'Desvio de estimativa nas atividades concluídas', 'Horas trabalhadas acima (+) ou abaixo (−) do estimado, em % (maiores desvios do período).', { altura: 320 }) +
      relCard('a-atrasadas', 'Carga e atrasos por responsável', 'Atividades em aberto e quantas estão com prazo vencido, por pessoa.', { altura: 240, largura: 'lg:col-span-2' })
    )}

    ${relSecao('equipe', 'Equipe e horas', 'Horas trabalhadas (pelas sessões), capacidade e desempenho individual.',
      relCard('e-semanal', 'Horas trabalhadas por pessoa', 'Horas registradas pelas sessões de trabalho em cada intervalo.', { largura: 'lg:col-span-2' }) +
      relCard('e-mapa', 'Mapa de horas: pessoa × projeto', 'Onde cada pessoa investiu as horas no período (quanto mais escuro, mais horas).', { grafico: false, largura: 'lg:col-span-2' }) +
      relCard('e-utilizacao', 'Uso da capacidade', 'Horas trabalhadas ÷ capacidade (8h por dia útil decorrido no período).', { altura: 240 }) +
      relCard('e-diasemana', 'Horas por dia da semana', 'Em que dias a equipe mais trabalha nas atividades.', { altura: 240 }) +
      relCard('e-horadia', 'Horas por horário do dia', 'Distribuição das horas trabalhadas ao longo do dia.', { altura: 240, largura: 'lg:col-span-2' }) +
      relCard('e-desempenho', 'Quadro de desempenho por pessoa', 'Visão consolidada de carga, entregas, prazos, horas e qualidade.', { grafico: false, largura: 'lg:col-span-2' })
    )}

    ${relSecao('qualidade', 'Qualidade e fluxo', 'Pausas, devoluções, aprovações e transferências (a partir do histórico das atividades).',
      relCard('q-eventos', 'Pausas, devoluções e transferências por mês', 'Eventos registrados no histórico das atividades.') +
      relCard('q-aprovacao', 'Aprovação na primeira tentativa', '% das atividades enviadas para aprovação que não foram devolvidas, por responsável.', { altura: 240 }) +
      relCard('q-pausas', 'Principais motivos de pausa', 'Motivos informados ao pausar (agrupados pelo texto).', { altura: 300 }) +
      relCard('q-semnova', 'Motivos para não iniciar outra atividade', 'Justificativas informadas ao pausar sem iniciar outra atividade.', { altura: 300 }) +
      relCard('q-espera', 'Tempo médio aguardando aprovação', 'Horas entre o envio para aprovação e a decisão da gestão, por projeto.', { altura: 240 }) +
      relCard('q-devolucoes', 'Motivos de devolução', 'O que a gestão pediu para ajustar.', { grafico: false }) +
      relCard('q-transferencias', 'Transferências de responsável', 'Histórico de transferências com o motivo informado.', { grafico: false, largura: 'lg:col-span-2' })
    )}
    <p class="text-[10px] text-neutral-400 pb-4">Horas trabalhadas vêm das sessões (iniciar → pausar/concluir) e contam para quem executou, inclusive antes de transferências. Situações "atuais" (status, atrasos, aging) refletem o dia de hoje; os demais números respeitam o período escolhido.</p>
  `;
  relEstado.montado = true;
}

function relPreencherFiltros() {
  const selProj = document.getElementById('rel-f-projeto');
  const selPessoa = document.getElementById('rel-f-pessoa');
  selProj.innerHTML = '<option value="todos">Todos os projetos</option>' +
    [...projetos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(p => `<option value="${p.id}">${escaparHtml(p.nome)}</option>`).join('');
  const comAtividade = new Set([...tarefas.map(t => t.colaboradorId), ...sessoes.map(s => s.colaboradorId)]);
  selPessoa.innerHTML = '<option value="todos">Toda a equipe</option>' +
    usuarios.filter(u => comAtividade.has(u.id) || u.role === 'colaborador')
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map(u => `<option value="${u.id}">${escaparHtml(u.nome)}${u.status !== 'ativo' ? ' (bloqueado)' : ''}</option>`).join('');
  selProj.value = [...selProj.options].some(o => o.value === relEstado.projeto) ? relEstado.projeto : 'todos';
  selPessoa.value = [...selPessoa.options].some(o => o.value === relEstado.pessoa) ? relEstado.pessoa : 'todos';
  document.getElementById('rel-f-periodo').value = relEstado.periodo;
  document.getElementById('rel-f-custom').classList.toggle('hidden', relEstado.periodo !== 'personalizado');
}

// ---------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------
async function relAbrir() {
  if (!relEstado.montado) relMontar();
  relPreencherFiltros();
  relRenderizar();
  if (!relEstado.anotacoes && !relEstado.carregandoAnotacoes) await relCarregarAnotacoes();
}

function relAoFiltrar() {
  relEstado.periodo = document.getElementById('rel-f-periodo').value;
  relEstado.projeto = document.getElementById('rel-f-projeto').value;
  relEstado.pessoa = document.getElementById('rel-f-pessoa').value;
  relEstado.inicioCustom = document.getElementById('rel-f-ini').value;
  relEstado.fimCustom = document.getElementById('rel-f-fim').value;
  document.getElementById('rel-f-custom').classList.toggle('hidden', relEstado.periodo !== 'personalizado');
  relRenderizar();
}

async function relAtualizarDados() {
  relEstado.anotacoes = null;
  await recarregarDados(); // chama relRenderizar via atualizarTodaAplicacao
  await relCarregarAnotacoes();
  notificar('Relatórios atualizados.');
}

async function relCarregarAnotacoes() {
  relEstado.carregandoAnotacoes = true;
  const { data, error } = await clienteSupabase
    .from('tarefa_anotacoes')
    .select('tarefa_id,autor_id,autor_nome,tipo,texto,criado_em')
    .order('criado_em', { ascending: true });
  relEstado.carregandoAnotacoes = false;
  relEstado.anotacoes = error ? [] : (data || []);
  relEstado.anotacoesErro = error ? mensagemErro(error) : null;
  if (!document.getElementById('gestor-secao-relatorios').classList.contains('hidden')) relRenderizar();
}

// ---------------------------------------------------------------------------
// Recorte dos dados conforme os filtros
// ---------------------------------------------------------------------------
function relDados() {
  const { ini, fim, hoje } = relIntervalo();
  const dentro = d => d && d >= ini && d <= fim;
  const proj = relEstado.projeto, pessoa = relEstado.pessoa;
  const projetosSel = proj === 'todos' ? projetos : projetos.filter(p => p.id === proj);
  const idsProj = new Set(projetosSel.map(p => p.id));
  const tarefaPorId = new Map(tarefas.map(t => [t.id, t]));

  const gastosProj = gastos.filter(g => idsProj.has(g.projetoId));
  const gastosPer = gastosProj.filter(g => dentro(relData(g.data)));

  const tarefasProj = tarefas.filter(t => idsProj.has(t.projetoId));
  const tarefasSel = pessoa === 'todos' ? tarefasProj : tarefasProj.filter(t => t.colaboradorId === pessoa);

  const sessoesSel = (sessoesDisponiveis ? sessoes : []).filter(s => {
    const t = tarefaPorId.get(s.tarefaId);
    if (!t || !idsProj.has(t.projetoId)) return false;
    if (pessoa !== 'todos' && s.colaboradorId !== pessoa) return false;
    return duracaoSessaoHoras(s, ini, fim) > 0;
  });
  const horasSessao = s => duracaoSessaoHoras(s, ini, fim);

  const realocSel = realocacoes.filter(r =>
    dentro(relData(r.criadoEm)) && (proj === 'todos' || r.origemProjetoId === proj || r.destinoProjetoId === proj));

  const anot = (relEstado.anotacoes || []).filter(a => {
    const t = tarefaPorId.get(a.tarefa_id);
    if (!t || !idsProj.has(t.projetoId)) return false;
    if (pessoa !== 'todos' && a.autor_id !== pessoa && t.colaboradorId !== pessoa) return false;
    return true;
  });
  const anotPer = anot.filter(a => dentro(relData(a.criado_em)));

  const concluidasPer = tarefasSel.filter(t => t.status === 'Concluído' && dentro(relData(t.concluidoEm)));
  const abertas = tarefasSel.filter(t => t.status !== 'Concluído');
  const hojeISO = dataLocalISO(hoje);
  const atrasadas = abertas.filter(t => t.prazo < hojeISO);

  return { ini, fim, hoje, hojeISO, dentro, projetosSel, idsProj, tarefaPorId, gastosProj, gastosPer, tarefasProj, tarefasSel,
    sessoesSel, horasSessao, realocSel, anot, anotPer, concluidasPer, abertas, atrasadas };
}

// ---------------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------------
function relGrafico(id, config, vazio = false) {
  if (relEstado.graficos[id]) { relEstado.graficos[id].destroy(); delete relEstado.graficos[id]; }
  const canvas = document.getElementById(`rel-c-${id}`);
  const aviso = document.getElementById(`rel-vazio-${id}`);
  if (!canvas) return;
  canvas.classList.toggle('hidden', vazio);
  aviso.classList.toggle('hidden', !vazio);
  if (vazio) return;
  relEstado.graficos[id] = new Chart(canvas.getContext('2d'), config);
}

function relAltura(id, px) {
  const area = document.getElementById(`rel-area-${id}`);
  if (area) area.style.height = `${px}px`;
}

function relSubtitulo(id, texto) {
  const el = document.getElementById(`rel-sub-${id}`);
  if (el) el.textContent = texto;
}

// Células podem ser texto ou { t: texto exibido, v: valor bruto (CSV), cls, estilo }
function relTabela(id, colunas, linhas, { rodape = null, vazio = 'Sem dados para o filtro selecionado.' } = {}) {
  relEstado.tabelas[id] = { colunas, linhas: rodape ? [...linhas, rodape] : linhas };
  const alvo = document.getElementById(`rel-t-${id}`);
  if (!alvo) return;
  if (!linhas.length) { alvo.innerHTML = `<p class="text-xs text-neutral-400 py-2">${vazio}</p>`; return; }
  const cel = (c, tag, i) => {
    const o = c && typeof c === 'object' ? c : { t: c };
    const alinhar = colunas[i].direita ? 'text-right' : '';
    return `<${tag} class="px-2 py-1.5 ${alinhar} ${o.cls || ''}" ${o.estilo ? `style="${o.estilo}"` : ''}>${o.html != null ? o.html : escaparHtml(o.t == null ? '' : o.t)}</${tag}>`;
  };
  alvo.innerHTML = `
    <div class="overflow-auto max-h-80 custom-scrollbar border border-neutral-200 rounded">
      <table class="w-full text-left text-[11px] text-neutral-700">
        <thead class="bg-neutral-100 text-[10px] uppercase text-neutral-600 sticky top-0">
          <tr>${colunas.map((c, i) => `<th class="px-2 py-1.5 font-bold ${c.direita ? 'text-right' : ''} whitespace-nowrap">${c.rotulo}</th>`).join('')}</tr>
        </thead>
        <tbody class="divide-y divide-neutral-100">${linhas.map(l => `<tr class="hover:bg-neutral-50">${l.map((c, i) => cel(c, 'td', i)).join('')}</tr>`).join('')}</tbody>
        ${rodape ? `<tfoot class="bg-neutral-50 font-bold border-t-2 border-neutral-300"><tr>${rodape.map((c, i) => cel(c, 'td', i)).join('')}</tr></tfoot>` : ''}
      </table>
    </div>
    <div class="flex justify-between items-center mt-1.5 rel-nao-imprimir">
      <span class="text-[10px] text-neutral-400">${linhas.length} linha(s)</span>
      <button type="button" onclick="relExportarCSV('${id}')" class="text-[11px] font-bold text-red-600 hover:underline">⤓ Exportar CSV</button>
    </div>`;
}

function relExportarCSV(id) {
  const tb = relEstado.tabelas[id];
  if (!tb) return;
  const bruto = c => (c && typeof c === 'object') ? (c.v !== undefined ? c.v : c.t) : c;
  const esc = v => {
    const x = typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : String(v == null ? '' : v);
    return /[;"\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
  };
  const linhas = [tb.colunas.map(c => esc(c.rotulo)).join(';'), ...tb.linhas.map(l => l.map(c => esc(bruto(c))).join(';'))];
  const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `relatorio-${id}-${dataLocalISO()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function relRenderizar() {
  if (!relEstado.montado) return;
  const D = relDados();
  const projTxt = relEstado.projeto === 'todos' ? 'todos os projetos' : relNomeProjeto(relEstado.projeto);
  const pessoaTxt = relEstado.pessoa === 'todos' ? 'toda a equipe' : relNomePessoa(relEstado.pessoa);
  document.getElementById('rel-resumo-filtro').textContent =
    `Período: ${D.ini.toLocaleDateString('pt-BR')} a ${D.fim.toLocaleDateString('pt-BR')} · ${projTxt} · ${pessoaTxt} · gerado em ${new Date().toLocaleString('pt-BR')}`;
  const etapas = [relExecutivo, relKpis, relFinanceiro, relAtividades, relEquipe, relQualidade];
  etapas.forEach(f => { try { f(D); } catch (e) { console.error('Relatório:', f.name, e); } });
}

// ---------------------------------------------------------------------------
// 1. Visão executiva
// ---------------------------------------------------------------------------
function relExecutivo(D) {
  const pilares = D.projetosSel.flatMap(p => p.pilares);
  const orcado = relSoma(pilares, p => p.orcado);
  const realizadoAcum = relSoma(D.gastosProj, g => g.valor);
  const realizadoPer = relSoma(D.gastosPer, g => g.valor);
  const execucao = relPct(realizadoAcum, orcado);
  const deficit = relSoma(pilares, p => Math.max(0, gastoDoPilar(p.id) - p.orcado));
  const estourados = pilares.filter(p => gastoDoPilar(p.id) > p.orcado).length;
  const noPrazo = D.concluidasPer.filter(t => t.slaCumprido !== false).length;
  const horas = relSoma(D.sessoesSel, D.horasSessao);
  const leads = D.concluidasPer.filter(t => t.criadoEm && t.concluidoEm).map(t => (relData(t.concluidoEm) - relData(t.criadoEm)) / relDia);
  const q = relIndicadoresQualidade(D);

  const tile = (rotulo, valor, detalhe, status = null) => `
    <div class="bg-white rounded-xl border border-neutral-200 p-3">
      <p class="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">${rotulo}</p>
      <p class="text-xl font-black text-neutral-900 leading-tight mt-1">${valor}</p>
      <p class="text-[10px] text-neutral-500 mt-0.5">${detalhe}</p>
      ${status ? `<p class="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-neutral-800"><span class="w-2 h-2 rounded-full" style="background:${status.cor}"></span>${status.icone} ${status.texto}</p>` : ''}
    </div>`;
  const stExec = execucao == null ? null : execucao > 100
    ? { cor: REL_COR.critico, icone: '▲', texto: 'Acima do orçamento' }
    : execucao >= 85 ? { cor: REL_COR.alerta, icone: '●', texto: 'Perto do limite' } : { cor: REL_COR.bom, icone: '✓', texto: 'Dentro do orçamento' };
  const pctPrazo = relPct(noPrazo, D.concluidasPer.length);

  document.getElementById('rel-kpis').innerHTML = [
    tile('Orçamento', relFmtMoedaCurta(orcado), `${pilares.length} pilar(es) em ${D.projetosSel.length} projeto(s)`),
    tile('Realizado no período', relFmtMoedaCurta(realizadoPer), `${relFmtInt(D.gastosPer.length)} lançamento(s)`),
    tile('Execução acumulada', relFmtPct(execucao), `${relFmtMoedaCurta(realizadoAcum)} de ${relFmtMoedaCurta(orcado)}`, stExec),
    tile('Saldo disponível', relFmtMoedaCurta(orcado - realizadoAcum), deficit > 0 ? `Déficit de ${relFmtMoedaCurta(deficit)} em ${estourados} pilar(es)` : 'Nenhum pilar estourado',
      deficit > 0 ? { cor: REL_COR.critico, icone: '▲', texto: `${estourados} pilar(es) estourado(s)` } : null),
    tile('Realocado no período', relFmtMoedaCurta(relSoma(D.realocSel, r => r.valor)), `${D.realocSel.length} transferência(s) de orçamento`),
    tile('Ticket médio', D.gastosPer.length ? relFmtMoedaCurta(realizadoPer / D.gastosPer.length) : '—', 'valor médio por lançamento'),
    tile('Atividades concluídas', relFmtInt(D.concluidasPer.length), 'no período'),
    tile('Entregas no prazo', relFmtPct(pctPrazo), `${noPrazo} de ${D.concluidasPer.length} concluídas`,
      pctPrazo == null ? null : pctPrazo >= 90 ? { cor: REL_COR.bom, icone: '✓', texto: 'Bom' } : pctPrazo >= 70 ? { cor: REL_COR.alerta, icone: '●', texto: 'Atenção' } : { cor: REL_COR.critico, icone: '▲', texto: 'Crítico' }),
    tile('Em aberto hoje', relFmtInt(D.abertas.length), `${D.atrasadas.length} atrasada(s)`,
      D.atrasadas.length ? { cor: REL_COR.critico, icone: '▲', texto: `${D.atrasadas.length} com prazo vencido` } : null),
    tile('Horas trabalhadas', fmtHoras(horas), 'registradas pelas sessões no período'),
    tile('Lead time médio', relFmtDias(relMedia(leads)), 'da criação à conclusão'),
    tile('Aprovação na 1ª tentativa', q.carregado ? relFmtPct(q.pctPrimeira) : '…', q.carregado ? `${q.devolucoes} devolução(ões) no período` : 'carregando histórico'),
    ...relTileKpis(D, tile)
  ].join('');

  // Destaques automáticos (frases)
  const destaques = [];
  const porTipo = new Map(); D.gastosPer.forEach(g => porTipo.set(g.tipo || '—', (porTipo.get(g.tipo || '—') || 0) + g.valor));
  const topTipo = relTopN(porTipo, 1)[0];
  if (topTipo && topTipo[0] !== 'Outros') destaques.push(['Maior categoria de gasto', `${topTipo[0]}: ${relFmtMoeda(topTipo[1])} (${relFmtPct(relPct(topTipo[1], realizadoPer))} do período)`]);
  const piorPilar = pilares.map(p => ({ p, pct: relPct(gastoDoPilar(p.id), p.orcado) })).filter(x => x.pct != null).sort((a, b) => b.pct - a.pct)[0];
  if (piorPilar) destaques.push(['Pilar mais consumido', `${relNomeProjeto(projetos.find(pr => pr.pilares.includes(piorPilar.p))?.id)} · ${piorPilar.p.nome}: ${relFmtPct(piorPilar.pct)} do orçamento`]);
  const porPessoaAtraso = new Map(); D.atrasadas.forEach(t => porPessoaAtraso.set(t.colaboradorId, (porPessoaAtraso.get(t.colaboradorId) || 0) + 1));
  const maisAtrasos = [...porPessoaAtraso.entries()].sort((a, b) => b[1] - a[1])[0];
  destaques.push(['Atrasos', maisAtrasos ? `${relNomePessoa(maisAtrasos[0])} concentra ${maisAtrasos[1]} de ${D.atrasadas.length} atividade(s) atrasada(s)` : 'Nenhuma atividade atrasada hoje']);
  document.getElementById('rel-destaques').innerHTML = destaques.map(([t, v]) => `
    <div class="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <p class="text-[10px] uppercase font-bold text-neutral-500">${t}</p>
      <p class="text-xs font-semibold text-neutral-900 mt-0.5">${escaparHtml(v)}</p>
    </div>`).join('');
}

// ---------------------------------------------------------------------------
// 2. Financeiro
// ---------------------------------------------------------------------------
function relFinanceiro(D) {
  const meses = relMesesEntre(D.ini, D.fim);
  const porMes = new Map(meses.map(m => [m, 0]));
  D.gastosPer.forEach(g => { const k = relChaveMes(relData(g.data)); if (porMes.has(k)) porMes.set(k, porMes.get(k) + g.valor); });
  const valoresMes = meses.map(m => porMes.get(m));
  const totalPer = relSoma(D.gastosPer, g => g.valor);

  // f-mensal
  relGrafico('f-mensal', {
    data: { labels: meses.map(relRotuloMes), datasets: [relBarra('Gastos', valoresMes, REL_COR.serie[0])] },
    options: relOpcoes({ eixo: relFmtMoedaCurta, valor: relFmtMoeda, legenda: false })
  }, totalPer === 0);
  relTabela('f-mensal', [{ rotulo: 'Mês' }, { rotulo: 'Gastos', direita: true }, { rotulo: '% do período', direita: true }, { rotulo: 'Lançamentos', direita: true }],
    meses.map(m => [relRotuloMes(m), { t: relFmtMoeda(porMes.get(m)), v: porMes.get(m) }, relFmtPct(relPct(porMes.get(m), totalPer)),
      D.gastosPer.filter(g => relChaveMes(relData(g.data)) === m).length]),
    { rodape: ['Total', { t: relFmtMoeda(totalPer), v: totalPer }, '100%', D.gastosPer.length] });

  // f-acumulado
  const orcado = relSoma(D.projetosSel.flatMap(p => p.pilares), p => p.orcado);
  const antes = relSoma(D.gastosProj.filter(g => relData(g.data) < D.ini), g => g.valor);
  let acc = antes;
  const acumulado = valoresMes.map(v => (acc += v));
  relGrafico('f-acumulado', {
    data: {
      labels: meses.map(relRotuloMes),
      datasets: [
        relLinha('Realizado acumulado', acumulado, REL_COR.serie[0], { fill: { target: 'origin', above: 'rgba(42,120,214,0.08)' } }),
        relLinha('Orçamento total', meses.map(() => orcado), REL_COR.mudo, { borderDash: [5, 4], borderWidth: 1.5, tension: 0 })
      ]
    },
    options: relOpcoes({ eixo: relFmtMoedaCurta, valor: relFmtMoeda })
  }, meses.length === 0 || (orcado === 0 && acc === 0));
  relTabela('f-acumulado', [{ rotulo: 'Mês' }, { rotulo: 'Realizado acumulado', direita: true }, { rotulo: 'Orçamento', direita: true }, { rotulo: '% consumido', direita: true }],
    meses.map((m, i) => [relRotuloMes(m), { t: relFmtMoeda(acumulado[i]), v: acumulado[i] }, { t: relFmtMoeda(orcado), v: orcado }, relFmtPct(relPct(acumulado[i], orcado))]));

  // f-projetos
  const linhasProj = D.projetosSel.map(p => {
    const orc = relSoma(p.pilares, x => x.orcado);
    const acum = relSoma(gastos.filter(g => g.projetoId === p.id), g => g.valor);
    const per = relSoma(D.gastosPer.filter(g => g.projetoId === p.id), g => g.valor);
    return { p, orc, acum, per };
  }).sort((a, b) => b.orc - a.orc);
  relAltura('f-projetos', relAlturaHorizontal(linhasProj.length * 1.6));
  relGrafico('f-projetos', {
    data: {
      labels: linhasProj.map(x => relCurto(x.p.nome, 26)),
      datasets: [relBarra('Orçado', linhasProj.map(x => x.orc), REL_COR.referencia), relBarra('Realizado', linhasProj.map(x => x.acum), REL_COR.serie[0])]
    },
    options: relOpcoes({ horizontal: true, eixo: relFmtMoedaCurta, valor: relFmtMoeda })
  }, linhasProj.length === 0);
  relTabela('f-projetos', [{ rotulo: 'Projeto' }, { rotulo: 'Orçado', direita: true }, { rotulo: 'Realizado (acum.)', direita: true }, { rotulo: 'Realizado no período', direita: true }, { rotulo: 'Saldo', direita: true }, { rotulo: '% executado', direita: true }],
    linhasProj.map(x => [x.p.nome, { t: relFmtMoeda(x.orc), v: x.orc }, { t: relFmtMoeda(x.acum), v: x.acum }, { t: relFmtMoeda(x.per), v: x.per },
      { t: relFmtMoeda(x.orc - x.acum), v: x.orc - x.acum, cls: x.acum > x.orc ? 'text-red-700 font-bold' : '' }, relFmtPct(relPct(x.acum, x.orc))]),
    { rodape: ['Total', ...[relSoma(linhasProj, x => x.orc), relSoma(linhasProj, x => x.acum), relSoma(linhasProj, x => x.per)].map(v => ({ t: relFmtMoeda(v), v })),
      { t: relFmtMoeda(relSoma(linhasProj, x => x.orc - x.acum)), v: relSoma(linhasProj, x => x.orc - x.acum) }, relFmtPct(relPct(relSoma(linhasProj, x => x.acum), relSoma(linhasProj, x => x.orc)))] });

  // f-pilares (status por faixa de consumo)
  const pil = D.projetosSel.flatMap(p => p.pilares.map(x => {
    const g = gastoDoPilar(x.id);
    return { proj: p.nome, nome: x.nome, orc: x.orcado, gasto: g, pct: x.orcado > 0 ? (g / x.orcado) * 100 : (g > 0 ? 100 : 0) };
  })).sort((a, b) => b.pct - a.pct);
  const faixa = (min, max) => pil.map(x => (x.pct > min && x.pct <= max) || (min === -1 && x.pct <= max) ? Math.round(x.pct * 10) / 10 : null);
  relAltura('f-pilares', relAlturaHorizontal(pil.length));
  relGrafico('f-pilares', {
    data: {
      labels: pil.map(x => relCurto(`${x.proj} · ${x.nome}`, 34)),
      datasets: [
        relBarraEmpilhada('Até 85%', faixa(-1, 85), REL_COR.bom, { borderRadius: 4 }),
        relBarraEmpilhada('85% a 100%', faixa(85, 100), REL_COR.alerta, { borderRadius: 4 }),
        relBarraEmpilhada('Acima de 100%', faixa(100, Infinity), REL_COR.critico, { borderRadius: 4 })
      ]
    },
    options: relOpcoes({ horizontal: true, empilhado: true, eixo: v => `${v}%`, valor: v => relFmtPct(v), rotulos: { formato: v => relFmtPct(v) } })
  }, pil.length === 0);
  relTabela('f-pilares', [{ rotulo: 'Projeto' }, { rotulo: 'Pilar' }, { rotulo: 'Orçado', direita: true }, { rotulo: 'Gasto', direita: true }, { rotulo: 'Saldo', direita: true }, { rotulo: '% consumido', direita: true }, { rotulo: 'Situação' }],
    pil.map(x => [x.proj, x.nome, { t: relFmtMoeda(x.orc), v: x.orc }, { t: relFmtMoeda(x.gasto), v: x.gasto }, { t: relFmtMoeda(x.orc - x.gasto), v: x.orc - x.gasto },
      { t: relFmtPct(x.pct), v: x.pct }, x.pct > 100 ? '▲ Estourado' : x.pct > 85 ? '● Perto do limite' : '✓ Dentro']));

  // f-tipos, f-fornecedores, f-pagamento: barras ranqueadas
  const ranking = (id, campo, rotulo) => {
    const m = new Map();
    D.gastosPer.forEach(g => { const k = g[campo] || '(não informado)'; m.set(k, (m.get(k) || 0) + g.valor); });
    const top = relTopN(m, 10);
    relAltura(id, relAlturaHorizontal(top.length));
    relGrafico(id, {
      data: { labels: top.map(([k]) => relCurto(k, 30)), datasets: [relBarra(rotulo, top.map(([, v]) => v), top.map(([k]) => k === 'Outros' ? REL_COR.outros : REL_COR.serie[0]))] },
      options: relOpcoes({ horizontal: true, eixo: relFmtMoedaCurta, valor: relFmtMoeda, legenda: false, rotulos: { formato: relFmtMoedaCurta } })
    }, top.length === 0);
    const todos = [...m.entries()].sort((a, b) => b[1] - a[1]);
    relTabela(id, [{ rotulo }, { rotulo: 'Valor', direita: true }, { rotulo: '% do período', direita: true }, { rotulo: 'Lançamentos', direita: true }, { rotulo: 'Ticket médio', direita: true }],
      todos.map(([k, v]) => {
        const n = D.gastosPer.filter(g => (g[campo] || '(não informado)') === k).length;
        return [k, { t: relFmtMoeda(v), v }, relFmtPct(relPct(v, totalPer)), n, { t: relFmtMoeda(v / n), v: v / n }];
      }));
    return todos;
  };
  ranking('f-tipos', 'tipo', 'Tipo de despesa');
  const forn = ranking('f-fornecedores', 'fornecedor', 'Fornecedor');
  const top5 = relSoma(forn.slice(0, 5), x => x[1]);
  relSubtitulo('f-fornecedores', forn.length
    ? `${forn.length} fornecedor(es) no período · os 5 maiores concentram ${relFmtPct(relPct(top5, totalPer))} dos gastos.`
    : 'Os fornecedores com maior volume no período.');
  ranking('f-pagamento', 'formaPgto', 'Forma de pagamento');

  // f-projeto-mes: empilhado por projeto (cor presa ao projeto)
  const projsComGasto = D.projetosSel.filter(p => D.gastosPer.some(g => g.projetoId === p.id)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  relGrafico('f-projeto-mes', {
    data: {
      labels: meses.map(relRotuloMes),
      datasets: projsComGasto.map(p => relBarraEmpilhada(relCurto(p.nome, 24), meses.map(m => relSoma(D.gastosPer.filter(g => g.projetoId === p.id && relChaveMes(relData(g.data)) === m), g => g.valor)), relCorProjeto(p.id)))
    },
    options: relOpcoes({ empilhado: true, eixo: relFmtMoedaCurta, valor: relFmtMoeda })
  }, projsComGasto.length === 0);
  relTabela('f-projeto-mes', [{ rotulo: 'Mês' }, ...projsComGasto.map(p => ({ rotulo: p.nome, direita: true })), { rotulo: 'Total', direita: true }],
    meses.map(m => {
      const vals = projsComGasto.map(p => relSoma(D.gastosPer.filter(g => g.projetoId === p.id && relChaveMes(relData(g.data)) === m), g => g.valor));
      return [relRotuloMes(m), ...vals.map(v => ({ t: relFmtMoeda(v), v })), { t: relFmtMoeda(relSoma(vals, v => v)), v: relSoma(vals, v => v) }];
    }));

  // f-realocacoes: divergente (recebido + / cedido −)
  const porPilar = new Map();
  const chave = (projId, pilarId) => `${projId}|${pilarId}`;
  D.realocSel.forEach(r => {
    const o = chave(r.origemProjetoId, r.origemPilarId), d = chave(r.destinoProjetoId, r.destinoPilarId);
    if (!porPilar.has(o)) porPilar.set(o, { rec: 0, ced: 0 });
    if (!porPilar.has(d)) porPilar.set(d, { rec: 0, ced: 0 });
    porPilar.get(o).ced += r.valor;
    porPilar.get(d).rec += r.valor;
  });
  const nomePilar = k => { const [pj, pl] = k.split('|'); const p = projetos.find(x => x.id === pj); const x = p && p.pilares.find(y => y.id === pl); return `${p ? p.nome : '—'} · ${x ? x.nome : '—'}`; };
  const rl = [...porPilar.entries()].sort((a, b) => (b[1].rec - b[1].ced) - (a[1].rec - a[1].ced));
  relAltura('f-realocacoes', relAlturaHorizontal(rl.length));
  relGrafico('f-realocacoes', {
    data: {
      labels: rl.map(([k]) => relCurto(nomePilar(k), 36)),
      datasets: [
        relBarraEmpilhada('Recebido', rl.map(([, v]) => v.rec || null), REL_COR.divPositivo, { borderRadius: 4 }),
        relBarraEmpilhada('Cedido', rl.map(([, v]) => v.ced ? -v.ced : null), REL_COR.divNegativo, { borderRadius: 4 })
      ]
    },
    options: relOpcoes({ horizontal: true, empilhado: true, eixo: relFmtMoedaCurta, valor: v => relFmtMoeda(Math.abs(v)), rotulos: { formato: v => relFmtMoedaCurta(Math.abs(v)) }, paddingFim: 70 })
  }, rl.length === 0);
  relTabela('f-realocacoes', [{ rotulo: 'Data' }, { rotulo: 'Origem' }, { rotulo: 'Destino' }, { rotulo: 'Valor', direita: true }, { rotulo: 'Motivo' }],
    [...D.realocSel].sort((a, b) => relData(b.criadoEm) - relData(a.criadoEm)).map(r => [r.dataHora, r.origem, r.destino, { t: relFmtMoeda(r.valor), v: r.valor }, r.motivo || '']),
    { vazio: 'Nenhuma realocação no período.' });

  // f-lancamentos
  const nomePilarPorId = id => { for (const p of projetos) { const x = p.pilares.find(y => y.id === id); if (x) return x.nome; } return '—'; };
  relTabela('f-lancamentos', [{ rotulo: 'Data' }, { rotulo: 'Projeto' }, { rotulo: 'Pilar' }, { rotulo: 'Tipo' }, { rotulo: 'Fornecedor' }, { rotulo: 'Pagamento' }, { rotulo: 'Descrição' }, { rotulo: 'Valor', direita: true }],
    [...D.gastosPer].sort((a, b) => String(b.data).localeCompare(String(a.data))).map(g => [
      { t: formatarData(g.data), v: g.data }, relNomeProjeto(g.projetoId), nomePilarPorId(g.pilarId), g.tipo, g.fornecedor, g.formaPgto, g.descricao, { t: relFmtMoeda(g.valor), v: g.valor }]),
    { rodape: ['Total', '', '', '', '', '', `${D.gastosPer.length} lançamento(s)`, { t: relFmtMoeda(totalPer), v: totalPer }], vazio: 'Nenhum lançamento no período.' });
}

// ---------------------------------------------------------------------------
// 3. Atividades e prazos
// ---------------------------------------------------------------------------
function relAtividades(D) {
  // a-status
  const projsAtiv = D.projetosSel.filter(p => D.tarefasSel.some(t => t.projetoId === p.id));
  relAltura('a-status', relAlturaHorizontal(projsAtiv.length));
  relGrafico('a-status', {
    data: {
      labels: projsAtiv.map(p => relCurto(p.nome, 26)),
      datasets: STATUS_TAREFA.map(s => relBarraEmpilhada(s.rotulo, projsAtiv.map(p => D.tarefasSel.filter(t => t.projetoId === p.id && t.status === s.valor).length || null), s.cor))
    },
    options: relOpcoes({ horizontal: true, empilhado: true, eixo: v => relFmtInt(v), valor: v => `${relFmtInt(v)} atividade(s)`, rotulos: { total: true, formato: v => relFmtInt(v) } })
  }, projsAtiv.length === 0);
  relTabela('a-status', [{ rotulo: 'Projeto' }, ...STATUS_TAREFA.map(s => ({ rotulo: s.rotulo, direita: true })), { rotulo: 'Total', direita: true }, { rotulo: '% concluído', direita: true }],
    projsAtiv.map(p => {
      const tp = D.tarefasSel.filter(t => t.projetoId === p.id);
      return [p.nome, ...STATUS_TAREFA.map(s => tp.filter(t => t.status === s.valor).length), tp.length, relFmtPct(relPct(tp.filter(t => t.status === 'Concluído').length, tp.length))];
    }));

  // a-fluxo: criadas × concluídas
  const { tipo, baldes } = relBaldes(D.ini, D.fim);
  const contaEm = (lista, campo) => baldes.map(b => lista.filter(t => { const d = relData(t[campo]); return d && d >= b.ini && d <= b.fim; }).length);
  const criadas = contaEm(D.tarefasSel, 'criadoEm');
  const concluidas = contaEm(D.tarefasSel.filter(t => t.status === 'Concluído'), 'concluidoEm');
  relSubtitulo('a-fluxo', `Entrada e saída de trabalho por ${tipo} no período.`);
  relGrafico('a-fluxo', {
    data: { labels: baldes.map(b => b.rotulo), datasets: [relLinha('Criadas', criadas, REL_COR.serie[0]), relLinha('Concluídas', concluidas, REL_COR.serie[2])] },
    options: relOpcoes({ eixo: v => Number.isInteger(v) ? v : '', valor: v => `${v} atividade(s)` })
  }, criadas.every(v => !v) && concluidas.every(v => !v));
  relTabela('a-fluxo', [{ rotulo: tipo === 'semana' ? 'Semana de' : 'Mês' }, { rotulo: 'Criadas', direita: true }, { rotulo: 'Concluídas', direita: true }, { rotulo: 'Saldo', direita: true }],
    baldes.map((b, i) => [b.rotulo, criadas[i], concluidas[i], concluidas[i] - criadas[i]]),
    { rodape: ['Total', relSoma(criadas, v => v), relSoma(concluidas, v => v), relSoma(concluidas, v => v) - relSoma(criadas, v => v)] });

  // a-prazo: por mês de conclusão
  const meses = relMesesEntre(D.ini, D.fim);
  const noPrazo = meses.map(m => D.concluidasPer.filter(t => relChaveMes(relData(t.concluidoEm)) === m && t.slaCumprido !== false).length);
  const fora = meses.map(m => D.concluidasPer.filter(t => relChaveMes(relData(t.concluidoEm)) === m && t.slaCumprido === false).length);
  relGrafico('a-prazo', {
    data: { labels: meses.map(relRotuloMes), datasets: [relBarraEmpilhada('✓ No prazo', noPrazo, REL_COR.bom), relBarraEmpilhada('▲ Fora do prazo', fora, REL_COR.critico)] },
    options: relOpcoes({ empilhado: true, eixo: v => Number.isInteger(v) ? v : '', valor: v => `${v} atividade(s)` })
  }, D.concluidasPer.length === 0);
  relTabela('a-prazo', [{ rotulo: 'Mês' }, { rotulo: 'No prazo', direita: true }, { rotulo: 'Fora do prazo', direita: true }, { rotulo: '% no prazo', direita: true }],
    meses.map((m, i) => [relRotuloMes(m), noPrazo[i], fora[i], relFmtPct(relPct(noPrazo[i], noPrazo[i] + fora[i]))]));

  // a-prioridade
  const prios = ['Urgente', 'Alta', 'Média', 'Baixa'];
  const ab = prios.map(p => D.abertas.filter(t => (t.prioridade || 'Média') === p).length);
  const at = prios.map(p => D.atrasadas.filter(t => (t.prioridade || 'Média') === p).length);
  const co = prios.map(p => D.concluidasPer.filter(t => (t.prioridade || 'Média') === p).length);
  relGrafico('a-prioridade', {
    data: { labels: prios, datasets: [relBarra('Em aberto', ab, REL_COR.serie[0]), relBarra('▲ Atrasadas', at, REL_COR.critico), relBarra('Concluídas no período', co, REL_COR.serie[2])] },
    options: relOpcoes({ eixo: v => Number.isInteger(v) ? v : '', valor: v => `${v} atividade(s)` })
  }, ab.every(v => !v) && co.every(v => !v));
  relTabela('a-prioridade', [{ rotulo: 'Prioridade' }, { rotulo: 'Em aberto', direita: true }, { rotulo: 'Atrasadas', direita: true }, { rotulo: '% atrasadas', direita: true }, { rotulo: 'Concluídas no período', direita: true }],
    prios.map((p, i) => [p, ab[i], at[i], relFmtPct(relPct(at[i], ab[i])), co[i]]));

  // a-aging (rampa ordinal)
  const faixas = [['0–7 dias', 0, 7], ['8–15 dias', 8, 15], ['16–30 dias', 16, 30], ['31–60 dias', 31, 60], ['Mais de 60 dias', 61, Infinity]];
  const idade = t => t.criadoEm ? Math.floor((D.hoje - relData(t.criadoEm)) / relDia) : null;
  const contAging = faixas.map(([, a, b]) => D.abertas.filter(t => { const i = idade(t); return i != null && i >= a && i <= b; }).length);
  relGrafico('a-aging', {
    data: { labels: faixas.map(f => f[0]), datasets: [relBarra('Atividades em aberto', contAging, [REL_COR.seq[3], REL_COR.seq[6], REL_COR.seq[8], REL_COR.seq[10], REL_COR.seq[12]])] },
    options: relOpcoes({ legenda: false, eixo: v => Number.isInteger(v) ? v : '', valor: v => `${v} atividade(s)`, rotulos: { formato: v => relFmtInt(v) } })
  }, D.abertas.length === 0);
  relTabela('a-aging', [{ rotulo: 'Atividade' }, { rotulo: 'Projeto' }, { rotulo: 'Responsável' }, { rotulo: 'Status' }, { rotulo: 'Criada em' }, { rotulo: 'Dias em aberto', direita: true }, { rotulo: 'Prazo' }],
    [...D.abertas].sort((a, b) => (idade(b) || 0) - (idade(a) || 0)).map(t => [t.titulo, relNomeProjeto(t.projetoId), relNomePessoa(t.colaboradorId), rotuloStatus(t.status),
      t.criadoEm ? relData(t.criadoEm).toLocaleDateString('pt-BR') : '—', idade(t) ?? '—', { t: formatarData(t.prazo), v: t.prazo, cls: t.prazo < D.hojeISO ? 'text-red-700 font-bold' : '' }]));

  // a-ciclo: lead time e ciclo médios por projeto
  const ciclo = D.projetosSel.map(p => {
    const cs = D.concluidasPer.filter(t => t.projetoId === p.id);
    const lead = relMedia(cs.filter(t => t.criadoEm).map(t => (relData(t.concluidoEm) - relData(t.criadoEm)) / relDia));
    const cic = relMedia(cs.filter(t => t.iniciadoEm).map(t => (relData(t.concluidoEm) - relData(t.iniciadoEm)) / relDia));
    const horasMed = relMedia(cs.map(t => t.tempo_gasto));
    return { p, n: cs.length, lead, cic, horasMed };
  }).filter(x => x.n > 0);
  relAltura('a-ciclo', relAlturaHorizontal(ciclo.length * 1.6));
  relGrafico('a-ciclo', {
    data: {
      labels: ciclo.map(x => relCurto(x.p.nome, 26)),
      datasets: [relBarra('Lead time (criação → conclusão)', ciclo.map(x => x.lead), REL_COR.serie[0]), relBarra('Ciclo (início → conclusão)', ciclo.map(x => x.cic), REL_COR.serie[1])]
    },
    options: relOpcoes({ horizontal: true, eixo: v => `${v} d`, valor: relFmtDias })
  }, ciclo.length === 0);
  relTabela('a-ciclo', [{ rotulo: 'Projeto' }, { rotulo: 'Concluídas', direita: true }, { rotulo: 'Lead time médio', direita: true }, { rotulo: 'Ciclo médio', direita: true }, { rotulo: 'Horas médias por atividade', direita: true }],
    ciclo.map(x => [x.p.nome, x.n, { t: relFmtDias(x.lead), v: x.lead }, { t: relFmtDias(x.cic), v: x.cic }, { t: fmtHoras(x.horasMed || 0), v: x.horasMed }]));

  // a-estimativa
  const est = D.projetosSel.map(p => {
    const tp = D.tarefasSel.filter(t => t.projetoId === p.id);
    return { p, n: tp.length, est: relSoma(tp, t => t.tempo_estimado), gasto: relSoma(tp, t => t.tempo_gasto) };
  }).filter(x => x.n > 0);
  relAltura('a-estimativa', relAlturaHorizontal(est.length * 1.6));
  relGrafico('a-estimativa', {
    data: { labels: est.map(x => relCurto(x.p.nome, 26)), datasets: [relBarra('Estimado', est.map(x => x.est), REL_COR.referencia), relBarra('Trabalhado', est.map(x => x.gasto), REL_COR.serie[0])] },
    options: relOpcoes({ horizontal: true, eixo: v => `${v}h`, valor: fmtHoras })
  }, est.length === 0);
  relTabela('a-estimativa', [{ rotulo: 'Projeto' }, { rotulo: 'Atividades', direita: true }, { rotulo: 'Estimado', direita: true }, { rotulo: 'Trabalhado', direita: true }, { rotulo: 'Saldo de horas', direita: true }, { rotulo: '% consumido', direita: true }],
    est.map(x => [x.p.nome, x.n, { t: fmtHoras(x.est), v: x.est }, { t: fmtHoras(x.gasto), v: x.gasto }, { t: fmtHoras(x.est - x.gasto), v: x.est - x.gasto, cls: x.gasto > x.est ? 'text-red-700 font-bold' : '' }, relFmtPct(relPct(x.gasto, x.est))]));

  // a-desvio: divergente por atividade concluída
  const desv = D.concluidasPer.filter(t => t.tempo_estimado > 0).map(t => ({ t, pct: ((t.tempo_gasto - t.tempo_estimado) / t.tempo_estimado) * 100 }))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const desvTop = desv.slice(0, 15).sort((a, b) => b.pct - a.pct);
  relAltura('a-desvio', relAlturaHorizontal(desvTop.length));
  relGrafico('a-desvio', {
    data: {
      labels: desvTop.map(x => relCurto(x.t.titulo, 30)),
      datasets: [
        relBarraEmpilhada('Acima do estimado', desvTop.map(x => x.pct > 0 ? Math.round(x.pct) : null), REL_COR.divNegativo, { borderRadius: 4 }),
        relBarraEmpilhada('Abaixo do estimado', desvTop.map(x => x.pct < 0 ? Math.round(x.pct) : null), REL_COR.divPositivo, { borderRadius: 4 })
      ]
    },
    options: relOpcoes({ horizontal: true, empilhado: true, eixo: v => `${v}%`, valor: v => `${v > 0 ? '+' : ''}${v}%`, rotulos: { formato: v => `${v > 0 ? '+' : ''}${v}%` }, paddingFim: 48 })
  }, desvTop.length === 0);
  const desvMedio = relMedia(desv.map(x => x.pct));
  relSubtitulo('a-desvio', desv.length
    ? `Horas trabalhadas acima (+) ou abaixo (−) do estimado. Desvio médio das ${desv.length} concluídas no período: ${desvMedio > 0 ? '+' : ''}${relFmtPct(desvMedio)}.`
    : 'Horas trabalhadas acima (+) ou abaixo (−) do estimado, nas atividades concluídas do período.');
  relTabela('a-desvio', [{ rotulo: 'Atividade' }, { rotulo: 'Projeto' }, { rotulo: 'Responsável' }, { rotulo: 'Estimado', direita: true }, { rotulo: 'Trabalhado', direita: true }, { rotulo: 'Desvio', direita: true }],
    desv.map(x => [x.t.titulo, relNomeProjeto(x.t.projetoId), relNomePessoa(x.t.colaboradorId), { t: fmtHoras(x.t.tempo_estimado), v: x.t.tempo_estimado }, { t: fmtHoras(x.t.tempo_gasto), v: x.t.tempo_gasto },
      { t: `${x.pct > 0 ? '+' : ''}${relFmtPct(x.pct)}`, v: x.pct, cls: x.pct > 0 ? 'text-red-700 font-bold' : 'text-blue-700' }]));

  // a-atrasadas por responsável
  const resp = [...new Set(D.abertas.map(t => t.colaboradorId))].sort((a, b) => relNomePessoa(a).localeCompare(relNomePessoa(b), 'pt-BR'));
  relAltura('a-atrasadas', relAlturaHorizontal(resp.length * 1.6));
  relGrafico('a-atrasadas', {
    data: {
      labels: resp.map(relNomePessoa),
      datasets: [relBarra('Em aberto', resp.map(id => D.abertas.filter(t => t.colaboradorId === id).length), REL_COR.serie[0]),
        relBarra('▲ Atrasadas', resp.map(id => D.atrasadas.filter(t => t.colaboradorId === id).length), REL_COR.critico)]
    },
    options: relOpcoes({ horizontal: true, eixo: v => Number.isInteger(v) ? v : '', valor: v => `${v} atividade(s)`, rotulos: { formato: v => relFmtInt(v) } })
  }, resp.length === 0);
  relTabela('a-atrasadas', [{ rotulo: 'Atividade atrasada' }, { rotulo: 'Projeto' }, { rotulo: 'Responsável' }, { rotulo: 'Status' }, { rotulo: 'Prazo' }, { rotulo: 'Dias de atraso', direita: true }],
    [...D.atrasadas].sort((a, b) => a.prazo.localeCompare(b.prazo)).map(t => [t.titulo, relNomeProjeto(t.projetoId), relNomePessoa(t.colaboradorId), rotuloStatus(t.status),
      { t: formatarData(t.prazo), v: t.prazo }, Math.round((D.hoje - dataDeISO(t.prazo)) / relDia)]),
    { vazio: 'Nenhuma atividade atrasada.' });
}

// ---------------------------------------------------------------------------
// 4. Equipe e horas
// ---------------------------------------------------------------------------
// Distribui as horas de cada sessão por hora do relógio (para dia da semana e horário)
function relHorasPorRelogio(sessoesLista, ini, fim) {
  const porDia = Array(7).fill(0), porHora = Array(24).fill(0);
  sessoesLista.forEach(s => {
    let a = Math.max(Date.parse(s.inicio), ini.getTime());
    const b = Math.min(s.fim ? Date.parse(s.fim) : Date.now(), fim.getTime());
    let guarda = 0;
    while (a < b && guarda++ < 24 * 400) {
      const d = new Date(a);
      const proxHora = new Date(d); proxHora.setMinutes(60, 0, 0);
      const ate = Math.min(proxHora.getTime(), b);
      const h = (ate - a) / 3600000;
      porDia[(d.getDay() + 6) % 7] += h; // segunda = 0
      porHora[d.getHours()] += h;
      a = ate;
    }
  });
  return { porDia, porHora };
}

function relEquipe(D) {
  const pessoas = [...new Set([...D.sessoesSel.map(s => s.colaboradorId), ...D.tarefasSel.map(t => t.colaboradorId)])]
    .sort((a, b) => relNomePessoa(a).localeCompare(relNomePessoa(b), 'pt-BR'));
  const horasDe = (id, filtro = () => true) => relSoma(D.sessoesSel.filter(s => s.colaboradorId === id && filtro(s)), D.horasSessao);

  // e-semanal: empilhado por pessoa
  const { tipo, baldes } = relBaldes(D.ini, D.fim);
  const comHoras = pessoas.filter(id => horasDe(id) > 0);
  const serie = id => baldes.map(b => relSoma(D.sessoesSel.filter(s => s.colaboradorId === id), s => duracaoSessaoHoras(s, new Date(Math.max(b.ini, D.ini)), new Date(Math.min(b.fim, D.fim)))));
  const series = comHoras.map(id => ({ id, v: serie(id) }));
  relSubtitulo('e-semanal', `Horas registradas pelas sessões de trabalho, por ${tipo}.`);
  relGrafico('e-semanal', {
    data: { labels: baldes.map(b => b.rotulo), datasets: series.map(x => relBarraEmpilhada(relNomePessoa(x.id), x.v.map(v => Math.round(v * 100) / 100), relCorPessoa(x.id))) },
    options: relOpcoes({ empilhado: true, eixo: v => `${v}h`, valor: fmtHoras, rotulos: { total: true, formato: v => fmtHoras(v) } })
  }, series.length === 0);
  relTabela('e-semanal', [{ rotulo: tipo === 'semana' ? 'Semana de' : 'Mês' }, ...series.map(x => ({ rotulo: relNomePessoa(x.id), direita: true })), { rotulo: 'Total', direita: true }],
    baldes.map((b, i) => [b.rotulo, ...series.map(x => ({ t: fmtHoras(x.v[i]), v: x.v[i] })), { t: fmtHoras(relSoma(series, x => x.v[i])), v: relSoma(series, x => x.v[i]) }]));

  // e-mapa: tabela com intensidade (rampa sequencial azul)
  const projsHoras = D.projetosSel.filter(p => D.sessoesSel.some(s => (D.tarefaPorId.get(s.tarefaId) || {}).projetoId === p.id));
  const celHoras = (id, pid) => horasDe(id, s => (D.tarefaPorId.get(s.tarefaId) || {}).projetoId === pid);
  const maxCel = Math.max(0.0001, ...comHoras.flatMap(id => projsHoras.map(p => celHoras(id, p.id))));
  const corCel = v => {
    if (v <= 0) return { estilo: '', cls: 'text-neutral-300' };
    const passo = Math.min(12, 1 + Math.floor((v / maxCel) * 11));
    return { estilo: `background:${REL_COR.seq[passo]};color:${passo >= 7 ? '#ffffff' : REL_COR.tinta}`, cls: 'font-bold' };
  };
  relTabela('e-mapa', [{ rotulo: 'Pessoa' }, ...projsHoras.map(p => ({ rotulo: relCurto(p.nome, 22), direita: true })), { rotulo: 'Total', direita: true }],
    comHoras.map(id => [relNomePessoa(id), ...projsHoras.map(p => { const v = celHoras(id, p.id); return { t: v > 0 ? fmtHoras(v) : '—', v, ...corCel(v) }; }),
      { t: fmtHoras(horasDe(id)), v: horasDe(id), cls: 'font-bold' }]),
    { rodape: ['Total', ...projsHoras.map(p => { const v = relSoma(comHoras, id => celHoras(id, p.id)); return { t: fmtHoras(v), v }; }), { t: fmtHoras(relSoma(comHoras, id => horasDe(id))), v: relSoma(comHoras, id => horasDe(id)) }],
      vazio: 'Nenhuma hora registrada no período.' });

  // e-utilizacao: capacidade = 8h × dias úteis decorridos no período,
  // contando a partir do primeiro registro de trabalho na plataforma (antes disso não havia apontamento)
  const primeiraSessao = sessoes.length ? new Date(Math.min(...sessoes.map(s => Date.parse(s.inicio)))) : null;
  const iniCap = new Date(Math.max(D.ini, primeiraSessao ? new Date(primeiraSessao.getFullYear(), primeiraSessao.getMonth(), primeiraSessao.getDate()) : D.ini));
  const fimCap = new Date(Math.min(D.fim, Date.now()));
  let diasUteis = 0;
  for (let d = new Date(iniCap); d <= fimCap; d.setDate(d.getDate() + 1)) { const w = d.getDay(); if (w !== 0 && w !== 6) diasUteis++; }
  const capacidade = diasUteis * 8;
  const util = pessoas.map(id => ({ id, h: horasDe(id), pct: relPct(horasDe(id), capacidade) || 0 })).sort((a, b) => b.pct - a.pct);
  relSubtitulo('e-utilizacao', `Horas trabalhadas ÷ capacidade de ${fmtHoras(capacidade)} (8h × ${diasUteis} dia(s) útil(eis) de ${iniCap.toLocaleDateString('pt-BR')} até hoje${iniCap > D.ini ? ', a partir do primeiro registro de trabalho na plataforma' : ''}).`);
  relAltura('e-utilizacao', relAlturaHorizontal(util.length));
  relGrafico('e-utilizacao', {
    data: { labels: util.map(x => relNomePessoa(x.id)), datasets: [relBarra('Uso da capacidade', util.map(x => Math.round(x.pct * 10) / 10), REL_COR.serie[0])] },
    options: relOpcoes({ horizontal: true, legenda: false, eixo: v => `${v}%`, valor: relFmtPct, max: Math.max(100, Math.ceil(Math.max(0, ...util.map(x => x.pct)) / 10) * 10), rotulos: { formato: relFmtPct } })
  }, util.length === 0 || capacidade === 0);
  relTabela('e-utilizacao', [{ rotulo: 'Pessoa' }, { rotulo: 'Horas trabalhadas', direita: true }, { rotulo: 'Capacidade', direita: true }, { rotulo: '% de uso', direita: true }, { rotulo: 'Média por dia útil', direita: true }],
    util.map(x => [relNomePessoa(x.id), { t: fmtHoras(x.h), v: x.h }, { t: fmtHoras(capacidade), v: capacidade }, relFmtPct(x.pct), { t: fmtHoras(diasUteis ? x.h / diasUteis : 0), v: diasUteis ? x.h / diasUteis : 0 }]));

  // e-diasemana / e-horadia
  const { porDia, porHora } = relHorasPorRelogio(D.sessoesSel, D.ini, D.fim);
  const dias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const totalH = relSoma(porDia, v => v);
  relGrafico('e-diasemana', {
    data: { labels: dias, datasets: [relBarra('Horas', porDia.map(v => Math.round(v * 100) / 100), REL_COR.serie[0])] },
    options: relOpcoes({ legenda: false, eixo: v => `${v}h`, valor: fmtHoras, rotulos: { formato: fmtHoras } })
  }, totalH === 0);
  relTabela('e-diasemana', [{ rotulo: 'Dia' }, { rotulo: 'Horas', direita: true }, { rotulo: '% do total', direita: true }],
    dias.map((d, i) => [d, { t: fmtHoras(porDia[i]), v: porDia[i] }, relFmtPct(relPct(porDia[i], totalH))]));
  relGrafico('e-horadia', {
    data: { labels: porHora.map((_, h) => `${String(h).padStart(2, '0')}h`), datasets: [relBarra('Horas', porHora.map(v => Math.round(v * 100) / 100), REL_COR.serie[0], { maxBarThickness: 18 })] },
    options: relOpcoes({ legenda: false, eixo: v => `${v}h`, valor: fmtHoras })
  }, totalH === 0);
  relTabela('e-horadia', [{ rotulo: 'Horário' }, { rotulo: 'Horas', direita: true }, { rotulo: '% do total', direita: true }],
    porHora.map((v, h) => [`${String(h).padStart(2, '0')}h–${String((h + 1) % 24).padStart(2, '0')}h`, { t: fmtHoras(v), v }, relFmtPct(relPct(v, totalH))]).filter(l => l[1].v > 0));

  // e-desempenho: quadro consolidado
  const anot = relEstado.anotacoes ? D.anotPer : null;
  relTabela('e-desempenho', [
    { rotulo: 'Pessoa' }, { rotulo: 'Em aberto', direita: true }, { rotulo: 'Atrasadas', direita: true }, { rotulo: 'Concluídas (período)', direita: true },
    { rotulo: '% no prazo', direita: true }, { rotulo: 'Horas trabalhadas', direita: true }, { rotulo: 'Horas por concluída', direita: true },
    { rotulo: 'Desvio médio de estimativa', direita: true }, { rotulo: 'Pausas', direita: true }, { rotulo: 'Devoluções recebidas', direita: true }],
    pessoas.map(id => {
      const ab = D.abertas.filter(t => t.colaboradorId === id);
      const at = D.atrasadas.filter(t => t.colaboradorId === id);
      const co = D.concluidasPer.filter(t => t.colaboradorId === id);
      const pz = relPct(co.filter(t => t.slaCumprido !== false).length, co.length);
      const h = horasDe(id);
      const dv = relMedia(co.filter(t => t.tempo_estimado > 0).map(t => ((t.tempo_gasto - t.tempo_estimado) / t.tempo_estimado) * 100));
      const pausas = anot ? anot.filter(a => a.tipo === 'pausa' && a.autor_id === id).length : '…';
      const devol = anot ? anot.filter(a => a.tipo === 'devolucao' && (D.tarefaPorId.get(a.tarefa_id) || {}).colaboradorId === id).length : '…';
      return [relNomePessoa(id), ab.length, { t: at.length, v: at.length, cls: at.length ? 'text-red-700 font-bold' : '' }, co.length, relFmtPct(pz),
        { t: fmtHoras(h), v: h }, { t: co.length ? fmtHoras(relSoma(co, t => t.tempo_gasto) / co.length) : '—', v: co.length ? relSoma(co, t => t.tempo_gasto) / co.length : null },
        { t: dv == null ? '—' : `${dv > 0 ? '+' : ''}${relFmtPct(dv)}`, v: dv }, pausas, devol];
    }),
    { vazio: 'Nenhuma pessoa com atividades no filtro selecionado.' });
}

// ---------------------------------------------------------------------------
// 5. Qualidade e fluxo (histórico das atividades)
// ---------------------------------------------------------------------------
function relIndicadoresQualidade(D) {
  if (!relEstado.anotacoes) return { carregado: false };
  // Por atividade: enviada para aprovação? devolvida?
  const porTarefa = new Map();
  D.anot.forEach(a => {
    if (!porTarefa.has(a.tarefa_id)) porTarefa.set(a.tarefa_id, { enviada: false, devolucoes: 0 });
    const r = porTarefa.get(a.tarefa_id);
    if (a.tipo === 'sistema' && /^Enviada para aprovação/i.test(a.texto)) r.enviada = true;
    if (a.tipo === 'devolucao') r.devolucoes++;
  });
  const enviadas = [...porTarefa.entries()].filter(([, r]) => r.enviada);
  const primeira = enviadas.filter(([, r]) => r.devolucoes === 0).length;
  return {
    carregado: true,
    porTarefa,
    enviadas: enviadas.length,
    pctPrimeira: relPct(primeira, enviadas.length),
    devolucoes: D.anotPer.filter(a => a.tipo === 'devolucao').length
  };
}

function relQualidade(D) {
  const aviso = relEstado.anotacoesErro
    ? `Não foi possível carregar o histórico: ${relEstado.anotacoesErro}`
    : (!relEstado.anotacoes ? 'Carregando o histórico das atividades…' : null);
  ['q-eventos', 'q-aprovacao', 'q-pausas', 'q-semnova', 'q-espera'].forEach(id => { if (aviso) { relGrafico(id, null, true); document.getElementById(`rel-vazio-${id}`).textContent = aviso; } else document.getElementById(`rel-vazio-${id}`).textContent = 'Sem dados para o filtro selecionado.'; });
  if (aviso) {
    ['q-eventos', 'q-aprovacao', 'q-pausas', 'q-semnova', 'q-espera', 'q-devolucoes', 'q-transferencias'].forEach(id => relTabela(id, [{ rotulo: '' }], [], { vazio: aviso }));
    return;
  }
  const A = D.anotPer;

  // q-eventos
  const meses = relMesesEntre(D.ini, D.fim);
  const conta = tipo => meses.map(m => A.filter(a => a.tipo === tipo && relChaveMes(relData(a.criado_em)) === m).length);
  const ev = { pausa: conta('pausa'), devolucao: conta('devolucao'), transferencia: conta('transferencia') };
  relGrafico('q-eventos', {
    data: {
      labels: meses.map(relRotuloMes),
      datasets: [relBarra('Pausas', ev.pausa, REL_COR.serie[0]), relBarra('Devoluções', ev.devolucao, REL_COR.serie[1]), relBarra('Transferências', ev.transferencia, REL_COR.serie[2])]
    },
    options: relOpcoes({ eixo: v => Number.isInteger(v) ? v : '', valor: v => `${v} evento(s)` })
  }, Object.values(ev).every(s => s.every(v => !v)));
  relTabela('q-eventos', [{ rotulo: 'Mês' }, { rotulo: 'Pausas', direita: true }, { rotulo: 'Devoluções', direita: true }, { rotulo: 'Transferências', direita: true }],
    meses.map((m, i) => [relRotuloMes(m), ev.pausa[i], ev.devolucao[i], ev.transferencia[i]]),
    { rodape: ['Total', relSoma(ev.pausa, v => v), relSoma(ev.devolucao, v => v), relSoma(ev.transferencia, v => v)] });

  // q-aprovacao: % aprovadas na 1ª por responsável
  const q = relIndicadoresQualidade(D);
  const porResp = new Map();
  q.porTarefa.forEach((r, tid) => {
    if (!r.enviada) return;
    const t = D.tarefaPorId.get(tid);
    if (!t) return;
    if (!porResp.has(t.colaboradorId)) porResp.set(t.colaboradorId, { env: 0, prim: 0, dev: 0 });
    const x = porResp.get(t.colaboradorId);
    x.env++; if (r.devolucoes === 0) x.prim++; x.dev += r.devolucoes;
  });
  const apr = [...porResp.entries()].map(([id, x]) => ({ id, ...x, pct: relPct(x.prim, x.env) })).sort((a, b) => b.pct - a.pct);
  relAltura('q-aprovacao', relAlturaHorizontal(apr.length));
  relGrafico('q-aprovacao', {
    data: { labels: apr.map(x => relNomePessoa(x.id)), datasets: [relBarra('Aprovadas na 1ª tentativa', apr.map(x => Math.round(x.pct * 10) / 10), REL_COR.serie[0])] },
    options: relOpcoes({ horizontal: true, legenda: false, max: 100, eixo: v => `${v}%`, valor: relFmtPct, rotulos: { formato: relFmtPct } })
  }, apr.length === 0);
  relTabela('q-aprovacao', [{ rotulo: 'Responsável' }, { rotulo: 'Enviadas p/ aprovação', direita: true }, { rotulo: 'Aprovadas na 1ª', direita: true }, { rotulo: 'Total de devoluções', direita: true }, { rotulo: '% na 1ª', direita: true }],
    apr.map(x => [relNomePessoa(x.id), x.env, x.prim, x.dev, relFmtPct(x.pct)]));

  // q-pausas / q-semnova: motivos agrupados
  const motivos = (id, tipo, rotulo) => {
    const m = new Map();
    A.filter(a => a.tipo === tipo).forEach(a => { const k = relNormalizarMotivo(a.texto); m.set(k, (m.get(k) || 0) + 1); });
    const top = relTopN(m, 10);
    relAltura(id, relAlturaHorizontal(top.length));
    relGrafico(id, {
      data: { labels: top.map(([k]) => relCurto(k, 34)), datasets: [relBarra(rotulo, top.map(([, v]) => v), top.map(([k]) => k === 'Outros' ? REL_COR.outros : REL_COR.serie[0]))] },
      options: relOpcoes({ horizontal: true, legenda: false, eixo: v => Number.isInteger(v) ? v : '', valor: v => `${v} vez(es)`, rotulos: { formato: v => relFmtInt(v) } })
    }, top.length === 0);
    const total = relSoma([...m.values()], v => v);
    relTabela(id, [{ rotulo: 'Motivo' }, { rotulo: 'Ocorrências', direita: true }, { rotulo: '% do total', direita: true }],
      [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, relFmtPct(relPct(v, total))]));
  };
  motivos('q-pausas', 'pausa', 'Pausas');
  motivos('q-semnova', 'sem_atividade', 'Ocorrências');

  // q-espera: tempo entre envio para aprovação e decisão
  const esperas = [];
  const porTarefaOrdenado = new Map();
  D.anot.forEach(a => { if (!porTarefaOrdenado.has(a.tarefa_id)) porTarefaOrdenado.set(a.tarefa_id, []); porTarefaOrdenado.get(a.tarefa_id).push(a); });
  porTarefaOrdenado.forEach((lista, tid) => {
    let envio = null;
    lista.forEach(a => {
      if (a.tipo === 'sistema' && /^Enviada para aprovação/i.test(a.texto)) envio = relData(a.criado_em);
      else if (envio && ((a.tipo === 'sistema' && /^Aprovada/i.test(a.texto)) || a.tipo === 'devolucao')) {
        const fim = relData(a.criado_em);
        if (D.dentro(fim)) esperas.push({ tid, horas: (fim - envio) / 3600000, resultado: a.tipo === 'devolucao' ? 'Devolvida' : 'Aprovada', fim });
        envio = null;
      }
    });
  });
  const porProj = new Map();
  esperas.forEach(e => { const pid = (D.tarefaPorId.get(e.tid) || {}).projetoId; if (!porProj.has(pid)) porProj.set(pid, []); porProj.get(pid).push(e.horas); });
  const esp = [...porProj.entries()].map(([pid, hs]) => ({ pid, n: hs.length, media: relMedia(hs), max: Math.max(...hs) })).sort((a, b) => b.media - a.media);
  relAltura('q-espera', relAlturaHorizontal(esp.length));
  relGrafico('q-espera', {
    data: { labels: esp.map(x => relCurto(relNomeProjeto(x.pid), 26)), datasets: [relBarra('Espera média', esp.map(x => Math.round(x.media * 100) / 100), REL_COR.serie[0])] },
    options: relOpcoes({ horizontal: true, legenda: false, eixo: v => `${v}h`, valor: fmtHoras, rotulos: { formato: fmtHoras } })
  }, esp.length === 0);
  relTabela('q-espera', [{ rotulo: 'Atividade' }, { rotulo: 'Projeto' }, { rotulo: 'Decisão' }, { rotulo: 'Em', direita: true }, { rotulo: 'Tempo aguardando', direita: true }],
    esperas.sort((a, b) => b.horas - a.horas).map(e => { const t = D.tarefaPorId.get(e.tid) || {}; return [t.titulo || '—', relNomeProjeto(t.projetoId), e.resultado, e.fim.toLocaleString('pt-BR'), { t: fmtHoras(e.horas), v: e.horas }]; }),
    { vazio: 'Nenhuma decisão de aprovação no período.' });

  // q-devolucoes / q-transferencias: tabelas
  const linhaEvento = a => { const t = D.tarefaPorId.get(a.tarefa_id) || {}; return [relData(a.criado_em).toLocaleString('pt-BR'), t.titulo || '—', relNomeProjeto(t.projetoId), relNomePessoa(t.colaboradorId), a.autor_nome, a.texto]; };
  relTabela('q-devolucoes', [{ rotulo: 'Data' }, { rotulo: 'Atividade' }, { rotulo: 'Projeto' }, { rotulo: 'Responsável' }, { rotulo: 'Devolvida por' }, { rotulo: 'Ajuste pedido' }],
    A.filter(a => a.tipo === 'devolucao').reverse().map(linhaEvento), { vazio: 'Nenhuma devolução no período.' });
  relTabela('q-transferencias', [{ rotulo: 'Data' }, { rotulo: 'Atividade' }, { rotulo: 'Projeto' }, { rotulo: 'Responsável atual' }, { rotulo: 'Feita por' }, { rotulo: 'Registro' }],
    A.filter(a => a.tipo === 'transferencia').reverse().map(linhaEvento), { vazio: 'Nenhuma transferência no período.' });
}

// ---------------------------------------------------------------------------
// 6. KPIs dos projetos (dados de kpis.js)
// ---------------------------------------------------------------------------
// KPIs considerados no recorte: dos projetos filtrados e já iniciados até o fim do período
function relKpisDoRecorte(D) {
  if (typeof kpis === 'undefined') return [];
  const fimISO = dataLocalISO(D.fim);
  return kpis.filter(k => D.idsProj.has(k.projetoId) && k.dataInicio <= fimISO);
}

function relTileKpis(D, tile) {
  if (typeof kpis === 'undefined' || !kpisDisponiveis) return [];
  const fimISO = dataLocalISO(D.fim);
  const lista = relKpisDoRecorte(D).filter(k => k.ativo);
  const resumos = lista.map(k => kpiResumo(k, fimISO));
  const comDado = resumos.filter(r => r.atingimento != null);
  const naMeta = comDado.filter(r => r.status.chave === 'ok').length;
  const pend = kpiPendencias().filter(p => D.idsProj.has(p.kpi.projetoId));
  const pct = relPct(naMeta, comDado.length);
  return [
    tile('KPIs na meta', comDado.length ? `${naMeta} de ${comDado.length}` : '—', `${lista.length} KPI(s) ativo(s) · ${relFmtPct(pct)} na meta`,
      pct == null ? null : pct >= 80 ? { cor: REL_COR.bom, icone: '✓', texto: 'Bom' } : pct >= 50 ? { cor: REL_COR.alerta, icone: '●', texto: 'Atenção' } : { cor: REL_COR.critico, icone: '▲', texto: 'Crítico' }),
    tile('Aferições pendentes', relFmtInt(pend.length), pend.length ? `${pend.filter(p => p.atrasada).length} atrasada(s) há mais de ${KPI_TOLERANCIA_DIAS} dias` : 'tudo registrado',
      pend.length ? { cor: pend.some(p => p.atrasada) ? REL_COR.critico : REL_COR.alerta, icone: pend.some(p => p.atrasada) ? '▲' : '●', texto: 'Registrar na tela inicial' } : null)
  ];
}

function relKpis(D) {
  const minis = document.getElementById('rel-kpi-minis');
  // remove minigráficos anteriores
  Object.keys(relEstado.graficos).filter(k => k.startsWith('km-')).forEach(k => { relEstado.graficos[k].destroy(); delete relEstado.graficos[k]; });

  if (typeof kpis === 'undefined' || !kpisDisponiveis) {
    const msg = 'Os KPIs ainda não estão disponíveis no banco (migração pendente).';
    ['k-saude', 'k-pontualidade'].forEach(id => { relGrafico(id, null, true); document.getElementById(`rel-vazio-${id}`).textContent = msg; });
    ['k-scorecard', 'k-evolucao', 'k-afericoes'].forEach(id => relTabela(id, [{ rotulo: '' }], [], { vazio: msg }));
    minis.innerHTML = `<p class="text-xs text-neutral-400">${msg}</p>`;
    return;
  }
  ['k-saude', 'k-pontualidade'].forEach(id => { document.getElementById(`rel-vazio-${id}`).textContent = 'Sem dados para o filtro selecionado.'; });

  const fimISO = dataLocalISO(D.fim);
  const iniISO = dataLocalISO(D.ini);
  const hojeISO = D.hojeISO;
  const lista = relKpisDoRecorte(D);
  const ativos = lista.filter(k => k.ativo);
  const nomeProj = id => relNomeProjeto(id);
  const resumo = new Map(lista.map(k => [k.id, kpiResumo(k, fimISO)]));
  const pendencias = kpiPendencias();

  // k-saude: empilhado por situação (cores de status com ícone no rótulo)
  const projsK = D.projetosSel.filter(p => ativos.some(k => k.projetoId === p.id)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const situacoes = [['ok', '✓ Meta atingida', REL_COR.bom], ['perto', '● Perto da meta', REL_COR.alerta], ['abaixo', '▲ Abaixo da meta', REL_COR.critico], ['sem', '○ Sem aferição', REL_COR.outros]];
  const contSit = (pid, ch) => ativos.filter(k => k.projetoId === pid && resumo.get(k.id).status.chave === ch).length;
  relAltura('k-saude', relAlturaHorizontal(projsK.length));
  relGrafico('k-saude', {
    data: { labels: projsK.map(p => relCurto(p.nome, 26)), datasets: situacoes.map(([ch, rot, cor]) => relBarraEmpilhada(rot, projsK.map(p => contSit(p.id, ch) || null), cor)) },
    options: relOpcoes({ horizontal: true, empilhado: true, eixo: v => Number.isInteger(v) ? v : '', valor: v => `${v} KPI(s)`, rotulos: { total: true, formato: v => relFmtInt(v) } })
  }, projsK.length === 0);
  relTabela('k-saude', [{ rotulo: 'Projeto' }, ...situacoes.map(s => ({ rotulo: s[1], direita: true })), { rotulo: 'Total', direita: true }, { rotulo: '% na meta (com aferição)', direita: true }],
    projsK.map(p => {
      const c = situacoes.map(s => contSit(p.id, s[0]));
      const comDado = c[0] + c[1] + c[2];
      return [p.nome, ...c, c.reduce((s, x) => s + x, 0), relFmtPct(relPct(c[0], comDado))];
    }), { vazio: 'Nenhum KPI ativo nos projetos filtrados.' });

  // k-pontualidade: % de períodos encerrados (no recorte) com valor; e % registrados em até 7 dias
  const limiteEncerrado = new Date(Math.min(D.fim, D.hoje));
  const pont = projsK.map(p => {
    let total = 0, registrados = 0, emDia = 0;
    ativos.filter(k => k.projetoId === p.id).forEach(k => {
      kpiPeriodos(k, limiteEncerrado).forEach(per => {
        if (per.fimData >= D.hoje || per.fim < iniISO || per.fim > fimISO) return;
        total++;
        const a = kpiAfericaoDoPeriodo(k.id, per.inicio);
        if (a) {
          registrados++;
          const prazo = new Date(per.fimData); prazo.setDate(prazo.getDate() + KPI_TOLERANCIA_DIAS + 1);
          if (new Date(a.criadoEm) < prazo) emDia++;
        }
      });
    });
    return { p, total, registrados, emDia };
  }).filter(x => x.total > 0);
  relAltura('k-pontualidade', relAlturaHorizontal(pont.length * 1.6));
  relGrafico('k-pontualidade', {
    data: {
      labels: pont.map(x => relCurto(x.p.nome, 26)),
      datasets: [relBarra('Registrados', pont.map(x => Math.round(relPct(x.registrados, x.total) * 10) / 10), REL_COR.serie[0]),
        relBarra('Registrados em dia', pont.map(x => Math.round(relPct(x.emDia, x.total) * 10) / 10), REL_COR.serie[2])]
    },
    options: relOpcoes({ horizontal: true, max: 100, eixo: v => `${v}%`, valor: relFmtPct, rotulos: { formato: relFmtPct } })
  }, pont.length === 0);
  relTabela('k-pontualidade', [{ rotulo: 'Projeto' }, { rotulo: 'Períodos encerrados', direita: true }, { rotulo: 'Registrados', direita: true }, { rotulo: 'Em dia', direita: true }, { rotulo: '% registrados', direita: true }, { rotulo: 'Pendentes hoje', direita: true }],
    pont.map(x => [x.p.nome, x.total, x.registrados, x.emDia, relFmtPct(relPct(x.registrados, x.total)), pendencias.filter(pd => pd.kpi.projetoId === x.p.id).length]),
    { vazio: 'Nenhum período de aferição encerrado no recorte.' });

  // k-scorecard
  const ordenados = [...lista].sort((a, b) => nomeProj(a.projetoId).localeCompare(nomeProj(b.projetoId), 'pt-BR') || (b.ativo - a.ativo) || a.nome.localeCompare(b.nome, 'pt-BR'));
  relTabela('k-scorecard', [
    { rotulo: 'Projeto' }, { rotulo: 'KPI' }, { rotulo: 'Intervalo' }, { rotulo: 'Meta', direita: true }, { rotulo: 'Último / acumulado', direita: true },
    { rotulo: 'Atingimento', direita: true }, { rotulo: 'Tendência', direita: true }, { rotulo: 'Situação' }, { rotulo: 'Aferições no período', direita: true }, { rotulo: 'Pendentes', direita: true }],
    ordenados.map(k => {
      const r = resumo.get(k.id);
      const tend = kpiTendencia(k, r);
      const noPeriodo = afericoes.filter(a => a.kpiId === k.id && a.inicio >= iniISO && a.inicio <= fimISO).length;
      const pk = pendencias.filter(x => x.kpi.id === k.id).length;
      return [
        nomeProj(k.projetoId),
        { t: `${k.nome}${k.ativo ? '' : ' (arquivado)'}`, html: `<div class="font-bold text-neutral-900">${escaparHtml(k.nome)}${k.ativo ? '' : ' <span class="text-[10px] text-neutral-400">(arquivado)</span>'}</div><div class="text-[10px] text-neutral-500">${escaparHtml(k.unidade)} · ${kpiDescricaoTipo(k)} · ${kpiDescricaoSentido(k)}</div>` },
        KPI_PERIODICIDADES[k.periodicidade],
        { t: kpiFmt(k.meta, k.unidade), v: k.meta },
        { t: kpiFmt(r.valor, k.unidade), v: r.valor, cls: 'font-bold' },
        { t: r.atingimento == null ? '—' : relFmtPct(r.atingimento), v: r.atingimento },
        { t: tend.txt, cls: tend.cls },
        { t: `${r.status.icone} ${r.status.rotulo}`, html: `<span class="inline-flex items-center gap-1 font-bold"><span class="w-2 h-2 rounded-full" style="background:${r.status.cor}"></span>${r.status.icone} ${r.status.rotulo}</span>` },
        noPeriodo,
        { t: pk, v: pk, cls: pk ? 'text-amber-700 font-bold' : '' }
      ];
    }), { vazio: 'Nenhum KPI cadastrado nos projetos filtrados.' });

  // k-evolucao: um minigráfico por KPI (cada um na sua unidade — sem misturar escalas)
  const limiteSerie = new Date(Math.min(D.fim, D.hoje.getTime() + 86400000));
  const linhasTabela = [];
  minis.innerHTML = ordenados.filter(k => k.ativo || afericoes.some(a => a.kpiId === k.id)).map(k => {
    const r = resumo.get(k.id);
    return `
      <div class="border border-neutral-200 rounded-lg p-3 min-w-0">
        <p class="text-[10px] uppercase font-bold text-neutral-500 truncate">${escaparHtml(nomeProj(k.projetoId))}</p>
        <p class="text-xs font-black text-neutral-900 truncate" title="${escaparHtml(k.nome)}">${escaparHtml(k.nome)}</p>
        <p class="text-[10px] text-neutral-600 flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background:${r.status.cor}"></span>${r.status.icone} ${r.status.rotulo}
          ${r.atingimento != null ? ` · ${relFmtPct(r.atingimento)} da meta` : ''} · meta ${kpiFmt(k.meta, k.unidade)}${k.tipoMeta === 'acumulada' ? ' (acumulada)' : ''}</p>
        <div id="rel-area-km-${k.id}" class="relative mt-1" style="height:150px">
          <canvas id="rel-c-km-${k.id}" role="img" aria-label="Evolução de ${escaparHtml(k.nome)}"></canvas>
          <p id="rel-vazio-km-${k.id}" class="hidden absolute inset-0 flex items-center justify-center text-[11px] text-neutral-400">Sem aferições no período.</p>
        </div>
      </div>`;
  }).join('') || '<p class="text-xs text-neutral-400">Nenhum KPI cadastrado nos projetos filtrados.</p>';

  ordenados.filter(k => k.ativo || afericoes.some(a => a.kpiId === k.id)).forEach(k => {
    const periodos = kpiPeriodos(k, limiteSerie).filter(p => p.fimData >= D.ini && p.ini <= D.fim).slice(-24);
    const todas = kpiAfericoesDe(k.id);
    let acumulado = todas.filter(a => periodos.length && a.inicio < periodos[0].inicio).reduce((s, a) => s + a.valor, 0);
    const valores = periodos.map(p => {
      const a = todas.find(x => x.inicio === p.inicio);
      if (k.tipoMeta === 'acumulada') { if (a) acumulado += a.valor; return a ? acumulado : null; }
      return a ? a.valor : null;
    });
    const metas = periodos.map(p => { const a = todas.find(x => x.inicio === p.inicio); return k.tipoMeta === 'acumulada' ? k.meta : (a ? a.meta : k.meta); });
    periodos.forEach((p, i) => linhasTabela.push([nomeProj(k.projetoId), k.nome, kpiRotuloPeriodo(k.periodicidade, p.inicio),
      { t: kpiFmt(valores[i], k.unidade), v: valores[i] }, { t: kpiFmt(metas[i], k.unidade), v: metas[i] },
      valores[i] == null ? (p.fim < hojeISO ? 'Pendente' : 'Em andamento') : relFmtPct(kpiAtingimento(k, valores[i], metas[i]))]));
    const fmtK = v => kpiFmt(v, k.unidade);
    const opc = relOpcoes({ eixo: v => kpiFmt(v, k.unidade === 'R$' ? 'R$' : k.unidade === '%' ? '%' : 'número'), valor: fmtK });
    opc.plugins.legend.labels.font.size = 10;
    opc.plugins.legend.labels.padding = 8;
    opc.scales.x.ticks.maxTicksLimit = 6;
    relGrafico(`km-${k.id}`, {
      data: {
        labels: periodos.map(p => kpiRotuloPeriodo(k.periodicidade, p.inicio)),
        datasets: [
          relLinha(k.tipoMeta === 'acumulada' ? 'Acumulado' : 'Apurado', valores, REL_COR.serie[0], { pointRadius: 3, spanGaps: k.tipoMeta === 'acumulada' }),
          relLinha('Meta', metas, REL_COR.mudo, { borderDash: [5, 4], borderWidth: 1.5, cubicInterpolationMode: 'default', tension: 0, stepped: k.tipoMeta === 'acumulada' ? false : 'middle' })
        ]
      },
      options: opc
    }, valores.every(v => v == null));
  });
  relTabela('k-evolucao', [{ rotulo: 'Projeto' }, { rotulo: 'KPI' }, { rotulo: 'Período' }, { rotulo: 'Apurado', direita: true }, { rotulo: 'Meta', direita: true }, { rotulo: 'Atingimento', direita: true }],
    linhasTabela, { vazio: 'Nenhum período no recorte.' });

  // k-afericoes
  const kpiPorId = new Map(kpis.map(k => [k.id, k]));
  const afPer = afericoes.filter(a => { const k = kpiPorId.get(a.kpiId); return k && D.idsProj.has(k.projetoId) && a.inicio >= iniISO && a.inicio <= fimISO; })
    .sort((a, b) => b.inicio.localeCompare(a.inicio));
  relTabela('k-afericoes', [{ rotulo: 'Projeto' }, { rotulo: 'KPI' }, { rotulo: 'Período' }, { rotulo: 'Valor', direita: true }, { rotulo: 'Meta da época', direita: true }, { rotulo: 'Atingimento', direita: true }, { rotulo: 'Observação' }, { rotulo: 'Registrado por' }, { rotulo: 'Em' }],
    afPer.map(a => {
      const k = kpiPorId.get(a.kpiId);
      const ating = k.tipoMeta === 'acumulada' ? null : kpiAtingimento(k, a.valor, a.meta);
      return [nomeProj(k.projetoId), k.nome, kpiRotuloPeriodo(k.periodicidade, a.inicio), { t: kpiFmt(a.valor, k.unidade), v: a.valor }, { t: kpiFmt(a.meta, k.unidade), v: a.meta },
        k.tipoMeta === 'acumulada' ? 'ver acumulado' : relFmtPct(ating), a.observacao, a.por, new Date(a.atualizadoEm || a.criadoEm).toLocaleString('pt-BR')];
    }), { vazio: 'Nenhuma aferição registrada no período.' });
}
