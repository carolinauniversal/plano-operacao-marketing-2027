/* =============================================================================
   KPIs DOS PROJETOS
   - Cadastro: nome, meta e intervalo de aferição (+ unidade, sentido e tipo de meta)
   - Aferição: um valor por período do calendário; somente a gestão registra
   - Alerta na tela inicial da gestão quando um período termina sem aferição
   - Bloco de KPIs em cada projeto (aba Projetos & Pilares) e seção na aba Relatórios
   Dados lidos de projeto_kpis e kpi_afericoes (Supabase).
============================================================================= */

let kpis = [];
let afericoes = [];
let kpisDisponiveis = false;

const KPI_PERIODICIDADES = {
  semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal', bimestral: 'Bimestral',
  trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual'
};
const KPI_UNIDADES = ['número', '%', 'R$', 'seguidores', 'visualizações', 'alcance', 'impressões', 'cliques', 'leads', 'vendas', 'pessoas', 'participantes', 'menções', 'downloads', 'nota'];
const KPI_TOLERANCIA_DIAS = 7; // após o fim do período: "pendente" até 7 dias, depois "atrasada"
const KPI_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------
async function kpiCarregar() {
  if (!usuarioLogado || usuarioLogado.role === 'colaborador') { kpis = []; afericoes = []; return; }
  const [rk, ra] = await Promise.all([
    clienteSupabase.from('projeto_kpis').select('*').order('criado_em'),
    clienteSupabase.from('kpi_afericoes').select('*').order('periodo_inicio')
  ]);
  kpisDisponiveis = !rk.error && !ra.error;
  kpis = (rk.data || []).map(k => ({
    id: k.id, projetoId: k.projeto_id, nome: k.nome, meta: Number(k.meta), unidade: k.unidade, sentido: k.sentido,
    tipoMeta: k.tipo_meta, periodicidade: k.periodicidade, dataInicio: k.data_inicio, ativo: k.ativo, criadoEm: k.criado_em
  }));
  afericoes = (ra.data || []).map(a => ({
    id: a.id, kpiId: a.kpi_id, inicio: a.periodo_inicio, fim: a.periodo_fim, valor: Number(a.valor), meta: Number(a.meta_no_periodo),
    observacao: a.observacao || '', por: a.registrado_por_nome || '', criadoEm: a.criado_em, atualizadoEm: a.atualizado_em
  }));
}

// ---------------------------------------------------------------------------
// Períodos do calendário
// ---------------------------------------------------------------------------
function kpiPeriodoDe(periodicidade, data) {
  const a = data.getFullYear(), m = data.getMonth(), d = data.getDate();
  let ini, fim;
  switch (periodicidade) {
    case 'semanal': ini = new Date(a, m, d - ((data.getDay() + 6) % 7)); fim = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + 6); break;
    case 'quinzenal': ini = d <= 15 ? new Date(a, m, 1) : new Date(a, m, 16); fim = d <= 15 ? new Date(a, m, 15) : new Date(a, m + 1, 0); break;
    case 'bimestral': ini = new Date(a, m - (m % 2), 1); fim = new Date(a, m - (m % 2) + 2, 0); break;
    case 'trimestral': ini = new Date(a, m - (m % 3), 1); fim = new Date(a, m - (m % 3) + 3, 0); break;
    case 'semestral': ini = new Date(a, m - (m % 6), 1); fim = new Date(a, m - (m % 6) + 6, 0); break;
    case 'anual': ini = new Date(a, 0, 1); fim = new Date(a, 11, 31); break;
    default: ini = new Date(a, m, 1); fim = new Date(a, m + 1, 0); // mensal
  }
  return { inicio: dataLocalISO(ini), fim: dataLocalISO(fim), ini, fimData: fim };
}

function kpiRotuloPeriodo(periodicidade, inicioISO) {
  const d = dataDeISO(inicioISO), a = d.getFullYear(), m = d.getMonth();
  switch (periodicidade) {
    case 'semanal': return `Semana de ${String(d.getDate()).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}/${String(a).slice(2)}`;
    case 'quinzenal': return `${d.getDate() <= 15 ? '1ª' : '2ª'} quinz. ${KPI_MESES[m]}/${String(a).slice(2)}`;
    case 'bimestral': return `${KPI_MESES[m]}–${KPI_MESES[m + 1]}/${a}`;
    case 'trimestral': return `${Math.floor(m / 3) + 1}º trim./${a}`;
    case 'semestral': return `${Math.floor(m / 6) + 1}º sem./${a}`;
    case 'anual': return String(a);
    default: return `${KPI_MESES[m]}/${a}`;
  }
}

// Todos os períodos do KPI, do primeiro (data de início) até o que contém "ate"
function kpiPeriodos(kpi, ate = new Date()) {
  const out = [];
  let p = kpiPeriodoDe(kpi.periodicidade, dataDeISO(kpi.dataInicio));
  while (p.ini <= ate && out.length < 600) {
    out.push(p);
    const prox = new Date(p.fimData); prox.setDate(prox.getDate() + 1);
    p = kpiPeriodoDe(kpi.periodicidade, prox);
  }
  return out;
}

const kpiAfericoesDe = kpiId => afericoes.filter(a => a.kpiId === kpiId).sort((a, b) => a.inicio.localeCompare(b.inicio));
const kpiAfericaoDoPeriodo = (kpiId, inicio) => afericoes.find(a => a.kpiId === kpiId && a.inicio === inicio);

// Aferições que já deveriam ter sido registradas (período encerrado e sem valor)
function kpiPendencias() {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const out = [];
  kpis.filter(k => k.ativo && projetos.some(p => p.id === k.projetoId)).forEach(k => {
    kpiPeriodos(k, hoje).forEach(p => {
      if (p.fimData >= hoje) return; // período ainda em andamento
      if (kpiAfericaoDoPeriodo(k.id, p.inicio)) return;
      const diasAtraso = Math.floor((hoje - p.fimData) / 86400000);
      out.push({ kpi: k, periodo: p, diasAtraso, atrasada: diasAtraso > KPI_TOLERANCIA_DIAS });
    });
  });
  return out.sort((a, b) => b.diasAtraso - a.diasAtraso);
}

// ---------------------------------------------------------------------------
// Cálculos
// ---------------------------------------------------------------------------
function kpiFmt(valor, unidade) {
  if (valor == null || isNaN(valor)) return '—';
  if (unidade === '%') return `${Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  if (unidade === 'R$') return formatarMoeda(valor);
  const n = Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return unidade && unidade !== 'número' ? `${n} ${unidade}` : n;
}

// % da meta atingida, considerando o sentido (maior é melhor / menor é melhor)
function kpiAtingimento(kpi, valor, meta = kpi.meta) {
  if (valor == null || meta == null) return null;
  if (kpi.sentido === 'menor') {
    if (valor <= 0) return meta >= 0 ? 100 : null;
    return (meta / valor) * 100;
  }
  if (!meta) return valor > 0 ? 100 : null;
  return (valor / meta) * 100;
}

// Situação atual do KPI até uma data (padrão: hoje)
function kpiResumo(kpi, ate = null) {
  const lista = kpiAfericoesDe(kpi.id).filter(a => !ate || a.inicio <= ate);
  if (!lista.length) return { valor: null, anterior: null, atingimento: null, status: kpiStatus(null), n: 0, ultima: null };
  const ultima = lista[lista.length - 1];
  let valor, anterior;
  if (kpi.tipoMeta === 'acumulada') {
    valor = lista.reduce((s, a) => s + a.valor, 0);
    anterior = lista.length > 1 ? valor - ultima.valor : null;
  } else {
    valor = ultima.valor;
    anterior = lista.length > 1 ? lista[lista.length - 2].valor : null;
  }
  const meta = kpi.tipoMeta === 'acumulada' ? kpi.meta : ultima.meta;
  const atingimento = kpiAtingimento(kpi, valor, meta);
  return { valor, anterior, meta, atingimento, status: kpiStatus(atingimento), n: lista.length, ultima };
}

function kpiStatus(atingimento) {
  if (atingimento == null) return { chave: 'sem', rotulo: 'Sem aferição', icone: '○', cor: '#b5b3ab' };
  if (atingimento >= 100) return { chave: 'ok', rotulo: 'Meta atingida', icone: '✓', cor: '#0ca30c' };
  if (atingimento >= 80) return { chave: 'perto', rotulo: 'Perto da meta', icone: '●', cor: '#fab219' };
  return { chave: 'abaixo', rotulo: 'Abaixo da meta', icone: '▲', cor: '#d03b3b' };
}

// Tendência: melhorou ou piorou em relação à aferição anterior (respeita o sentido)
function kpiTendencia(kpi, r) {
  if (r.anterior == null || r.valor == null) return { txt: '—', cls: 'text-neutral-400' };
  const delta = kpi.tipoMeta === 'acumulada' ? r.valor - r.anterior : r.valor - r.anterior;
  if (delta === 0) return { txt: '→ estável', cls: 'text-neutral-500' };
  const melhorou = kpi.sentido === 'menor' ? delta < 0 : delta > 0;
  const seta = delta > 0 ? '▲' : '▼';
  return { txt: `${seta} ${kpiFmt(Math.abs(delta), kpi.unidade)}`, cls: melhorou ? 'text-emerald-700' : 'text-red-700', melhorou };
}

const kpiDescricaoTipo = k => k.tipoMeta === 'acumulada' ? 'acumulada no projeto' : 'a cada aferição';
const kpiDescricaoSentido = k => k.sentido === 'menor' ? 'quanto menor, melhor' : 'quanto maior, melhor';

// ---------------------------------------------------------------------------
// Formulário de KPI (linhas usadas no "Novo projeto" e no "Novo/Editar KPI")
// ---------------------------------------------------------------------------
const KPI_INPUT = 'w-full border border-neutral-300 rounded p-2 text-xs outline-none focus:ring-2 focus:ring-red-600 bg-white';

function kpiCamposHtml(v = {}, { removivel = true, travarPeriodo = false } = {}) {
  const opt = (obj, sel) => Object.entries(obj).map(([k, r]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${r}</option>`).join('');
  return `
    <div class="kpi-linha rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-2">
      <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
        <label class="sm:col-span-5 text-[10px] font-bold uppercase text-neutral-600">Nome do KPI *
          <input type="text" data-k="nome" maxlength="200" value="${escaparHtml(v.nome || '')}" placeholder="Ex: Novos seguidores no Instagram" class="${KPI_INPUT} mt-1 normal-case font-normal">
        </label>
        <label class="sm:col-span-3 text-[10px] font-bold uppercase text-neutral-600">Meta *
          <input type="number" step="any" data-k="meta" value="${v.meta ?? ''}" placeholder="Ex: 5000" class="${KPI_INPUT} mt-1 normal-case font-normal">
        </label>
        <label class="sm:col-span-3 text-[10px] font-bold uppercase text-neutral-600">Intervalo de aferição *
          <select data-k="periodicidade" class="${KPI_INPUT} mt-1 normal-case font-normal" ${travarPeriodo ? 'disabled title="Não pode ser alterado depois que existem aferições"' : ''}>
            ${opt(KPI_PERIODICIDADES, v.periodicidade || 'mensal')}
          </select>
        </label>
        <div class="sm:col-span-1 flex justify-end">
          ${removivel ? '<button type="button" onclick="this.closest(\'.kpi-linha\').remove()" title="Remover KPI" class="px-2 py-2 text-red-600 hover:bg-red-50 rounded text-sm font-bold">✕</button>' : ''}
        </div>
      </div>
      <details ${v.unidade && v.unidade !== 'número' || v.sentido === 'menor' || v.tipoMeta === 'acumulada' ? 'open' : ''}>
        <summary class="cursor-pointer text-[11px] font-bold text-neutral-600 select-none">Mais opções (unidade, sentido, tipo de meta, início)</summary>
        <div class="grid grid-cols-1 sm:grid-cols-4 gap-2 mt-2">
          <label class="text-[10px] font-bold uppercase text-neutral-600">Unidade
            <input type="text" data-k="unidade" list="kpiListaUnidades" maxlength="40" value="${escaparHtml(v.unidade || 'número')}" class="${KPI_INPUT} mt-1 normal-case font-normal">
          </label>
          <label class="text-[10px] font-bold uppercase text-neutral-600">Sentido
            <select data-k="sentido" class="${KPI_INPUT} mt-1 normal-case font-normal">${opt({ maior: 'Quanto maior, melhor', menor: 'Quanto menor, melhor' }, v.sentido || 'maior')}</select>
          </label>
          <label class="text-[10px] font-bold uppercase text-neutral-600">A meta vale
            <select data-k="tipo_meta" class="${KPI_INPUT} mt-1 normal-case font-normal">${opt({ periodo: 'A cada aferição', acumulada: 'Acumulada no projeto' }, v.tipoMeta || 'periodo')}</select>
          </label>
          <label class="text-[10px] font-bold uppercase text-neutral-600">Aferir a partir de
            <input type="date" data-k="data_inicio" value="${v.dataInicio || dataLocalISO()}" class="${KPI_INPUT} mt-1 normal-case font-normal" ${travarPeriodo ? 'disabled' : ''}>
          </label>
        </div>
        <p class="text-[10px] text-neutral-500 mt-1">Ex.: "Engajamento médio" (%) mensal, meta a cada aferição · "Alcance total" (alcance) mensal, meta acumulada · "Custo por lead" (R$), quanto menor, melhor.</p>
      </details>
    </div>`;
}

function kpiAdicionarLinha(containerId, valores = {}) {
  document.getElementById(containerId).insertAdjacentHTML('beforeend', kpiCamposHtml(valores));
  const linhas = document.querySelectorAll(`#${containerId} .kpi-linha`);
  linhas[linhas.length - 1].querySelector('[data-k="nome"]').focus();
}

// Lê as linhas; linhas totalmente vazias são ignoradas
function kpiColetarLinhas(containerId) {
  const itens = [];
  for (const linha of document.querySelectorAll(`#${containerId} .kpi-linha`)) {
    const v = k => { const el = linha.querySelector(`[data-k="${k}"]`); return el ? el.value.trim() : ''; };
    const nome = v('nome'), meta = v('meta');
    if (!nome && meta === '') continue;
    if (!nome) return { erro: 'Informe o nome de todos os KPIs.' };
    if (meta === '' || isNaN(Number(meta))) return { erro: `Informe a meta do KPI "${nome}".` };
    itens.push({ nome, meta: Number(meta), periodicidade: v('periodicidade'), unidade: v('unidade') || 'número', sentido: v('sentido') || 'maior', tipo_meta: v('tipo_meta') || 'periodo', data_inicio: v('data_inicio') || dataLocalISO() });
  }
  return { itens };
}

// ---------------------------------------------------------------------------
// Novo / editar KPI de projeto existente
// ---------------------------------------------------------------------------
function kpiGarantirModais() {
  if (document.getElementById('modalKpi')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <datalist id="kpiListaUnidades">${KPI_UNIDADES.map(u => `<option value="${u}">`).join('')}</datalist>

    <div id="modalKpi" class="fixed inset-0 bg-black bg-opacity-70 backdrop-blur-sm hidden z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-xl max-w-3xl w-full p-6 shadow-2xl border-t-4 border-red-600 max-h-[92vh] overflow-y-auto">
        <h3 id="kpiModalTitulo" class="text-base font-black text-neutral-900"></h3>
        <p id="kpiModalSub" class="text-xs text-neutral-500 mb-3"></p>
        <form onsubmit="kpiSalvar(event)" class="space-y-3">
          <input type="hidden" id="kpiModalProjeto"><input type="hidden" id="kpiModalId">
          <div id="kpiModalCampos" class="space-y-2"></div>
          <div id="kpiModalAdicionar"></div>
          <div class="flex justify-end gap-2 pt-3 border-t border-neutral-100">
            <button type="button" onclick="document.getElementById('modalKpi').classList.add('hidden')" class="px-3 py-1.5 border rounded text-xs font-bold">Cancelar</button>
            <button type="submit" class="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-bold">Salvar</button>
          </div>
        </form>
      </div>
    </div>

    <div id="modalAfericoes" class="fixed inset-0 bg-black bg-opacity-70 backdrop-blur-sm hidden z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-xl max-w-5xl w-full p-6 shadow-2xl border-t-4 border-red-600 max-h-[92vh] flex flex-col">
        <h3 id="afericaoTitulo" class="text-base font-black text-neutral-900"></h3>
        <p id="afericaoSub" class="text-xs text-neutral-500 mb-3"></p>
        <form onsubmit="kpiSalvarAfericoes(event)" class="flex flex-col min-h-0">
          <div class="overflow-auto custom-scrollbar border border-neutral-200 rounded min-h-0">
            <table class="w-full text-left text-xs">
              <thead class="bg-neutral-100 text-[10px] uppercase text-neutral-600 sticky top-0 z-10">
                <tr><th class="p-2">Projeto · KPI</th><th class="p-2">Período</th><th class="p-2 text-right">Meta</th><th class="p-2 w-36">Valor apurado</th><th class="p-2">Observação (opcional)</th><th class="p-2"></th></tr>
              </thead>
              <tbody id="afericaoLinhas" class="divide-y divide-neutral-100"></tbody>
            </table>
          </div>
          <p class="text-[10px] text-neutral-500 mt-2">Deixe em branco o que ainda não tiver o número — a aferição continua pendente. Valores já registrados podem ser corrigidos aqui.</p>
          <div class="flex justify-end gap-2 pt-3 mt-2 border-t border-neutral-100">
            <button type="button" onclick="document.getElementById('modalAfericoes').classList.add('hidden')" class="px-3 py-1.5 border rounded text-xs font-bold">Fechar</button>
            <button type="submit" class="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-bold">Salvar aferições</button>
          </div>
        </form>
      </div>
    </div>`);
}

function kpiAbrirNovo(projetoId) {
  if (!usuarioPodeGerir()) return;
  kpiGarantirModais();
  const p = projetos.find(x => x.id === projetoId);
  document.getElementById('kpiModalTitulo').textContent = 'Novos KPIs';
  document.getElementById('kpiModalSub').textContent = `Projeto: ${p ? p.nome : ''} — adicione quantos KPIs precisar.`;
  document.getElementById('kpiModalProjeto').value = projetoId;
  document.getElementById('kpiModalId').value = '';
  document.getElementById('kpiModalCampos').innerHTML = kpiCamposHtml({}, { removivel: true });
  document.getElementById('kpiModalAdicionar').innerHTML = `<button type="button" onclick="kpiAdicionarLinha('kpiModalCampos')" class="px-3 py-1.5 border border-dashed border-neutral-400 rounded text-xs font-bold text-neutral-700 hover:bg-neutral-50 w-full">＋ Adicionar outro KPI</button>`;
  document.getElementById('modalKpi').classList.remove('hidden');
  document.querySelector('#kpiModalCampos [data-k="nome"]').focus();
}

function kpiAbrirEditar(kpiId) {
  if (!usuarioPodeGerir()) return;
  kpiGarantirModais();
  const k = kpis.find(x => x.id === kpiId);
  if (!k) return;
  const temAfericoes = afericoes.some(a => a.kpiId === kpiId);
  document.getElementById('kpiModalTitulo').textContent = 'Editar KPI';
  document.getElementById('kpiModalSub').textContent = temAfericoes
    ? 'O intervalo e a data de início não podem mudar porque já existem aferições. Uma nova meta vale para as próximas aferições; as já registradas mantêm a meta da época.'
    : 'Ajuste os dados do KPI.';
  document.getElementById('kpiModalProjeto').value = k.projetoId;
  document.getElementById('kpiModalId').value = k.id;
  document.getElementById('kpiModalCampos').innerHTML = kpiCamposHtml(k, { removivel: false, travarPeriodo: temAfericoes });
  document.getElementById('kpiModalAdicionar').innerHTML = '';
  document.getElementById('modalKpi').classList.remove('hidden');
}

async function kpiSalvar(e) {
  e.preventDefault();
  if (!usuarioPodeGerir()) return;
  const projetoId = document.getElementById('kpiModalProjeto').value;
  const id = document.getElementById('kpiModalId').value;
  const { itens, erro } = kpiColetarLinhas('kpiModalCampos');
  if (erro) { notificar(erro, 'erro'); return; }
  if (!itens.length) { notificar('Preencha ao menos um KPI.', 'erro'); return; }
  await comBotaoOcupado(e, async () => {
    let error;
    if (id) {
      const it = itens[0];
      const k = kpis.find(x => x.id === id);
      const temAfericoes = afericoes.some(a => a.kpiId === id);
      const dados = { nome: it.nome, meta: it.meta, unidade: it.unidade, sentido: it.sentido, tipo_meta: it.tipo_meta };
      if (!temAfericoes) { dados.periodicidade = it.periodicidade; dados.data_inicio = it.data_inicio; }
      ({ error } = await clienteSupabase.from('projeto_kpis').update(dados).eq('id', id));
      if (!error) notificar(`KPI "${it.nome}" atualizado.${k && k.meta !== it.meta ? ' A nova meta vale para as próximas aferições.' : ''}`);
    } else {
      ({ error } = await clienteSupabase.from('projeto_kpis').insert(itens.map(it => ({ projeto_id: projetoId, ...it }))));
      if (!error) notificar(`${itens.length} KPI(s) adicionado(s).`);
    }
    if (error) { notificar(`Não foi possível salvar: ${mensagemErro(error)}`, 'erro'); return; }
    document.getElementById('modalKpi').classList.add('hidden');
    await recarregarDados();
  });
}

async function kpiAlternarAtivo(kpiId) {
  if (!usuarioPodeGerir()) return;
  const k = kpis.find(x => x.id === kpiId);
  if (!k) return;
  if (k.ativo) {
    const r = await abrirDialogo({
      titulo: `Arquivar o KPI "${k.nome}"?`,
      mensagem: 'Ele deixa de gerar alertas de aferição. O histórico continua nos relatórios e o KPI pode ser reativado depois.',
      botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Arquivar', valor: 'ok', estilo: 'vermelho' }]
    });
    if (r.valor !== 'ok') return;
  }
  const { error } = await clienteSupabase.from('projeto_kpis').update({ ativo: !k.ativo }).eq('id', kpiId);
  if (error) { notificar(`Não foi possível atualizar: ${mensagemErro(error)}`, 'erro'); return; }
  notificar(k.ativo ? 'KPI arquivado.' : 'KPI reativado.');
  await recarregarDados();
}

// ---------------------------------------------------------------------------
// Registro de aferições (em lote)
// ---------------------------------------------------------------------------
let kpiLinhasAfericao = [];

// modo 'pendentes': todas as aferições em atraso/pendentes · modo kpi: períodos recentes de um KPI
function kpiAbrirAfericoes(kpiId = null) {
  if (!usuarioPodeGerir()) return;
  kpiGarantirModais();
  const hoje = new Date();
  if (kpiId) {
    const k = kpis.find(x => x.id === kpiId);
    if (!k) return;
    const periodos = kpiPeriodos(k, hoje).reverse().slice(0, 12);
    kpiLinhasAfericao = periodos.map(p => ({ kpi: k, periodo: p, atual: kpiAfericaoDoPeriodo(k.id, p.inicio) }));
    document.getElementById('afericaoTitulo').textContent = `Aferições — ${k.nome}`;
    document.getElementById('afericaoSub').textContent = `${KPI_PERIODICIDADES[k.periodicidade]} · meta ${kpiFmt(k.meta, k.unidade)} (${kpiDescricaoTipo(k)}, ${kpiDescricaoSentido(k)}). Últimos ${periodos.length} período(s), incluindo o atual.`;
  } else {
    const pend = kpiPendencias();
    kpiLinhasAfericao = pend.map(x => ({ kpi: x.kpi, periodo: x.periodo, atual: null, atraso: x }));
    document.getElementById('afericaoTitulo').textContent = 'Registrar aferições pendentes';
    document.getElementById('afericaoSub').textContent = pend.length
      ? `${pend.length} aferição(ões) de períodos já encerrados. Preencha o que tiver em mãos e salve tudo de uma vez.`
      : 'Nenhuma aferição pendente. Para registrar o período atual, use "Registrar" no KPI desejado (aba Projetos & Pilares).';
  }
  const hojeISO = dataLocalISO();
  document.getElementById('afericaoLinhas').innerHTML = kpiLinhasAfericao.length ? kpiLinhasAfericao.map((l, i) => {
    const emAndamento = l.periodo.fim >= hojeISO;
    const meta = l.atual ? l.atual.meta : l.kpi.meta;
    return `
      <tr class="${l.atraso && l.atraso.atrasada ? 'bg-red-50/40' : ''}">
        <td class="p-2"><div class="text-[10px] uppercase font-bold text-neutral-500">${escaparHtml((projetos.find(p => p.id === l.kpi.projetoId) || {}).nome || '')}</div><div class="font-bold text-neutral-900">${escaparHtml(l.kpi.nome)}</div></td>
        <td class="p-2 whitespace-nowrap">${kpiRotuloPeriodo(l.kpi.periodicidade, l.periodo.inicio)}
          ${emAndamento ? '<div class="text-[10px] text-sky-700 font-bold">em andamento</div>' : ''}
          ${l.atraso ? `<div class="text-[10px] font-bold ${l.atraso.atrasada ? 'text-red-700' : 'text-amber-700'}">${l.atraso.atrasada ? '▲' : '●'} encerrado há ${l.atraso.diasAtraso} dia(s)</div>` : ''}
          ${l.atual ? `<div class="text-[10px] text-neutral-500">registrado por ${escaparHtml(l.atual.por || '—')}</div>` : ''}</td>
        <td class="p-2 text-right whitespace-nowrap">${kpiFmt(meta, l.kpi.unidade)}${l.kpi.tipoMeta === 'acumulada' ? '<div class="text-[10px] text-neutral-500">acumulada</div>' : ''}</td>
        <td class="p-2"><input type="number" step="any" data-i="${i}" data-campo="valor" value="${l.atual ? l.atual.valor : ''}" placeholder="${l.kpi.unidade === '%' ? 'Ex: 4,5' : 'Valor'}" class="${KPI_INPUT}">
          ${l.kpi.tipoMeta === 'acumulada' ? '<div class="text-[10px] text-neutral-500 mt-0.5">valor do período (não o total)</div>' : ''}</td>
        <td class="p-2"><input type="text" data-i="${i}" data-campo="obs" maxlength="2000" value="${escaparHtml(l.atual ? l.atual.observacao : '')}" placeholder="Fonte, contexto…" class="${KPI_INPUT}"></td>
        <td class="p-2 text-right">${l.atual ? `<button type="button" onclick="kpiExcluirAfericao('${l.atual.id}', '${l.kpi.id}')" title="Apagar esta aferição" class="text-red-600 hover:underline text-[11px] font-bold">Apagar</button>` : ''}</td>
      </tr>`;
  }).join('') : '<tr><td colspan="6" class="p-6 text-center text-emerald-700 font-semibold">✓ Tudo em dia.</td></tr>';
  document.getElementById('modalAfericoes').classList.remove('hidden');
  const primeiro = document.querySelector('#afericaoLinhas input[data-campo="valor"]');
  if (primeiro) primeiro.focus();
}

async function kpiSalvarAfericoes(e) {
  e.preventDefault();
  if (!usuarioPodeGerir()) return;
  const itens = [];
  kpiLinhasAfericao.forEach((l, i) => {
    const valor = document.querySelector(`#afericaoLinhas [data-i="${i}"][data-campo="valor"]`).value.trim();
    const obs = document.querySelector(`#afericaoLinhas [data-i="${i}"][data-campo="obs"]`).value.trim();
    if (valor === '') return;
    if (l.atual && Number(valor) === l.atual.valor && obs === (l.atual.observacao || '')) return; // sem mudança
    itens.push({ kpi_id: l.kpi.id, periodo_inicio: l.periodo.inicio, periodo_fim: l.periodo.fim, valor: Number(valor), observacao: obs || null });
  });
  if (!itens.length) { notificar('Nenhum valor novo ou alterado para salvar.', 'erro'); return; }
  await comBotaoOcupado(e, async () => {
    const { data, error } = await clienteSupabase.rpc('registrar_afericoes', { p_itens: itens });
    if (error) { notificar(`Não foi possível salvar: ${mensagemErro(error)}`, 'erro'); return; }
    document.getElementById('modalAfericoes').classList.add('hidden');
    notificar(`${data} aferição(ões) registrada(s).`);
    await recarregarDados();
  });
}

async function kpiExcluirAfericao(afericaoId, kpiId) {
  if (!usuarioPodeGerir()) return;
  const r = await abrirDialogo({
    titulo: 'Apagar aferição?',
    mensagem: 'O período volta a ficar sem valor (e entra nos alertas, se já estiver encerrado).',
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Apagar', valor: 'ok', estilo: 'vermelho' }]
  });
  if (r.valor !== 'ok') return;
  const { error } = await clienteSupabase.from('kpi_afericoes').delete().eq('id', afericaoId);
  if (error) { notificar(`Não foi possível apagar: ${mensagemErro(error)}`, 'erro'); return; }
  notificar('Aferição apagada.');
  await recarregarDados();
  kpiAbrirAfericoes(kpiId);
}

// Esc fecha as janelas de KPI
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  const dialogoAberto = document.getElementById('modalDialogo') && !document.getElementById('modalDialogo').classList.contains('hidden');
  if (dialogoAberto) return;
  ['modalAfericoes', 'modalKpi'].forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
});

// ---------------------------------------------------------------------------
// Alerta na tela inicial (gestão)
// ---------------------------------------------------------------------------
function kpiRenderizarAlerta() {
  const alvo = document.getElementById('gestor-alerta-kpis');
  if (!alvo) return;
  if (!usuarioLogado || usuarioLogado.role !== 'gestor') { alvo.innerHTML = ''; return; }
  if (!kpisDisponiveis) { alvo.innerHTML = ''; return; }
  const pend = kpiPendencias();
  if (!pend.length) { alvo.innerHTML = ''; return; }
  const atrasadas = pend.filter(p => p.atrasada).length;
  const porProjeto = new Map();
  pend.forEach(p => porProjeto.set(p.kpi.projetoId, (porProjeto.get(p.kpi.projetoId) || 0) + 1));
  alvo.innerHTML = `
    <div class="rounded-xl border-l-4 ${atrasadas ? 'border-red-600 bg-red-50' : 'border-amber-500 bg-amber-50'} p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm" role="alert">
      <div class="min-w-0">
        <p class="text-sm font-black text-neutral-900">📈 Hora de registrar KPIs: ${pend.length} aferição(ões) pendente(s)${atrasadas ? ` · <span class="text-red-700">▲ ${atrasadas} atrasada(s) há mais de ${KPI_TOLERANCIA_DIAS} dias</span>` : ''}</p>
        <p class="text-[11px] text-neutral-700 mt-0.5">${[...porProjeto.entries()].map(([pid, n]) => `${escaparHtml((projetos.find(p => p.id === pid) || {}).nome || '')}: ${n}`).join(' · ')}</p>
      </div>
      <button type="button" onclick="kpiAbrirAfericoes()" class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-black shrink-0">Registrar agora</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Bloco de KPIs no card do projeto (aba Projetos & Pilares)
// ---------------------------------------------------------------------------
function kpiBlocoProjeto(p) {
  if (!usuarioLogado || usuarioLogado.role === 'colaborador') return '';
  const gestor = usuarioLogado.role === 'gestor';
  const doProjeto = kpis.filter(k => k.projetoId === p.id);
  const ativos = doProjeto.filter(k => k.ativo), arquivados = doProjeto.filter(k => !k.ativo);
  const pend = kpiPendencias().filter(x => x.kpi.projetoId === p.id);
  const linha = k => {
    const r = kpiResumo(k);
    const tend = kpiTendencia(k, r);
    const pk = pend.filter(x => x.kpi.id === k.id).length;
    return `
      <tr class="${k.ativo ? '' : 'opacity-60'}">
        <td class="py-1.5 pr-2"><div class="font-bold text-neutral-900">${escaparHtml(k.nome)}</div>
          <div class="text-[10px] text-neutral-500">${KPI_PERIODICIDADES[k.periodicidade]} · ${kpiDescricaoTipo(k)} · ${kpiDescricaoSentido(k)}</div></td>
        <td class="py-1.5 pr-2 text-right whitespace-nowrap">${kpiFmt(k.meta, k.unidade)}</td>
        <td class="py-1.5 pr-2 text-right whitespace-nowrap font-bold">${kpiFmt(r.valor, k.unidade)}${r.ultima ? `<div class="text-[10px] font-normal text-neutral-500">${k.tipoMeta === 'acumulada' ? 'acumulado até ' : ''}${kpiRotuloPeriodo(k.periodicidade, r.ultima.inicio)}</div>` : ''}</td>
        <td class="py-1.5 pr-2 text-right whitespace-nowrap text-[11px] ${tend.cls}">${tend.txt}</td>
        <td class="py-1.5 pr-2 whitespace-nowrap"><span class="inline-flex items-center gap-1 text-[10px] font-bold text-neutral-800"><span class="w-2 h-2 rounded-full" style="background:${r.status.cor}"></span>${r.status.icone} ${r.status.rotulo}${r.atingimento != null ? ` (${(Math.round(r.atingimento * 10) / 10).toLocaleString('pt-BR')}%)` : ''}</span>
          ${pk ? `<div class="text-[10px] font-bold text-amber-700">● ${pk} aferição(ões) pendente(s)</div>` : ''}</td>
        ${gestor ? `<td class="py-1.5 text-right whitespace-nowrap">
          ${k.ativo ? `<button onclick="kpiAbrirAfericoes('${k.id}')" class="px-2 py-0.5 rounded bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold">Registrar</button>` : ''}
          <button onclick="kpiAbrirEditar('${k.id}')" class="px-2 py-0.5 rounded border border-neutral-300 hover:bg-neutral-100 text-[10px] font-bold">Editar</button>
          <button onclick="kpiAlternarAtivo('${k.id}')" class="px-1 text-[10px] font-bold text-neutral-500 hover:underline">${k.ativo ? 'Arquivar' : 'Reativar'}</button></td>` : ''}
      </tr>`;
  };
  const cab = `<thead class="text-[10px] uppercase text-neutral-500 border-b border-neutral-200"><tr>
    <th class="py-1.5 pr-2">KPI</th><th class="py-1.5 pr-2 text-right">Meta</th><th class="py-1.5 pr-2 text-right">Último / acumulado</th>
    <th class="py-1.5 pr-2 text-right">Tendência</th><th class="py-1.5 pr-2">Situação</th>${gestor ? '<th></th>' : ''}</tr></thead>`;
  return `
    <div class="rounded-lg border border-neutral-200 p-3 space-y-2 bg-white">
      <div class="flex flex-wrap justify-between items-center gap-2">
        <p class="text-xs font-black uppercase text-neutral-800">📈 KPIs do projeto <span class="text-neutral-400 font-bold">(${ativos.length})</span></p>
        ${gestor ? `<button onclick="kpiAbrirNovo('${p.id}')" class="px-2.5 py-1 border border-neutral-300 rounded text-[11px] font-bold hover:bg-neutral-100">＋ KPI</button>` : ''}
      </div>
      ${!kpisDisponiveis ? '<p class="text-[11px] text-amber-700">Os KPIs ainda não estão disponíveis no banco (migração pendente).</p>'
        : ativos.length ? `<div class="overflow-x-auto custom-scrollbar"><table class="w-full text-left text-[11px] text-neutral-700">${cab}<tbody class="divide-y divide-neutral-100">${ativos.map(linha).join('')}</tbody></table></div>`
        : `<p class="text-[11px] text-neutral-400">Nenhum KPI definido.${gestor ? ' Use "＋ KPI" para incluir os indicadores deste projeto.' : ''}</p>`}
      ${arquivados.length ? `<details><summary class="cursor-pointer text-[10px] font-bold text-neutral-500 select-none">Arquivados (${arquivados.length})</summary>
        <div class="overflow-x-auto custom-scrollbar mt-1"><table class="w-full text-left text-[11px] text-neutral-700">${cab}<tbody class="divide-y divide-neutral-100">${arquivados.map(linha).join('')}</tbody></table></div></details>` : ''}
    </div>`;
}
