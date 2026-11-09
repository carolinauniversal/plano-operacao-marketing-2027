// Transferência de várias atividades marcadas de uma vez (exclusivo da gestão).
// Usa as globais de index.html: tarefas, projetos, equipeAtribuivel, abrirDialogo, notificar, recarregarDados.

const tlMarcadas = new Set();
const tlAbertas = () => tarefas.filter(t => t.status !== 'Concluído');
const tlValor = id => document.getElementById(id).value;

function tlGarantirModal() {
  if (document.getElementById('modalTransfLote')) return;
  const campo = 'w-full border border-neutral-300 rounded p-2 text-xs outline-none focus:ring-2 focus:ring-red-600';
  const rotulo = 'block text-[10px] font-bold uppercase text-neutral-600 mb-1';
  document.body.insertAdjacentHTML('beforeend', `
  <div id="modalTransfLote" class="fixed inset-0 bg-black bg-opacity-70 backdrop-blur-sm hidden z-50 flex items-center justify-center p-2 sm:p-4">
    <div class="bg-white rounded-xl max-w-3xl w-full shadow-2xl border-t-4 border-red-600 max-h-[96vh] flex flex-col">
      <div class="p-4 border-b border-neutral-200 flex justify-between items-start gap-3">
        <div>
          <h3 class="text-base font-black text-neutral-900">Transferir atividades em lote</h3>
          <p class="text-xs text-neutral-500">Filtre, marque as atividades e escolha o novo responsável.</p>
        </div>
        <button type="button" onclick="tlFechar()" aria-label="Fechar" class="text-neutral-500 hover:text-red-600 font-black">✕</button>
      </div>
      <div class="p-4 border-b border-neutral-200 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div><label for="tlProjeto" class="${rotulo}">Projeto</label><select id="tlProjeto" onchange="tlAoMudarProjeto()" class="${campo}"></select></div>
        <div><label for="tlPilar" class="${rotulo}">Pilar</label><select id="tlPilar" onchange="tlRenderizar()" class="${campo}"></select></div>
        <div><label for="tlResponsavel" class="${rotulo}">Responsável atual</label><select id="tlResponsavel" onchange="tlRenderizar()" class="${campo}"></select></div>
        <div><label for="tlStatus" class="${rotulo}">Status</label><select id="tlStatus" onchange="tlRenderizar()" class="${campo}"></select></div>
        <div class="col-span-2 sm:col-span-4"><label for="tlBusca" class="${rotulo}">Buscar no título</label><input id="tlBusca" type="search" oninput="tlRenderizar()" placeholder="Ex: criar arte, Black Friday" class="${campo}"></div>
      </div>
      <div class="px-4 py-2 border-b border-neutral-200 flex flex-wrap justify-between items-center gap-2 text-xs">
        <label class="inline-flex items-center gap-2 font-bold text-neutral-800"><input id="tlMarcarTodas" type="checkbox" onchange="tlMarcarFiltradas(this.checked)" class="accent-red-600"><span id="tlRotuloTodas">Marcar todas</span></label>
        <span class="flex items-center gap-3">
          <span id="tlContador" class="font-bold text-neutral-700" aria-live="polite"></span>
          <button type="button" onclick="tlLimpar()" class="text-red-700 font-bold hover:underline">Limpar</button>
        </span>
      </div>
      <div id="tlLista" class="flex-1 min-h-[120px] overflow-y-auto custom-scrollbar divide-y divide-neutral-100"></div>
      <form onsubmit="tlTransferir(event)" class="p-4 border-t border-neutral-200 grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
        <div><label for="tlNovo" class="${rotulo}">Novo responsável *</label><select id="tlNovo" required class="${campo}"></select></div>
        <div><label for="tlMotivo" class="${rotulo}">Motivo *</label><input id="tlMotivo" required maxlength="500" placeholder="Ex: distribuição do calendário" class="${campo}"></div>
        <button id="tlEnviar" type="submit" class="py-2 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-black">Transferir</button>
      </form>
    </div>
  </div>`);
}

function tlPreencher(id, opcoes, valor) {
  const sel = document.getElementById(id);
  sel.innerHTML = opcoes.map(o => `<option value="${escaparHtml(o.valor)}">${escaparHtml(o.rotulo)}</option>`).join('');
  sel.value = opcoes.some(o => o.valor === valor) ? valor : opcoes[0].valor;
}

function tlPreencherPilares() {
  const projeto = projetos.find(p => p.id === tlValor('tlProjeto'));
  tlPreencher('tlPilar', [{ valor: 'todos', rotulo: projeto ? 'Todos os pilares' : 'Escolha o projeto' },
    ...(projeto ? projeto.pilares.map(p => ({ valor: p.id, rotulo: p.nome })) : [])], 'todos');
  document.getElementById('tlPilar').disabled = !projeto;
}

function tlAoMudarProjeto() {
  tlPreencherPilares();
  tlRenderizar();
}

function abrirTransferenciaLote() {
  if (!usuarioPodeGerir()) return;
  tlGarantirModal();
  tlMarcadas.clear();
  const abertas = tlAbertas();
  const comAberta = new Set(abertas.map(t => t.projetoId));
  tlPreencher('tlProjeto', [{ valor: 'todos', rotulo: 'Todos os projetos' },
    ...projetos.filter(p => comAberta.has(p.id)).map(p => ({ valor: p.id, rotulo: p.nome }))], 'todos');
  tlPreencherPilares();
  const responsaveis = [...new Set(abertas.map(t => t.colaboradorId))]
    .map(id => ({ valor: id, rotulo: nomeUsuario(id) }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  tlPreencher('tlResponsavel', [{ valor: 'todos', rotulo: 'Toda a equipe' }, ...responsaveis], 'todos');
  tlPreencher('tlStatus', [{ valor: 'todos', rotulo: 'Todos em aberto' },
    ...STATUS_TAREFA.filter(s => s.valor !== 'Concluído').map(s => ({ valor: s.valor, rotulo: s.rotulo }))], 'todos');
  tlPreencher('tlNovo', [{ valor: '', rotulo: 'Selecione...' },
    ...equipeAtribuivel.map(u => ({ valor: u.id, rotulo: `${u.nome}${u.id === usuarioLogado.id ? ' (você)' : ''}` }))], '');
  document.getElementById('tlBusca').value = '';
  document.getElementById('tlMotivo').value = '';
  tlRenderizar();
  document.getElementById('modalTransfLote').classList.remove('hidden');
}

function tlFechar() {
  document.getElementById('modalTransfLote').classList.add('hidden');
}

function tlFiltradas() {
  const projeto = tlValor('tlProjeto'), pilar = tlValor('tlPilar'), resp = tlValor('tlResponsavel'), status = tlValor('tlStatus');
  const busca = tlValor('tlBusca').trim().toLocaleLowerCase('pt-BR');
  return tlAbertas()
    .filter(t => (projeto === 'todos' || t.projetoId === projeto)
      && (pilar === 'todos' || t.pilarId === pilar)
      && (resp === 'todos' || t.colaboradorId === resp)
      && (status === 'todos' || t.status === status)
      && (!busca || t.titulo.toLocaleLowerCase('pt-BR').includes(busca)))
    .sort((a, b) => (Date.parse(a.previsaoInicio || 0) || 0) - (Date.parse(b.previsaoInicio || 0) || 0));
}

function tlRenderizar() {
  const lista = tlFiltradas();
  document.getElementById('tlLista').innerHTML = lista.map(t => {
    const projeto = projetos.find(p => p.id === t.projetoId);
    const inicio = t.previsaoInicio ? new Date(t.previsaoInicio).toLocaleDateString('pt-BR') : 'Sem previsão';
    return `<label class="flex items-start gap-2 px-4 py-2 hover:bg-neutral-50 cursor-pointer">
      <input type="checkbox" data-tl="${t.id}" onchange="tlAlternar('${t.id}', this.checked)" ${tlMarcadas.has(t.id) ? 'checked' : ''} class="mt-0.5 accent-red-600">
      <span class="min-w-0">
        <span class="block text-xs font-bold text-neutral-900 break-words">${escaparHtml(t.titulo)}</span>
        <span class="block text-[11px] text-neutral-500 break-words">${escaparHtml(projeto ? projeto.nome : '')} · ${escaparHtml(nomeUsuario(t.colaboradorId))} · ${escaparHtml(rotuloStatus(t.status))} · ${inicio}</span>
      </span>
    </label>`;
  }).join('') || '<p class="p-6 text-xs text-neutral-400 text-center">Nenhuma atividade em aberto com esses filtros.</p>';
  document.getElementById('tlRotuloTodas').textContent = `Marcar todas as ${lista.length} filtradas`;
  tlAtualizarContador(lista);
}

function tlAtualizarContador(lista = tlFiltradas()) {
  const naTela = lista.filter(t => tlMarcadas.has(t.id)).length;
  const fora = tlMarcadas.size - naTela;
  document.getElementById('tlContador').textContent = `${tlMarcadas.size} marcada(s)${fora > 0 ? ` · ${fora} fora deste filtro` : ''}`;
  const todas = document.getElementById('tlMarcarTodas');
  todas.checked = lista.length > 0 && naTela === lista.length;
  todas.indeterminate = naTela > 0 && naTela < lista.length;
  const botao = document.getElementById('tlEnviar');
  botao.textContent = tlMarcadas.size ? `Transferir ${tlMarcadas.size}` : 'Transferir';
}

function tlAlternar(id, marcada) {
  if (marcada) tlMarcadas.add(id); else tlMarcadas.delete(id);
  tlAtualizarContador();
}

function tlMarcarFiltradas(marcar) {
  tlFiltradas().forEach(t => { if (marcar) tlMarcadas.add(t.id); else tlMarcadas.delete(t.id); });
  document.querySelectorAll('#tlLista input[data-tl]').forEach(c => { c.checked = marcar; });
  tlAtualizarContador();
}

function tlLimpar() {
  tlMarcadas.clear();
  tlRenderizar();
}

async function tlTransferir(e) {
  e.preventDefault();
  if (!usuarioPodeGerir()) return;
  if (tlMarcadas.size === 0) { notificar('Marque ao menos uma atividade.', 'erro'); return; }
  const para = tlValor('tlNovo');
  const motivo = tlValor('tlMotivo').trim();
  if (!para || !motivo) { notificar('Escolha o novo responsável e informe o motivo.', 'erro'); return; }
  const marcadas = tarefas.filter(t => tlMarcadas.has(t.id));
  const jaDele = marcadas.filter(t => t.colaboradorId === para).length;
  const emProducao = marcadas.filter(t => t.status === 'Em Produção' && t.colaboradorId !== para).length;
  const r = await abrirDialogo({
    titulo: 'Confirmar transferência',
    mensagem: `${marcadas.length - jaDele} atividade(s) passarão para ${nomeUsuario(para)}.`
      + (jaDele ? `\n${jaDele} já são dessa pessoa e serão ignoradas.` : '')
      + (emProducao ? `\n${emProducao} em produção terão o cronômetro encerrado e ficarão "Em Pausa".` : ''),
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Transferir', valor: 'ok', estilo: 'vermelho' }]
  });
  if (r.valor !== 'ok') return;
  await comBotaoOcupado(e, async () => {
    const { data, error } = await clienteSupabase.rpc('transferir_tarefas_lote', { p_ids: [...tlMarcadas], p_para: para, p_motivo: motivo });
    if (error) { notificar(`Não foi possível transferir: ${mensagemErro(error)}`, 'erro'); return; }
    tlFechar();
    notificar(`${data} atividade(s) transferida(s) para ${nomeUsuario(para)}.`);
    await recarregarDados();
  });
}
