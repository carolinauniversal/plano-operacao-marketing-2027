// Painel ao vivo: gestão das atividades do dia, em tempo real.
// Gestão e diretoria veem a equipe (com filtro por pessoa); o colaborador vê só a si mesmo.
// Fonte: sessões de trabalho (iniciar → pausar/concluir) e anotações de pausa do dia.
// Usa as globais de index.html (sessoes, tarefas, usuarios, usuarioLogado, ...) e de relatorios.js
// (relCard, relGrafico, relTabela, relOpcoes, relBarra, relBarraEmpilhada, relNormalizarMotivo, REL_COR).

const PAV_EXPEDIENTE = { inicio: 8, fim: 18 };     // a linha do tempo se estende se houver trabalho fora dele
const PAV_COR = { ativo: '#dc2626', pausa: '#3f3f46', entre: '#c3c2b7' }; // mesmas cores de "Em Produção" e "Em Pausa" do Kanban
const PAV_ROTULO = { ativo: 'Em atividade', pausa: 'Em pausa', entre: 'Entre atividades' };
const PAV_ENC_PAUSA = new Set(['pausa', 'transferencia', 'bloqueio']);
const PAV_ENC_ENTREGA = { conclusao: 'Concluída', aprovacao: 'Enviada para aprovação' };
const PAV_H = 3600000;

let pavMontado = false;
let pavDia = '';
let pavPessoa = 'todos';
let pavAnot = { dia: null, lista: [], erro: null };
let pavTicker = null;

const pavEl = id => document.getElementById(id);
const pavGestao = () => usuarioLogado.role !== 'colaborador';
const pavHora = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const pavDuracao = ms => fmtHoras(ms / PAV_H);
const pavEhHoje = () => pavDia === dataLocalISO();
function pavInicioDia(iso) { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); }
function pavMaisDias(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function pavAlvo() {
  return pavEl(usuarioLogado && usuarioLogado.role === 'colaborador' ? 'colab-tela-aovivo' : 'gestor-secao-aovivo');
}
function pavVisivel() {
  const el = usuarioLogado && pavAlvo();
  return !!el && !el.classList.contains('hidden');
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------
function pavPessoasEscopo(d0, d1) {
  if (!pavGestao()) return [usuarioLogado.id];
  if (pavPessoa !== 'todos') return [pavPessoa];
  const ids = new Set(usuarios
    .filter(u => u.status === 'ativo' && !u.solicitacao_pendente && u.role !== 'diretoria'
      && (u.role === 'colaborador' || tarefas.some(t => t.colaboradorId === u.id && t.status !== 'Concluído')))
    .map(u => u.id));
  sessoes.forEach(s => {
    const ini = Date.parse(s.inicio), fim = s.fim ? Date.parse(s.fim) : Date.now();
    if (fim > d0.getTime() && ini < d1.getTime()) ids.add(s.colaboradorId);
  });
  return [...ids];
}

function pavNota(s, tipo) {
  if (!s.fim) return null;
  const fim = Date.parse(s.fim);
  return pavAnot.lista.find(a => a.tipo === tipo && a.tarefa_id === s.tarefaId && Math.abs(Date.parse(a.criado_em) - fim) <= 120000) || null;
}
const pavMotivo = s => { const n = pavNota(s, 'pausa'); return n ? n.texto.replace(/\s*\(registrado pela gestão[^)]*\)\s*$/i, '') : ''; };

// Segmentos do dia de uma pessoa: em atividade (sessões), em pausa (após pausar) e entre atividades
function pavDiaDaPessoa(id, d0) {
  const d1 = pavMaisDias(d0, 1);
  const hoje = dataLocalISO(d0) === dataLocalISO();
  const agora = Math.min(Date.now(), d1.getTime());
  const fimExp = new Date(d0); fimExp.setHours(PAV_EXPEDIENTE.fim, 0, 0, 0);
  const doDia = sessoes.filter(s => s.colaboradorId === id)
    .map(s => ({ s, ini: Math.max(Date.parse(s.inicio), d0.getTime()), fim: Math.min(s.fim ? Date.parse(s.fim) : agora, d1.getTime(), agora) }))
    .filter(x => x.fim > x.ini)
    .sort((a, b) => a.ini - b.ini);

  const r = { id, segs: [], ativo: 0, pausa: 0, entre: 0, sessoes: doDia.length, pausas: [], entregas: [], estado: 'sem_inicio', atual: null, desde: null, ultima: null };
  doDia.forEach((x, i) => {
    r.segs.push({ tipo: 'ativo', ini: x.ini, fim: x.fim, s: x.s });
    r.ativo += x.fim - x.ini;
    if (!x.s.fim) return;
    const prox = doDia[i + 1];
    // Intervalo até a próxima sessão; depois da última, só hoje e até o fim do expediente (ou agora)
    const ate = prox ? prox.ini : (hoje ? Math.max(x.fim, Math.min(agora, Math.max(fimExp.getTime(), x.fim))) : x.fim);
    if (ate > x.fim) {
      const tipo = PAV_ENC_PAUSA.has(x.s.encerramento) ? 'pausa' : 'entre';
      r.segs.push({ tipo, ini: x.fim, fim: ate, s: x.s, aberto: !prox });
      r[tipo] += ate - x.fim;
    }
  });

  sessoes.filter(s => s.colaboradorId === id && s.fim).forEach(s => {
    const fim = Date.parse(s.fim);
    if (fim < d0.getTime() || fim >= d1.getTime()) return;
    if (s.encerramento === 'pausa') r.pausas.push(s);
    if (PAV_ENC_ENTREGA[s.encerramento]) r.entregas.push(s);
  });

  const ultima = doDia[doDia.length - 1];
  if (ultima) {
    r.ultima = ultima.s;
    if (!ultima.s.fim) { r.estado = 'producao'; r.atual = ultima.s; r.desde = Date.parse(ultima.s.inicio); }
    else { r.estado = PAV_ENC_PAUSA.has(ultima.s.encerramento) ? 'pausa' : 'livre'; r.desde = Date.parse(ultima.s.fim); }
  }
  const total = r.ativo + r.pausa + r.entre;
  r.pctAtivo = total >= 15 * 60000 ? (r.ativo / total) * 100 : null;
  return r;
}

function pavCalcular() {
  const d0 = pavInicioDia(pavDia), d1 = pavMaisDias(d0, 1);
  const ids = pavPessoasEscopo(d0, d1);
  const pessoas = ids.map(id => pavDiaDaPessoa(id, d0));
  const soma = campo => pessoas.reduce((s, p) => s + (Array.isArray(p[campo]) ? p[campo].length : p[campo]), 0);
  return { d0, d1, ids, pessoas, ativo: soma('ativo'), pausa: soma('pausa'), entre: soma('entre'), nPausas: soma('pausas'), nEntregas: soma('entregas') };
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------
function pavMontar() {
  const gestao = pavGestao();
  const sel = 'border border-neutral-300 rounded p-1.5 text-xs font-medium outline-none focus:ring-1 focus:ring-red-600 bg-white';
  pavAlvo().innerHTML = `
    <div class="glass-card rounded-xl border border-neutral-200 p-4 flex flex-wrap justify-between items-end gap-3">
      <div class="min-w-0">
        <h2 class="text-lg font-black text-neutral-900">${gestao ? 'Painel ao vivo da equipe' : 'Meu desempenho'}</h2>
        <p id="pav-status" class="text-xs text-neutral-500" aria-live="polite"></p>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        ${gestao ? `<label class="text-[11px] font-bold uppercase text-neutral-600">Pessoa<br><select id="pav-pessoa" class="${sel} mt-1" onchange="pavMudouFiltro()"></select></label>` : ''}
        <label class="text-[11px] font-bold uppercase text-neutral-600">Dia<br><input type="date" id="pav-dia" class="${sel} mt-1" onchange="pavMudouFiltro()"></label>
        <button type="button" id="pav-btn-hoje" onclick="pavIrHoje()" class="px-3 py-1.5 border border-neutral-300 rounded text-xs font-bold hover:bg-neutral-100">Hoje</button>
      </div>
    </div>

    <div id="pav-tiles" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>

    ${gestao ? `
    <article id="pav-card-agora" class="bg-white rounded-xl border border-neutral-200 p-4 space-y-3">
      <header><h4 class="text-sm font-black text-neutral-900">Agora</h4>
        <p class="text-[11px] text-neutral-500">O que cada pessoa está fazendo neste momento. Em produção primeiro, depois em pausa.</p></header>
      <div id="pav-agora" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3"></div>
    </article>` : ''}

    <article class="bg-white rounded-xl border border-neutral-200 p-4 space-y-3 min-w-0">
      <header class="flex flex-wrap justify-between items-end gap-2">
        <div><h4 class="text-sm font-black text-neutral-900">Linha do tempo do dia</h4>
          <p class="text-[11px] text-neutral-500">Cada faixa é uma pessoa. Passe o mouse (ou toque) num trecho para ver a atividade ou o motivo da pausa.</p></div>
        <div class="flex flex-wrap gap-3 text-[11px] text-neutral-700">
          ${Object.keys(PAV_COR).map(k => `<span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm" style="background:${PAV_COR[k]}"></span>${PAV_ROTULO[k]}</span>`).join('')}
        </div>
      </header>
      <div id="pav-linha" class="space-y-2"></div>
      <p id="pav-linha-toque" class="text-[11px] text-neutral-700 min-h-[1rem]"></p>
    </article>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      ${gestao ? relCard('pav-pessoas', 'Atividade × pausa por pessoa', 'Horas do dia em atividade, em pausa e entre atividades.', { altura: 240 }) : ''}
      ${relCard('pav-motivos', 'Motivos de pausa', 'Quantas vezes cada motivo foi informado ao pausar, no dia.', { altura: 240 })}
      ${relCard('pav-horas', 'Horas em atividade por horário', 'Em que horários do dia o trabalho aconteceu.', { altura: 220 })}
      ${relCard('pav-semana', gestao ? 'Últimos 7 dias' : 'Meus últimos 7 dias', 'Horas em atividade e em pausa por dia, até o dia escolhido.', { altura: 220 })}
      ${relCard('pav-pausas', 'Pausas do dia', 'Cada pausa, com o motivo e quanto tempo durou.', { grafico: false, largura: 'lg:col-span-2' })}
      ${relCard('pav-entregas', 'Entregas do dia', 'Atividades concluídas ou enviadas para aprovação no dia.', { grafico: false, largura: gestao ? '' : 'lg:col-span-2' })}
      ${gestao ? relCard('pav-quadro', 'Quadro do dia por pessoa', 'Resumo de cada pessoa: tempo, pausas, ritmo e entregas.', { grafico: false }) : ''}
    </div>
    <p class="text-[10px] text-neutral-400 pb-4">"Em pausa" é o tempo entre pausar e retomar; "entre atividades" é o intervalo depois de concluir até iniciar a próxima. Depois da última sessão, o intervalo conta até ${PAV_EXPEDIENTE.fim}h. % em atividade = tempo em atividade ÷ (atividade + pausa + entre atividades), a partir do primeiro início do dia.</p>`;
  pavMontado = true;
}

// ---------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------
async function pavAbrir() {
  if (!pavMontado) pavMontar();
  if (!pavDia) pavDia = dataLocalISO();
  pavEl('pav-dia').value = pavDia;
  pavEl('pav-dia').max = dataLocalISO();
  if (pavGestao()) pavPreencherPessoas();
  pavRenderizar();
  await pavCarregarAnotacoes();
  pavRenderizar();
  if (!pavTicker) pavTicker = setInterval(pavTique, 30000);
}

// Ao sair: descarta o painel montado (o próximo login pode ser de outro perfil)
function pavLimpar() {
  ['colab-tela-aovivo', 'gestor-secao-aovivo'].forEach(id => { const el = pavEl(id); if (el) el.innerHTML = ''; });
  Object.keys(relEstado.graficos).filter(k => k.startsWith('pav-')).forEach(k => { relEstado.graficos[k].destroy(); delete relEstado.graficos[k]; });
  clearInterval(pavTicker);
  pavTicker = null;
  pavMontado = false;
  pavDia = '';
  pavPessoa = 'todos';
  pavAnot = { dia: null, lista: [], erro: null };
}

// Chamado pelo tempo real (tempo-real.js) depois de recarregar os dados
async function pavAoAtualizarDados() {
  if (!pavMontado || !pavVisivel()) return;
  if (pavGestao()) pavPreencherPessoas();
  await pavCarregarAnotacoes();
  if (pavVisivel()) pavRenderizar();
}

function pavTique() {
  if (!pavMontado || !pavVisivel() || document.hidden || !pavEhHoje()) return;
  if (typeof rtJanelaAberta === 'function' && rtJanelaAberta()) return;
  pavRenderizar();
}

async function pavMudouFiltro() {
  pavDia = pavEl('pav-dia').value || dataLocalISO();
  if (pavGestao()) pavPessoa = pavEl('pav-pessoa').value;
  pavRenderizar();
  await pavCarregarAnotacoes();
  pavRenderizar();
}

function pavIrHoje() {
  pavEl('pav-dia').value = dataLocalISO();
  pavMudouFiltro();
}

function pavPreencherPessoas() {
  const sel = pavEl('pav-pessoa');
  const ids = new Set(usuarios.filter(u => u.role !== 'diretoria' && !u.solicitacao_pendente
    && (u.role === 'colaborador' || tarefas.some(t => t.colaboradorId === u.id))).map(u => u.id));
  sessoes.forEach(s => ids.add(s.colaboradorId));
  sel.innerHTML = '<option value="todos">Toda a equipe</option>' + [...ids]
    .map(id => ({ id, nome: nomeUsuario(id) })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .map(u => `<option value="${u.id}">${escaparHtml(u.nome)}</option>`).join('');
  sel.value = ids.has(pavPessoa) ? pavPessoa : 'todos';
  pavPessoa = sel.value;
}

async function pavCarregarAnotacoes() {
  const dia = pavDia;
  const d0 = pavInicioDia(dia), d1 = pavMaisDias(d0, 1);
  const { data, error } = await clienteSupabase.from('tarefa_anotacoes')
    .select('tarefa_id,autor_id,tipo,texto,criado_em')
    .in('tipo', ['pausa', 'sem_atividade'])
    .gte('criado_em', d0.toISOString())
    .lt('criado_em', d1.toISOString());
  if (dia !== pavDia) return;
  pavAnot = { dia, lista: error ? [] : (data || []), erro: error ? mensagemErro(error) : null };
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------
function pavRenderizar() {
  if (!pavMontado || !usuarioLogado) return;
  const C = pavCalcular();
  const hoje = pavEhHoje();
  pavEl('pav-status').innerHTML = hoje
    ? `<span class="inline-flex items-center gap-1.5 font-bold text-red-700"><span class="w-2 h-2 rounded-full bg-red-600 animate-pulse"></span>Ao vivo</span> · atualizado às ${new Date().toLocaleTimeString('pt-BR')}${pavAnot.erro ? ' · motivos de pausa indisponíveis' : ''}`
    : `Dia ${C.d0.toLocaleDateString('pt-BR')} (encerrado)`;
  pavEl('pav-btn-hoje').classList.toggle('hidden', hoje);

  const etapas = [pavTiles, pavAgora, pavLinhaDoTempo, pavGraficoPessoas, pavGraficoMotivos, pavGraficoHoras, pavGraficoSemana, pavTabelaPausas, pavTabelaEntregas, pavQuadro];
  etapas.forEach(f => { try { f(C, hoje); } catch (e) { console.error('Painel ao vivo:', f.name, e); } });
}

function pavTile(rotulo, valor, detalhe, status = null, cor = null) {
  return `
    <div class="bg-white rounded-xl border border-neutral-200 p-3 ${cor ? 'border-l-4' : ''}" ${cor ? `style="border-left-color:${cor}"` : ''}>
      <p class="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">${rotulo}</p>
      <p class="text-2xl font-black text-neutral-900 leading-tight mt-1 break-words">${valor}</p>
      <p class="text-[10px] text-neutral-500 mt-0.5">${detalhe}</p>
      ${status ? `<p class="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-neutral-800"><span class="w-2 h-2 rounded-full" style="background:${status.cor}"></span>${status.icone} ${status.texto}</p>` : ''}
    </div>`;
}

function pavStatusRitmo(pct) {
  if (pct == null) return null;
  if (pct >= 75) return { cor: REL_COR.bom, icone: '✓', texto: 'Bom ritmo' };
  if (pct >= 50) return { cor: REL_COR.alerta, icone: '!', texto: 'Atenção' };
  return { cor: REL_COR.critico, icone: '▲', texto: 'Muito tempo parado' };
}

function pavTiles(C, hoje) {
  const total = C.ativo + C.pausa + C.entre;
  const pct = total >= 15 * 60000 ? (C.ativo / total) * 100 : null;
  const pausadasHoje = new Set(C.pessoas.flatMap(p => p.pausas.map(s => s.tarefaId))).size;
  const concluidas = C.pessoas.reduce((s, p) => s + p.entregas.filter(x => x.encerramento === 'conclusao').length, 0);
  const tiles = [];

  if (pavGestao()) {
    const emProducao = C.pessoas.filter(p => p.estado === 'producao').length;
    const emPausaAgora = C.pessoas.filter(p => p.estado === 'pausa').length;
    const doEscopo = t => C.ids.includes(t.colaboradorId);
    const aprovacao = tarefas.filter(t => doEscopo(t) && t.status === 'Aprovação').length;
    const atrasadas = tarefas.filter(t => doEscopo(t) && t.status !== 'Concluído' && terminoEsperado(t) < new Date()).length;
    if (hoje) {
      tiles.push(pavTile('Em produção agora', `${emProducao}<span class="text-sm text-neutral-400"> / ${C.ids.length}</span>`, `${emPausaAgora} em pausa · ${C.ids.length - emProducao - emPausaAgora} sem atividade`, null, PAV_COR.ativo));
    } else {
      tiles.push(pavTile('Pessoas com atividade', `${C.pessoas.filter(p => p.sessoes).length}<span class="text-sm text-neutral-400"> / ${C.ids.length}</span>`, 'registraram tempo no dia', null, PAV_COR.ativo));
    }
    tiles.push(
      pavTile('Entregas do dia', relFmtInt(C.nEntregas), `${concluidas} concluída(s) · ${C.nEntregas - concluidas} para aprovação`, null, REL_COR.bom),
      pavTile('Pausas no dia', relFmtInt(C.nPausas), `em ${pausadasHoje} atividade(s)`, null, PAV_COR.pausa),
      pavTile('% do tempo em atividade', relFmtPct(pct), `${pavDuracao(C.ativo)} ativas · ${pavDuracao(C.pausa)} em pausa`, pavStatusRitmo(pct)),
      pavTile('Horas em atividade', pavDuracao(C.ativo), `média de ${pavDuracao(C.pessoas.filter(p => p.sessoes).length ? C.ativo / C.pessoas.filter(p => p.sessoes).length : 0)} por pessoa ativa`),
      pavTile('Tempo em pausa', pavDuracao(C.pausa), `${pavDuracao(C.entre)} entre atividades`),
      pavTile('Aguardando aprovação', relFmtInt(aprovacao), aprovacao ? 'atividades esperando a gestão' : 'nada pendente', null, aprovacao ? REL_COR.alerta : null),
      pavTile('Atrasadas em aberto', relFmtInt(atrasadas), atrasadas ? 'término previsto já passou' : 'nenhum atraso', null, atrasadas ? REL_COR.critico : null)
    );
  } else {
    const p = C.pessoas[0];
    const minhas = tarefas.filter(t => t.colaboradorId === usuarioLogado.id);
    const fimDia = pavMaisDias(C.d0, 1);
    const paraHoje = minhas.filter(t => t.status !== 'Concluído' && t.status !== 'Aprovação' && terminoEsperado(t) < fimDia).length;
    const media = p.sessoes ? p.ativo / p.sessoes : 0;
    const situacao = !hoje ? { v: 'Dia encerrado', d: `${p.sessoes} sessão(ões) de trabalho` }
      : p.estado === 'producao' ? { v: 'Em produção', d: escaparHtml(pavTituloTarefa(p.atual.tarefaId)) }
      : p.estado === 'pausa' ? { v: 'Em pausa', d: `há ${pavDuracao(Date.now() - p.desde)}` }
      : p.estado === 'livre' ? { v: 'Sem atividade', d: `desde ${pavHora(p.desde)}` }
      : { v: 'Não iniciou', d: 'nenhuma sessão hoje' };
    tiles.push(
      pavTile('Situação agora', situacao.v, situacao.d, null, hoje && p.estado === 'producao' ? PAV_COR.ativo : PAV_COR.pausa),
      pavTile('% do tempo em atividade', relFmtPct(p.pctAtivo), 'do primeiro início do dia até agora', pavStatusRitmo(p.pctAtivo)),
      pavTile('Horas em atividade', pavDuracao(p.ativo), `${p.sessoes} sessão(ões) de trabalho`, null, PAV_COR.ativo),
      pavTile('Tempo em pausa', pavDuracao(p.pausa), `${pavDuracao(p.entre)} entre atividades`, null, PAV_COR.pausa),
      pavTile('Pausas no dia', relFmtInt(p.pausas.length), `em ${pausadasHoje} atividade(s)`),
      pavTile('Entregas do dia', relFmtInt(p.entregas.length), `${concluidas} concluída(s)`, null, REL_COR.bom),
      pavTile('Foco médio', pavDuracao(media), 'tempo médio contínuo por sessão'),
      pavTile('Ainda para hoje', relFmtInt(paraHoje), paraHoje ? 'atividades com término até hoje' : 'nada pendente para hoje')
    );
  }
  pavEl('pav-tiles').innerHTML = tiles.join('');
}

function pavTituloTarefa(id) {
  const t = tarefas.find(x => x.id === id);
  return t ? t.titulo : 'Atividade';
}

const PAV_ESTADO = {
  producao: { rotulo: 'Em produção', cor: PAV_COR.ativo, ordem: 0 },
  pausa: { rotulo: 'Em pausa', cor: PAV_COR.pausa, ordem: 1 },
  livre: { rotulo: 'Sem atividade', cor: PAV_COR.entre, ordem: 2 },
  sem_inicio: { rotulo: 'Não iniciou hoje', cor: '#e5e5e5', ordem: 3 }
};

function pavMiniBarra(p) {
  const total = p.ativo + p.pausa + p.entre;
  if (!total) return '';
  return `<div class="flex h-1.5 rounded overflow-hidden bg-neutral-100" title="${PAV_ROTULO.ativo} ${pavDuracao(p.ativo)} · ${PAV_ROTULO.pausa} ${pavDuracao(p.pausa)} · ${PAV_ROTULO.entre} ${pavDuracao(p.entre)}">
    ${['ativo', 'pausa', 'entre'].map(k => p[k] ? `<div style="width:${(p[k] / total) * 100}%;background:${PAV_COR[k]}"></div>` : '').join('')}</div>`;
}

function pavAgora(C, hoje) {
  const card = pavEl('pav-card-agora');
  if (!card) return;
  card.classList.toggle('hidden', !hoje);
  if (!hoje) return;
  const ordenadas = [...C.pessoas].sort((a, b) => PAV_ESTADO[a.estado].ordem - PAV_ESTADO[b.estado].ordem || nomeUsuario(a.id).localeCompare(nomeUsuario(b.id), 'pt-BR'));
  pavEl('pav-agora').innerHTML = ordenadas.map(p => {
    const e = PAV_ESTADO[p.estado];
    let corpo = '';
    if (p.estado === 'producao') {
      corpo = `<button type="button" onclick="abrirDetalheTarefa('${p.atual.tarefaId}')" class="text-xs font-bold text-neutral-900 hover:text-red-600 hover:underline text-left break-words">${escaparHtml(pavTituloTarefa(p.atual.tarefaId))}</button>
        <p class="text-[11px] text-neutral-600">Nesta sessão: <strong class="font-mono tabular-nums text-red-700" data-cronometro="${p.atual.inicio}">${fmtCronometro(p.atual.inicio)}</strong> · desde ${pavHora(p.desde)}</p>`;
    } else if (p.estado === 'pausa') {
      const motivo = pavMotivo(p.ultima);
      corpo = `<p class="text-[11px] text-neutral-700">Em pausa há <strong>${pavDuracao(Date.now() - p.desde)}</strong> (desde ${pavHora(p.desde)})</p>
        ${motivo ? `<p class="text-[11px] text-neutral-900 break-words">Motivo: <strong>${escaparHtml(motivo)}</strong></p>` : ''}
        <button type="button" onclick="abrirDetalheTarefa('${p.ultima.tarefaId}')" class="text-[11px] text-neutral-500 hover:text-red-600 hover:underline text-left break-words">${escaparHtml(pavTituloTarefa(p.ultima.tarefaId))}</button>`;
    } else if (p.estado === 'livre') {
      corpo = `<p class="text-[11px] text-neutral-700">Sem atividade em produção desde <strong>${pavHora(p.desde)}</strong> (${pavDuracao(Date.now() - p.desde)})</p>
        <p class="text-[11px] text-neutral-500 break-words">Última: ${escaparHtml(pavTituloTarefa(p.ultima.tarefaId))} (${PAV_ENC_ENTREGA[p.ultima.encerramento] ? PAV_ENC_ENTREGA[p.ultima.encerramento].toLowerCase() : 'encerrada'})</p>`;
    } else {
      const abertas = tarefas.filter(t => t.colaboradorId === p.id && (t.status === 'A Fazer' || t.status === 'Em Pausa')).length;
      corpo = `<p class="text-[11px] text-neutral-500">Nenhuma sessão de trabalho hoje · ${abertas} atividade(s) a fazer ou em pausa</p>`;
    }
    return `
      <div class="p-3 rounded-lg border border-neutral-200 border-l-4 bg-white space-y-1.5 min-w-0" style="border-left-color:${e.cor}">
        <div class="flex justify-between items-center gap-2">
          <strong class="text-xs text-neutral-900 truncate">${escaparHtml(nomeUsuario(p.id))}</strong>
          <span class="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-neutral-700"><span class="w-2 h-2 rounded-full" style="background:${e.cor}"></span>${e.rotulo}</span>
        </div>
        ${corpo}
        ${pavMiniBarra(p)}
        <p class="text-[10px] text-neutral-500">Hoje: ${pavDuracao(p.ativo)} em atividade · ${p.pausas.length} pausa(s) · ${p.entregas.length} entrega(s)</p>
      </div>`;
  }).join('') || '<p class="text-xs text-neutral-400">Ninguém na equipe para mostrar.</p>';
}

function pavLinhaDoTempo(C, hoje) {
  const alvo = pavEl('pav-linha');
  const comSegs = C.pessoas.filter(p => p.segs.length);
  let hIni = PAV_EXPEDIENTE.inicio, hFim = PAV_EXPEDIENTE.fim;
  const base = C.d0.getTime();
  comSegs.forEach(p => p.segs.forEach(s => {
    hIni = Math.min(hIni, Math.floor((s.ini - base) / PAV_H));
    hFim = Math.max(hFim, Math.ceil((s.fim - base) / PAV_H));
  }));
  if (hoje) hFim = Math.max(hFim, Math.min(24, Math.ceil((Date.now() - base) / PAV_H)));
  hFim = Math.min(24, hFim);
  const ini = base + hIni * PAV_H, span = (hFim - hIni) * PAV_H;
  const pct = t => Math.max(0, Math.min(100, ((t - ini) / span) * 100));
  const passo = (hFim - hIni) > 12 ? 2 : 1;
  const marcas = [];
  for (let h = hIni; h <= hFim; h += passo) marcas.push(h);
  const linhaAgora = hoje ? `<div class="absolute top-0 bottom-0 w-0.5 bg-red-600" style="left:${pct(Date.now())}%" title="Agora"></div>` : '';

  const ordenadas = [...C.pessoas].sort((a, b) => (b.segs.length ? 1 : 0) - (a.segs.length ? 1 : 0) || nomeUsuario(a.id).localeCompare(nomeUsuario(b.id), 'pt-BR'));
  const linhas = ordenadas.map(p => {
    const trechos = p.segs.map(s => {
      const titulo = s.tipo === 'ativo'
        ? `${PAV_ROTULO.ativo} ${pavHora(s.ini)}–${pavHora(s.fim)} (${pavDuracao(s.fim - s.ini)}) · ${pavTituloTarefa(s.s.tarefaId)}`
        : `${PAV_ROTULO[s.tipo]} ${pavHora(s.ini)}–${s.aberto && hoje && s.fim >= Date.now() - 60000 ? 'agora' : pavHora(s.fim)} (${pavDuracao(s.fim - s.ini)})${s.tipo === 'pausa' && pavMotivo(s.s) ? ' · Motivo: ' + pavMotivo(s.s) : ''}`;
      return `<button type="button" class="absolute top-0 bottom-0 border-l border-white focus:outline-none focus:ring-2 focus:ring-black" style="left:${pct(s.ini)}%;width:${Math.max(0.35, pct(s.fim) - pct(s.ini))}%;background:${PAV_COR[s.tipo]}" title="${escaparHtml(titulo)}" aria-label="${escaparHtml(titulo)}" onclick="pavMostrarTrecho(this)"></button>`;
    }).join('');
    const e = PAV_ESTADO[hoje ? p.estado : (p.segs.length ? 'livre' : 'sem_inicio')];
    return `
      <div class="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-1 sm:gap-3 items-center">
        <div class="flex items-center gap-1.5 min-w-0 text-[11px]">
          ${hoje ? `<span class="w-2 h-2 rounded-full shrink-0" style="background:${e.cor}" title="${e.rotulo}"></span>` : ''}
          <span class="font-bold text-neutral-900 truncate">${escaparHtml(nomeUsuario(p.id))}</span>
          <span class="text-neutral-500 shrink-0">${pavDuracao(p.ativo)}</span>
        </div>
        <div class="relative h-6 rounded bg-neutral-100 overflow-hidden">
          ${trechos || '<span class="absolute inset-0 flex items-center px-2 text-[10px] text-neutral-400">Sem sessões de trabalho no dia</span>'}
          ${linhaAgora}
        </div>
      </div>`;
  }).join('');

  const eixo = `
    <div class="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-1 sm:gap-3">
      <div class="hidden sm:block"></div>
      <div class="relative h-4 text-[10px] text-neutral-500">
        ${marcas.map(h => `<span class="absolute -translate-x-1/2" style="left:${pct(base + h * PAV_H)}%">${String(h).padStart(2, '0')}h</span>`).join('')}
      </div>
    </div>`;
  alvo.innerHTML = C.pessoas.length ? linhas + eixo : '<p class="text-xs text-neutral-400">Ninguém para mostrar no filtro escolhido.</p>';
}

// No celular não há "passar o mouse": o toque mostra o detalhe abaixo da linha do tempo
function pavMostrarTrecho(el) {
  pavEl('pav-linha-toque').textContent = el.getAttribute('title');
}

// Sem animação: o painel se redesenha a cada 30 s e não deve "piscar"
function pavOpcoes(cfg) { return { ...relOpcoes(cfg), animation: false }; }

function pavGraficoPessoas(C) {
  if (!pavGestao()) return;
  const lista = C.pessoas.filter(p => p.segs.length).sort((a, b) => b.ativo - a.ativo);
  const h = ms => Math.round((ms / PAV_H) * 100) / 100 || null;
  relAltura('pav-pessoas', relAlturaHorizontal(lista.length, 160));
  relGrafico('pav-pessoas', {
    data: {
      labels: lista.map(p => relCurto(nomeUsuario(p.id), 24)),
      datasets: ['ativo', 'pausa', 'entre'].map(k => relBarraEmpilhada(PAV_ROTULO[k], lista.map(p => h(p[k])), PAV_COR[k]))
    },
    options: pavOpcoes({ horizontal: true, empilhado: true, eixo: v => `${v}h`, valor: fmtHoras, rotulos: { total: true, formato: v => fmtHoras(v) } })
  }, lista.length === 0);
  relTabela('pav-pessoas', [{ rotulo: 'Pessoa' }, { rotulo: PAV_ROTULO.ativo, direita: true }, { rotulo: PAV_ROTULO.pausa, direita: true }, { rotulo: PAV_ROTULO.entre, direita: true }, { rotulo: '% em atividade', direita: true }],
    lista.map(p => [nomeUsuario(p.id), { t: pavDuracao(p.ativo), v: p.ativo / PAV_H }, { t: pavDuracao(p.pausa), v: p.pausa / PAV_H }, { t: pavDuracao(p.entre), v: p.entre / PAV_H }, { t: relFmtPct(p.pctAtivo), v: p.pctAtivo }]));
}

function pavPausasDoDia(C) {
  return C.pessoas.flatMap(p => p.pausas.map(s => {
    const fim = Date.parse(s.fim);
    const prox = sessoes.filter(x => x.colaboradorId === p.id && Date.parse(x.inicio) >= fim).sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio))[0];
    const semNova = pavNota(s, 'sem_atividade');
    return { p, s, fim, retomada: prox ? Date.parse(prox.inicio) : null, motivo: pavMotivo(s), semNova: semNova ? semNova.texto : '' };
  })).sort((a, b) => a.fim - b.fim);
}

function pavGraficoMotivos(C) {
  const pausas = pavPausasDoDia(C);
  const mapa = new Map();
  pausas.forEach(x => { const m = x.motivo ? relNormalizarMotivo(x.motivo) : '(motivo não encontrado)'; mapa.set(m, (mapa.get(m) || 0) + 1); });
  const top = relTopN(mapa, 8);
  relAltura('pav-motivos', relAlturaHorizontal(top.length, 160));
  relGrafico('pav-motivos', {
    data: { labels: top.map(([m]) => relCurto(m, window.innerWidth < 640 ? 18 : 34)), datasets: [relBarra('Pausas', top.map(([, n]) => n), PAV_COR.pausa)] },
    options: pavOpcoes({ horizontal: true, legenda: false, eixo: v => Number.isInteger(v) ? v : '', valor: v => `${v} pausa(s)`, rotulos: { formato: v => relFmtInt(v) } })
  }, top.length === 0);
  relTabela('pav-motivos', [{ rotulo: 'Motivo' }, { rotulo: 'Pausas', direita: true }], top.map(([m, n]) => [m, n]), { vazio: 'Nenhuma pausa no dia.' });
}

function pavGraficoHoras(C) {
  const porHora = Array(24).fill(0);
  C.pessoas.forEach(p => p.segs.filter(s => s.tipo === 'ativo').forEach(s => {
    let a = s.ini;
    while (a < s.fim) {
      const d = new Date(a);
      const prox = new Date(d); prox.setMinutes(60, 0, 0);
      const ate = Math.min(prox.getTime(), s.fim);
      porHora[d.getHours()] += (ate - a) / PAV_H;
      a = ate;
    }
  }));
  const usadas = porHora.map((v, h) => ({ v, h })).filter(x => x.v > 0).map(x => x.h);
  const de = Math.min(PAV_EXPEDIENTE.inicio, ...usadas), ate = Math.max(PAV_EXPEDIENTE.fim - 1, ...usadas);
  const horas = []; for (let h = de; h <= ate; h++) horas.push(h);
  relGrafico('pav-horas', {
    data: { labels: horas.map(h => `${String(h).padStart(2, '0')}h`), datasets: [relBarra(PAV_ROTULO.ativo, horas.map(h => Math.round(porHora[h] * 100) / 100), PAV_COR.ativo, { maxBarThickness: 20 })] },
    options: pavOpcoes({ legenda: false, eixo: v => `${v}h`, valor: fmtHoras })
  }, usadas.length === 0);
  relTabela('pav-horas', [{ rotulo: 'Horário' }, { rotulo: 'Horas em atividade', direita: true }],
    horas.filter(h => porHora[h] > 0).map(h => [`${String(h).padStart(2, '0')}h–${String(h + 1).padStart(2, '0')}h`, { t: fmtHoras(porHora[h]), v: porHora[h] }]));
}

function pavGraficoSemana(C) {
  const dias = [];
  for (let i = 6; i >= 0; i--) {
    const d0 = pavMaisDias(C.d0, -i);
    const ids = pavPessoasEscopo(d0, pavMaisDias(d0, 1));
    const ps = ids.map(id => pavDiaDaPessoa(id, d0));
    dias.push({ d0, ativo: ps.reduce((s, p) => s + p.ativo, 0), pausa: ps.reduce((s, p) => s + p.pausa, 0), pausas: ps.reduce((s, p) => s + p.pausas.length, 0), entregas: ps.reduce((s, p) => s + p.entregas.length, 0) });
  }
  const rotulo = d => d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '');
  const h = ms => Math.round((ms / PAV_H) * 100) / 100 || null;
  relGrafico('pav-semana', {
    data: { labels: dias.map(x => rotulo(x.d0)), datasets: [relBarraEmpilhada(PAV_ROTULO.ativo, dias.map(x => h(x.ativo)), PAV_COR.ativo), relBarraEmpilhada(PAV_ROTULO.pausa, dias.map(x => h(x.pausa)), PAV_COR.pausa)] },
    options: pavOpcoes({ empilhado: true, eixo: v => `${v}h`, valor: fmtHoras, rotulos: { total: true, formato: v => fmtHoras(v) } })
  }, dias.every(x => !x.ativo && !x.pausa));
  relTabela('pav-semana', [{ rotulo: 'Dia' }, { rotulo: PAV_ROTULO.ativo, direita: true }, { rotulo: PAV_ROTULO.pausa, direita: true }, { rotulo: '% em atividade', direita: true }, { rotulo: 'Pausas', direita: true }, { rotulo: 'Entregas', direita: true }],
    dias.map(x => [rotulo(x.d0), { t: pavDuracao(x.ativo), v: x.ativo / PAV_H }, { t: pavDuracao(x.pausa), v: x.pausa / PAV_H }, relFmtPct(relPct(x.ativo, x.ativo + x.pausa)), x.pausas, x.entregas]));
}

function pavTabelaPausas(C, hoje) {
  const gestao = pavGestao();
  const linhas = pavPausasDoDia(C).map(x => {
    const ate = x.retomada || (hoje ? Date.now() : null);
    return [
      pavHora(x.fim), ...(gestao ? [nomeUsuario(x.p.id)] : []), pavTituloTarefa(x.s.tarefaId),
      x.motivo || '—',
      { t: ate ? pavDuracao(ate - x.fim) + (x.retomada ? '' : ' (em andamento)') : '—', v: ate ? (ate - x.fim) / PAV_H : null, cls: x.retomada ? '' : 'font-bold' },
      x.semNova || '—'
    ];
  }).reverse();
  relTabela('pav-pausas', [{ rotulo: 'Hora' }, ...(gestao ? [{ rotulo: 'Pessoa' }] : []), { rotulo: 'Atividade' }, { rotulo: 'Motivo' }, { rotulo: 'Duração', direita: true }, { rotulo: 'Por que não iniciou outra' }],
    linhas, { vazio: 'Nenhuma pausa no dia.' });
}

function pavTabelaEntregas(C) {
  const gestao = pavGestao();
  const hojeIso = pavDia;
  const linhas = C.pessoas.flatMap(p => p.entregas.map(s => ({ p, s, fim: Date.parse(s.fim), t: tarefas.find(x => x.id === s.tarefaId) })))
    .sort((a, b) => b.fim - a.fim)
    .map(x => [pavHora(x.fim), ...(gestao ? [nomeUsuario(x.p.id)] : []), x.t ? x.t.titulo : 'Atividade', PAV_ENC_ENTREGA[x.s.encerramento],
      x.t ? { t: x.t.prazo >= hojeIso ? '✓ No prazo' : '▲ Fora do prazo', v: x.t.prazo >= hojeIso ? 'no prazo' : 'fora do prazo', cls: x.t.prazo >= hojeIso ? 'text-emerald-700 font-bold' : 'text-red-700 font-bold' } : '—']);
  relTabela('pav-entregas', [{ rotulo: 'Hora' }, ...(gestao ? [{ rotulo: 'Pessoa' }] : []), { rotulo: 'Atividade' }, { rotulo: 'Entrega' }, { rotulo: 'Prazo' }],
    linhas, { vazio: 'Nenhuma entrega no dia.' });
}

function pavQuadro(C, hoje) {
  if (!pavGestao()) return;
  const lista = [...C.pessoas].sort((a, b) => b.ativo - a.ativo || nomeUsuario(a.id).localeCompare(nomeUsuario(b.id), 'pt-BR'));
  relTabela('pav-quadro', [{ rotulo: 'Pessoa' }, ...(hoje ? [{ rotulo: 'Agora' }] : []), { rotulo: 'Em atividade', direita: true }, { rotulo: 'Em pausa', direita: true },
    { rotulo: '% em atividade', direita: true }, { rotulo: 'Pausas', direita: true }, { rotulo: 'Foco médio', direita: true }, { rotulo: 'Entregas', direita: true }],
    lista.map(p => {
      const st = pavStatusRitmo(p.pctAtivo);
      return [nomeUsuario(p.id), ...(hoje ? [PAV_ESTADO[p.estado].rotulo] : []), { t: pavDuracao(p.ativo), v: p.ativo / PAV_H }, { t: pavDuracao(p.pausa), v: p.pausa / PAV_H },
        { t: p.pctAtivo == null ? '—' : `${relFmtPct(p.pctAtivo)} ${st.icone}`, v: p.pctAtivo, cls: st && st.icone === '▲' ? 'text-red-700 font-bold' : '' },
        p.pausas.length, { t: p.sessoes ? pavDuracao(p.ativo / p.sessoes) : '—', v: p.sessoes ? p.ativo / p.sessoes / PAV_H : null }, p.entregas.length];
    }), { vazio: 'Ninguém para mostrar.' });
}
