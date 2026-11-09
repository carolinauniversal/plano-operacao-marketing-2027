// Busca, filtros e paginação do Quadro Kanban.
// Usa as globais de index.html: tarefas, projetos, usuarios, usuarioLogado, STATUS_TAREFA, CORES_PRIORIDADE, renderizarKanbanGeral.

const KF_PAGINA = 20;
const KF_PERIODOS = [
  { valor: 'todos', rotulo: 'Todos os prazos' }, { valor: 'atrasadas', rotulo: 'Atrasadas' }, { valor: 'hoje', rotulo: 'Hoje' },
  { valor: 'semana', rotulo: 'Esta semana' }, { valor: 'mes', rotulo: 'Este mês' }, { valor: '30', rotulo: 'Próximos 30 dias' }
];
const KF_PESO_PRIORIDADE = { 'Urgente': 0, 'Alta': 1, 'Média': 2, 'Baixa': 3 };

let kfPeriodo = 'todos';
let kfLimites = {};
let kfResumo = {};
let kfTimer = null;
let kfMontado = false;

const kfEl = id => document.getElementById(id);
const kfNormalizar = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const kfTermos = s => kfNormalizar(s).split(/\s+/).filter(Boolean);
const kfIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const kfDataBr = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '';

function kfOpcoesPrioridade() {
  return Object.keys(KF_PESO_PRIORIDADE).map(p => `<option value="${p}">${p}</option>`).join('');
}

// Controles de cada coluna e opções fixas (uma única vez)
function kfMontar() {
  if (kfMontado) return;
  kfMontado = true;
  kfEl('filtroPrioridadeKanban').insertAdjacentHTML('beforeend', kfOpcoesPrioridade());
  kfEl('kfPeriodos').innerHTML = KF_PERIODOS.map(p =>
    `<button type="button" data-periodo="${p.valor}" onclick="kfEscolherPeriodo('${p.valor}')" class="px-2.5 py-1 rounded-full border text-[11px] font-bold transition"></button>`).join('');
  kfEl('kfPeriodos').querySelectorAll('button').forEach((b, i) => { b.textContent = KF_PERIODOS[i].rotulo; });
  const campo = 'w-full min-w-0 border border-neutral-300 bg-white rounded p-1.5 text-[11px] outline-none focus:ring-1 focus:ring-red-600';
  STATUS_TAREFA.forEach(s => {
    const c = s.coluna;
    const ordemPadrao = c === 'concluido' ? 'prazo_desc' : 'prazo_asc';
    kfEl(`coluna-k-${c}`).insertAdjacentHTML('beforebegin', `
      <div class="space-y-1.5 mb-3">
        <label for="kfBuscaC-${c}" class="sr-only">Filtrar a coluna ${s.rotulo}</label>
        <input id="kfBuscaC-${c}" type="search" oninput="kfDigitou()" placeholder="Filtrar nesta coluna..." class="${campo}">
        <div class="grid grid-cols-2 gap-1.5">
          <div><label for="kfPrioC-${c}" class="sr-only">Prioridade na coluna ${s.rotulo}</label>
            <select id="kfPrioC-${c}" onchange="kfMudou()" class="${campo}"><option value="todas">Prioridade</option>${kfOpcoesPrioridade()}</select></div>
          <div><label for="kfOrdemC-${c}" class="sr-only">Ordenar a coluna ${s.rotulo}</label>
            <select id="kfOrdemC-${c}" onchange="kfMudou()" data-padrao="${ordemPadrao}" class="${campo}">
              <option value="prazo_asc">Prazo: próximo</option><option value="prazo_desc">Prazo: distante</option>
              <option value="prioridade">Prioridade</option><option value="titulo">Título A–Z</option><option value="recentes">Mais recentes</option>
            </select></div>
        </div>
      </div>`);
    kfEl(`kfOrdemC-${c}`).value = ordemPadrao;
    kfEl(`coluna-k-${c}`).insertAdjacentHTML('afterend', `<div id="kfMais-${c}" class="pt-3"></div>`);
  });
}

function kfPreencherPilares() {
  const sel = kfEl('filtroPilarKanban');
  const anterior = sel.value;
  const projeto = projetos.find(p => p.id === kfEl('filtroProjetoKanban').value);
  sel.innerHTML = `<option value="todos">${projeto ? 'Todos os pilares' : 'Escolha o projeto'}</option>`;
  (projeto && projeto.pilares || []).forEach(p => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.nome;
    sel.appendChild(o);
  });
  sel.disabled = !projeto;
  sel.value = [...sel.options].some(o => o.value === anterior) ? anterior : 'todos';
}

function kfDentroDoPeriodo(t, hoje) {
  if (kfPeriodo === 'todos') return true;
  if (kfPeriodo === 'atrasadas') return t.prazo < hoje && t.status !== 'Concluído';
  if (kfPeriodo === 'hoje') return t.prazo === hoje;
  const agora = new Date();
  let fim;
  if (kfPeriodo === 'semana') fim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + ((7 - agora.getDay()) % 7));
  else if (kfPeriodo === 'mes') fim = new Date(agora.getFullYear(), agora.getMonth() + 1, 0);
  else fim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 30);
  return t.prazo >= hoje && t.prazo <= kfIso(fim);
}

// Texto pesquisável: tudo o que a pessoa enxerga no card, menos horas
function kfTextoDaTarefa(t, hoje) {
  const projeto = projetos.find(p => p.id === t.projetoId);
  const pilar = projeto && projeto.pilares ? projeto.pilares.find(p => p.id === t.pilarId) : null;
  const resp = usuarios.find(u => u.id === t.colaboradorId);
  return kfNormalizar([
    t.titulo, t.descricao, projeto && projeto.nome, pilar && pilar.nome, resp && resp.nome, t.prioridade, rotuloStatus(t.status),
    formatarData(t.prazo), kfDataBr(t.previsaoInicio), kfDataBr(t.previsaoTermino),
    t.prazo < hoje && t.status !== 'Concluído' ? 'atrasada' : ''
  ].join(' '));
}

function kfFiltrarGeral(lista) {
  kfMontar();
  kfPreencherPilares();
  const hoje = dataLocalISO();
  const termos = kfTermos(kfEl('kfBusca').value);
  const pilar = kfEl('filtroPilarKanban').value;
  const prioridade = kfEl('filtroPrioridadeKanban').value;
  const de = kfEl('kfDe').value, ate = kfEl('kfAte').value;
  return lista.filter(t => {
    if (pilar !== 'todos' && t.pilarId !== pilar) return false;
    if (prioridade !== 'todas' && (t.prioridade || 'Média') !== prioridade) return false;
    if (de && t.prazo < de) return false;
    if (ate && t.prazo > ate) return false;
    if (!kfDentroDoPeriodo(t, hoje)) return false;
    if (!termos.length) return true;
    const texto = kfTextoDaTarefa(t, hoje);
    return termos.every(x => texto.includes(x));
  });
}

function kfOrdenar(lista, ordem) {
  const porPrazo = (a, b) => String(a.prazo).localeCompare(String(b.prazo)) || (Date.parse(a.previsaoInicio || 0) || 0) - (Date.parse(b.previsaoInicio || 0) || 0);
  const peso = t => { const p = KF_PESO_PRIORIDADE[t.prioridade || 'Média']; return p === undefined ? 9 : p; };
  const regras = {
    prazo_asc: porPrazo,
    prazo_desc: (a, b) => porPrazo(b, a),
    prioridade: (a, b) => peso(a) - peso(b) || porPrazo(a, b),
    titulo: (a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'),
    recentes: (a, b) => (Date.parse(b.criadoEm || 0) || 0) - (Date.parse(a.criadoEm || 0) || 0)
  };
  return [...lista].sort(regras[ordem] || porPrazo);
}

// Aplica os filtros de cada coluna e devolve só os cards a desenhar
function kfVisiveis(lista) {
  const hoje = dataLocalISO();
  kfResumo = {};
  return STATUS_TAREFA.flatMap(s => {
    const c = s.coluna;
    const doStatus = lista.filter(t => t.status === s.valor);
    const termos = kfTermos(kfEl(`kfBuscaC-${c}`).value);
    const prioridade = kfEl(`kfPrioC-${c}`).value;
    const filtradas = doStatus.filter(t => (prioridade === 'todas' || (t.prioridade || 'Média') === prioridade)
      && (!termos.length || (texto => termos.every(x => texto.includes(x)))(kfTextoDaTarefa(t, hoje))));
    const ordenadas = kfOrdenar(filtradas, kfEl(`kfOrdemC-${c}`).value);
    const limite = kfLimites[c] || KF_PAGINA;
    kfResumo[c] = { total: doStatus.length, filtradas: filtradas.length, visiveis: Math.min(limite, filtradas.length) };
    return ordenadas.slice(0, limite);
  });
}

function kfQtdFiltrosAtivos() {
  const r = usuarioLogado.role === 'colaborador' ? 'todos' : kfEl('filtroResponsavelKanban').value;
  return [kfEl('filtroProjetoKanban').value !== 'todos', kfEl('filtroPilarKanban').value !== 'todos', r !== 'todos',
    kfEl('filtroPrioridadeKanban').value !== 'todas', kfPeriodo !== 'todos', !!kfEl('kfDe').value, !!kfEl('kfAte').value].filter(Boolean).length;
}

function kfColunaTemFiltro(c) {
  return !!kfEl(`kfBuscaC-${c}`).value.trim() || kfEl(`kfPrioC-${c}`).value !== 'todas';
}

function kfFinalizar(totalGeral) {
  const qtd = kfQtdFiltrosAtivos();
  const busca = !!kfEl('kfBusca').value.trim();
  const algumFiltro = qtd > 0 || busca || STATUS_TAREFA.some(s => kfColunaTemFiltro(s.coluna));
  let exibidas = 0;
  STATUS_TAREFA.forEach(s => {
    const c = s.coluna, r = kfResumo[c];
    exibidas += r.filtradas;
    kfEl(`kanban-c-${c}`).textContent = r.filtradas === r.total ? r.filtradas : `${r.filtradas} de ${r.total}`;
    const faltam = r.filtradas - r.visiveis;
    kfEl(`kfMais-${c}`).innerHTML = faltam > 0
      ? `<button type="button" onclick="kfMostrarMais('${c}')" class="w-full py-2 bg-white border border-neutral-300 hover:bg-neutral-100 rounded text-[11px] font-bold text-neutral-800">Mostrar mais ${Math.min(KF_PAGINA, faltam)} (faltam ${faltam})</button>`
      : '';
    if (r.filtradas === 0) {
      kfEl(`coluna-k-${c}`).innerHTML = `<p class="text-[11px] text-neutral-500 text-center py-6">${algumFiltro ? 'Nenhuma atividade com este filtro.' : 'Nenhuma atividade.'}</p>`;
    }
  });
  kfEl('kfResultado').textContent = `${exibidas} de ${totalGeral} atividade(s)`;
  kfEl('kfLimpar').classList.toggle('hidden', !algumFiltro);
  kfEl('kfBotaoFiltros').textContent = qtd ? `Filtros (${qtd})` : 'Filtros';
  kfEl('kfPeriodos').querySelectorAll('button').forEach(b => {
    const ativo = b.dataset.periodo === kfPeriodo;
    b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    b.classList.toggle('bg-red-600', ativo);
    b.classList.toggle('text-white', ativo);
    b.classList.toggle('border-red-600', ativo);
    b.classList.toggle('bg-white', !ativo);
    b.classList.toggle('text-neutral-700', !ativo);
    b.classList.toggle('border-neutral-300', !ativo);
  });
}

function kfMudou() {
  kfLimites = {};
  renderizarKanbanGeral();
}

function kfDigitou() {
  clearTimeout(kfTimer);
  kfTimer = setTimeout(kfMudou, 180);
}

function kfEscolherPeriodo(valor) {
  kfPeriodo = valor;
  if (valor !== 'todos') { kfEl('kfDe').value = ''; kfEl('kfAte').value = ''; }
  kfMudou();
}

function kfMudouIntervalo() {
  if (kfEl('kfDe').value || kfEl('kfAte').value) kfPeriodo = 'todos';
  kfMudou();
}

function kfMostrarMais(c) {
  kfLimites[c] = (kfLimites[c] || KF_PAGINA) + KF_PAGINA;
  renderizarKanbanGeral();
}

function kfAlternarPainel() {
  kfEl('kfPainel').classList.toggle('hidden');
}

function kfLimparFiltros() {
  kfEl('kfBusca').value = '';
  kfEl('filtroProjetoKanban').value = 'todos';
  kfEl('filtroPilarKanban').value = 'todos';
  kfEl('filtroResponsavelKanban').value = 'todos';
  kfEl('filtroPrioridadeKanban').value = 'todas';
  kfEl('kfDe').value = '';
  kfEl('kfAte').value = '';
  kfPeriodo = 'todos';
  STATUS_TAREFA.forEach(s => {
    const c = s.coluna;
    kfEl(`kfBuscaC-${c}`).value = '';
    kfEl(`kfPrioC-${c}`).value = 'todas';
    kfEl(`kfOrdemC-${c}`).value = kfEl(`kfOrdemC-${c}`).dataset.padrao;
  });
  kfMudou();
}
