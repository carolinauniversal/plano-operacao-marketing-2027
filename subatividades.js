// Subatividades: partes de uma atividade principal (job) executadas por outras pessoas.
// Ex.: "Lâmina de lançamento" → "Texto da lâmina" (redator) + "Arte da lâmina" (designer).
// Só a principal tem horas previstas; as horas de todas as partes consomem desse total.
// Usa as globais de index.html: tarefas, usuarioLogado, equipeAtribuivel, horasPorExecutor, abrirDialogo...

const subsDe = id => tarefas.filter(t => t.tarefaPaiId === id);
const ehSubatividade = t => !!(t && t.tarefaPaiId);

function jobDe(t) {
  if (!t) return null;
  return t.tarefaPaiId ? (tarefas.find(x => x.id === t.tarefaPaiId) || null) : t;
}
function tarefasDoJob(job) { return job ? [job, ...subsDe(job.id)] : []; }
function temSubatividades(t) { return !!t && !t.tarefaPaiId && tarefas.some(x => x.tarefaPaiId === t.id); }
function horasDoJob(job) { return tarefasDoJob(job).reduce((s, t) => s + Number(t.tempo_gasto || 0), 0); }
function subsAbertas(job) { return subsDe(job.id).filter(s => s.status !== 'Concluído'); }

// Horas comparáveis ao tempo previsto: na principal, o total do job; na subatividade, as dela
function horasParaEstimativa(t) { return t.tarefaPaiId ? Number(t.tempo_gasto || 0) : horasDoJob(t); }

function participaDoJob(job) {
  return !!usuarioLogado && tarefasDoJob(job).some(x => x.colaboradorId === usuarioLogado.id);
}

function podeCriarSubatividade(job) {
  if (!job || !usuarioLogado || usuarioLogado.role === 'diretoria') return false;
  if (job.status === 'Concluído' || job.status === 'Aprovação') return false;
  return usuarioLogado.role === 'gestor' || participaDoJob(job) || job.criadoPor === usuarioLogado.id;
}

// Linha curta para os cards (Kanban e painel do colaborador)
function htmlVinculoJob(t) {
  if (t.tarefaPaiId) {
    const job = jobDe(t);
    return `<p class="text-[10px] font-bold text-violet-700 mb-1 break-words">↳ Subatividade de: ${job ? `<button type="button" onclick="abrirDetalheTarefa('${job.id}')" class="underline hover:text-violet-900 text-left">${escaparHtml(job.titulo)}</button>` : 'atividade principal'}</p>`;
  }
  const subs = subsDe(t.id);
  if (!subs.length) return '';
  const feitas = subs.filter(s => s.status === 'Concluído').length;
  return `<p class="text-[10px] font-bold text-violet-700 mb-1">🔗 ${subs.length} subatividade(s) · ${feitas} concluída(s)</p>`;
}

// Texto de horas do card do Kanban
function textoHorasCard(t) {
  const verPrevisto = usuarioLogado.role !== 'colaborador';
  if (t.tarefaPaiId) {
    const job = jobDe(t);
    const doJob = job ? ` · job ${fmtHoras(horasDoJob(job))}${verPrevisto ? ` / ${fmtHoras(job.tempo_estimado)}` : ''}` : '';
    return `Horas: ${fmtHoras(t.tempo_gasto)}${doJob}`;
  }
  if (temSubatividades(t)) {
    return `Horas do job: ${fmtHoras(horasDoJob(t))}${verPrevisto ? ` / ${fmtHoras(t.tempo_estimado)}` : ''}`;
  }
  return `Horas: ${verPrevisto ? `${fmtHoras(t.tempo_gasto)} / ${fmtHoras(t.tempo_estimado)}` : fmtHoras(t.tempo_gasto)}`;
}

// Bloco do detalhe: o job inteiro, o total e quanto cada pessoa consumiu
function htmlSubatividadesDetalhe(t) {
  const job = jobDe(t);
  if (!job) return '';
  const subs = subsDe(job.id);
  const pode = podeCriarSubatividade(job);
  if (!subs.length && !pode) return '';

  const botaoNova = pode
    ? `<button type="button" onclick="abrirModalSubatividade('${job.id}')" class="px-2 py-1 rounded text-[11px] font-bold ${ESTILOS_BOTAO.neutro}">+ Nova subatividade</button>`
    : '';
  if (!subs.length) {
    return `
      <div class="rounded-lg border border-dashed border-neutral-300 p-3 flex flex-wrap items-center justify-between gap-2">
        <p class="text-[11px] text-neutral-600">Precisa de outra pessoa nesta entrega? Crie uma subatividade: ela consome do mesmo tempo previsto.</p>
        ${botaoNova}
      </div>`;
  }

  const verPrevisto = usuarioLogado.role !== 'colaborador';
  const total = horasDoJob(job);
  const estourou = job.tempo_estimado > 0 && total > job.tempo_estimado;
  const pct = job.tempo_estimado > 0 ? Math.round((total / job.tempo_estimado) * 100) : null;
  const porPessoa = [...horasPorExecutor(tarefasDoJob(job)).entries()].sort((a, b) => b[1] - a[1]);
  const feitas = subs.filter(s => s.status === 'Concluído').length;

  const linha = (x, principal) => `
    <li class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 ${x.id === t.id ? 'bg-violet-50 -mx-2 px-2 rounded' : ''}">
      <span class="min-w-0 flex items-center gap-1.5">
        <span class="text-[9px] font-black uppercase px-1 rounded ${principal ? 'bg-neutral-900 text-white' : 'bg-violet-100 text-violet-800'}">${principal ? 'Principal' : 'Sub'}</span>
        ${x.id === t.id ? `<strong class="text-neutral-900 break-words">${escaparHtml(x.titulo)}</strong>` : `<button type="button" onclick="abrirDetalheTarefa('${x.id}')" class="font-bold text-neutral-900 hover:text-red-600 hover:underline text-left break-words">${escaparHtml(x.titulo)}</button>`}
      </span>
      <span class="flex flex-wrap items-center gap-2 text-[11px] text-neutral-600">
        <span>${escaparHtml(nomeUsuario(x.colaboradorId))}</span>
        ${badgeStatus(x.status)}
        <strong class="text-neutral-900 whitespace-nowrap">${fmtHoras(x.tempo_gasto)}</strong>
      </span>
    </li>`;

  return `
    <div class="rounded-lg border border-violet-200 bg-white p-3 space-y-2">
      <div class="flex flex-wrap justify-between items-start gap-2">
        <div class="min-w-0">
          <p class="text-[10px] uppercase font-bold text-violet-700">Job · ${subs.length} subatividade(s), ${feitas} concluída(s)</p>
          <p class="text-xs text-neutral-700">Tempo do job: <strong class="${estourou ? 'text-red-700' : 'text-neutral-900'}">${fmtHoras(total)}${verPrevisto ? ` de ${fmtHoras(job.tempo_estimado)} previstas${pct != null ? ` (${pct}%)` : ''}` : ''}</strong></p>
        </div>
        ${botaoNova}
      </div>
      ${porPessoa.length ? `<div class="flex flex-wrap gap-1.5">${porPessoa.map(([id, h]) => `<span class="px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-[11px] font-semibold text-neutral-800">${escaparHtml(nomeUsuario(id))}: ${fmtHoras(h)}</span>`).join('')}</div>` : '<p class="text-[11px] text-neutral-500">Ninguém registrou horas neste job ainda.</p>'}
      <ul class="divide-y divide-neutral-100 text-xs">${linha(job, true)}${subs.map(s => linha(s, false)).join('')}</ul>
      ${job.status !== 'Concluído' && subsAbertas(job).length ? '<p class="text-[10px] text-neutral-500">A atividade principal só pode ser concluída depois que todas as subatividades estiverem concluídas.</p>' : ''}
    </div>`;
}

// --- Formulário: o mesmo de "Nova atividade", em modo subatividade ---
function sbEl(id) { return document.getElementById(id); }

function sbDataLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function modoModalTarefa(job) {
  const sub = !!job;
  sbEl('novaTarPaiId').value = sub ? job.id : '';
  sbEl('tituloModalNovaTarefa').textContent = sub ? 'Nova subatividade' : 'Nova Atividade';
  sbEl('novaTarBlocoDestino').classList.toggle('hidden', sub);
  sbEl('novaTarBlocoHoras').classList.toggle('hidden', sub);
  ['novaTarProjeto', 'novaTarPilar', 'novaTarHorasPrevistas'].forEach(id => { sbEl(id).required = !sub; });
  sbEl('novaTarBtnSalvar').textContent = sub ? 'Salvar subatividade' : 'Salvar Atividade';
  sbEl('novaTarBtnMais').textContent = sub ? 'Salvar e adicionar outra' : 'Salvar e criar subatividade';
  const aviso = sbEl('novaTarAvisoSub');
  aviso.classList.toggle('hidden', !sub);
  aviso.textContent = sub ? `Parte de "${job.titulo}". O projeto e o pilar são os da atividade principal, e as horas contam no tempo previsto dela.` : '';
}

// reserva: dados da principal recém-criada, caso ela ainda não esteja na lista carregada
function abrirModalSubatividade(id, reserva = null) {
  const base = tarefas.find(x => x.id === id);
  const job = (base && jobDe(base)) || reserva;
  if (!job) { notificar('Atividade principal não encontrada. Atualize a página e tente de novo.', 'erro'); return; }
  if (base && !podeCriarSubatividade(job)) {
    notificar(job.status === 'Concluído' || job.status === 'Aprovação'
      ? 'A atividade principal já foi concluída ou está em aprovação.'
      : 'Você só pode criar subatividades em atividades das quais participa.', 'erro');
    return;
  }
  if (tarefaDetalheAbertaId) fecharDetalheTarefa();
  abrirModalNovaTarefa();
  modoModalTarefa(job);
  sbEl('subtituloModalNovaTarefa').textContent = 'Escolha quem vai executar esta parte do job.';
  sbEl('novaTarResponsavel').value = '';
  sbEl('novaTarPrioridade').value = job.prioridade || 'Média';
  // Sugere as datas da principal só se o término dela ainda não passou (o campo não aceita data passada)
  const termino = job.previsaoTermino ? new Date(job.previsaoTermino) : null;
  const usarDatas = termino && termino > new Date();
  sbEl('novaTarInicioPrev').value = usarDatas ? sbDataLocal(job.previsaoInicio) : '';
  sbEl('novaTarTerminoPrev').value = usarDatas ? sbDataLocal(job.previsaoTermino) : '';
  sbEl('novaTarTitulo').focus();
}

async function salvarSubatividade(e, paiId, responsavel, inicio, termino, maisUma) {
  await comBotaoOcupado(e, async () => {
    const { error } = await clienteSupabase.rpc('criar_subatividade', {
      p_tarefa_id: paiId,
      p_titulo: sbEl('novaTarTitulo').value.trim(),
      p_descricao: sbEl('novaTarDescricao').value.trim() || null,
      p_responsavel: responsavel.id,
      p_previsao_inicio: new Date(inicio).toISOString(),
      p_previsao_termino: new Date(termino).toISOString(),
      p_prioridade: sbEl('novaTarPrioridade').value
    });
    if (error) { notificar(`Não foi possível criar a subatividade: ${mensagemErro(error)}`, 'erro'); return; }
    notificar(responsavel.id === usuarioLogado.id ? 'Subatividade criada.' : `Subatividade atribuída a ${responsavel.nome}.`);
    await recarregarDados();
    if (maisUma) abrirModalSubatividade(paiId);
    else { fecharModalNovaTarefa(); if (tarefas.some(x => x.id === paiId)) await abrirDetalheTarefa(paiId); }
  });
}

// Concluir/enviar a principal com subatividades em aberto: explica em vez de tentar
async function bloquearConclusaoComSubs(t) {
  if (t.tarefaPaiId) return false;
  const abertas = subsAbertas(t);
  if (!abertas.length) return false;
  await abrirDialogo({
    titulo: 'Há subatividades em aberto',
    mensagem: `"${t.titulo}" só pode ser concluída depois destas subatividades:\n${abertas.map(s => `• ${s.titulo} — ${nomeUsuario(s.colaboradorId)} (${rotuloStatus(s.status)})`).join('\n')}`,
    botoes: [{ rotulo: 'Entendi', valor: null, estilo: 'preto' }]
  });
  return true;
}
