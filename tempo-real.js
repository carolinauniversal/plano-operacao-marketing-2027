// Atualização em tempo real das atividades (Supabase Realtime).
// Usa as globais de index.html: clienteSupabase, usuarioLogado, carregarDadosAplicacao e os renderizadores das telas.
// Não usa atualizarTodaAplicacao: ela refaz os selects e apagaria formulários em preenchimento.

const RT_ESPERA = 1200;   // agrupa uma rajada de mudanças em uma única recarga
const RT_FOLGA = 60000;   // recarga de segurança: rede que bloqueia WebSocket ou mudança que a permissão não avisou
const RT_VERIFICACAO = 2000;

let rtCanal = null;
let rtTimer = null;
let rtVerificador = null;
let rtEmCurso = false;
let rtPendente = false;
let rtUltima = 0;

function rtJanelaAberta() {
  return !!document.querySelector('.fixed.inset-0:not(.hidden)');
}

function rtAgendar() {
  if (rtTimer) return;
  rtTimer = setTimeout(() => { rtTimer = null; rtAtualizar(); }, RT_ESPERA);
}

function rtColunas() {
  return STATUS_TAREFA.map(s => document.getElementById(`coluna-k-${s.coluna}`));
}

function rtRedesenhar() {
  const colunas = rtColunas();
  const rolagens = colunas.map(c => c.scrollTop);
  const rolagemPagina = window.scrollY;

  renderizarKanbanGeral();
  if (usuarioLogado.role === 'colaborador') {
    if (!document.getElementById('colab-tela-dashboard').classList.contains('hidden')) renderizarDashboardColaborador();
  } else {
    renderizarPainelAndamento();
    if (usuarioLogado.role === 'gestor') renderizarBannerEmProducao('gestor-em-producao');
    renderizarTabelaUsuariosEquipe();
  }

  if (typeof pavAoAtualizarDados === 'function') pavAoAtualizarDados(); // painel-ao-vivo.js (se estiver aberto)

  colunas.forEach((c, i) => { c.scrollTop = rolagens[i]; });
  window.scrollTo(window.scrollX, rolagemPagina);
}

async function rtAtualizar() {
  if (!usuarioLogado) return;
  // Aba em segundo plano ou janela aberta: fica pendente e o verificador tenta de novo
  if (rtEmCurso || document.hidden || rtJanelaAberta()) { rtPendente = true; return; }

  rtEmCurso = true;
  rtPendente = false;
  try {
    await carregarDadosAplicacao();
    if (!usuarioLogado) return;
    if (rtJanelaAberta()) rtPendente = true;
    else rtRedesenhar();
  } catch (erro) {
    // Falha passageira não interrompe o trabalho: a próxima recarga corrige
    console.warn('Atualização em tempo real falhou:', erro);
  } finally {
    rtUltima = Date.now();
    rtEmCurso = false;
  }
}

function rtVerificar() {
  if (!usuarioLogado || document.hidden) return;
  if (Date.now() - rtUltima >= RT_FOLGA) rtPendente = true;
  if (rtPendente && !rtTimer) rtAtualizar();
}

function rtIniciar() {
  if (rtCanal) return;
  rtUltima = Date.now();
  rtCanal = clienteSupabase.channel('atividades-ao-vivo')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tarefas' }, rtAgendar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tarefa_sessoes' }, rtAgendar)
    .subscribe();
  rtVerificador = setInterval(rtVerificar, RT_VERIFICACAO);
}

function rtParar() {
  if (rtCanal) clienteSupabase.removeChannel(rtCanal);
  rtCanal = null;
  clearTimeout(rtTimer);
  clearInterval(rtVerificador);
  rtTimer = null;
  rtVerificador = null;
  rtPendente = false;
}
