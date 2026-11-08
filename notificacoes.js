// PWA (instalação) e notificações push no navegador.
// Usa as globais de index.html: clienteSupabase, usuarioLogado, notificar, abrirDialogo, mensagemErro.

const NOTIF_VAPID_PUBLICA = 'BJVV2BRPAJq8TzXFa6VQloCgvW1-CaHJvLyOpxwBC5fX4pcKwjy3bS3fTaB8INyqU59a8TDT34s9LC1C4jG2-VY';
let notifRegistro = null;
let notifEventoInstalar = null;

const notifSuportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const notifPerfilRecebe = () => !!usuarioLogado && usuarioLogado.role !== 'diretoria';
const notifRodandoInstalado = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function notifChave(b64) {
  const base = b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '=');
  return Uint8Array.from(atob(base), c => c.charCodeAt(0));
}

const notifRegistroPronto = ('serviceWorker' in navigator && window.isSecureContext)
  ? navigator.serviceWorker.register('sw.js').then(r => (notifRegistro = r)).catch(e => { console.warn('Service worker:', e); return null; })
  : Promise.resolve(null);

async function notifRegistrarNoServidor(inscricao) {
  const j = inscricao.toJSON();
  const { error } = await clienteSupabase.rpc('registrar_push', {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_dispositivo: navigator.userAgent
  });
  if (error) throw error;
}

function notifAtualizarBotao(ativo) {
  const b = document.getElementById('btnNotificacoes');
  if (!b) return;
  if (!notifSuportado() || !notifPerfilRecebe() || !window.isSecureContext) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  b.textContent = ativo ? '🔔 Avisos ativos' : '🔔 Ativar avisos';
  b.classList.toggle('bg-red-600', !ativo);
  b.classList.toggle('text-white', !ativo);
  b.classList.toggle('bg-neutral-800', ativo);
  b.classList.toggle('text-neutral-300', ativo);
}

// Chamada ao entrar: se este aparelho já foi ativado, vincula a inscrição a quem acabou de entrar
async function notifAoEntrar() {
  notifAtualizarBotaoInstalar();
  if (!notifSuportado() || !notifPerfilRecebe()) { notifAtualizarBotao(false); return; }
  let ativo = false;
  try {
    const reg = await notifRegistroPronto;
    const inscricao = reg && Notification.permission === 'granted' ? await reg.pushManager.getSubscription() : null;
    if (inscricao) { await notifRegistrarNoServidor(inscricao); ativo = true; }
  } catch (e) { console.warn('Notificações:', e); }
  notifAtualizarBotao(ativo);
}

// Ao sair, o aparelho deixa de receber os avisos desta pessoa
async function notifAoSair() {
  try {
    const reg = await notifRegistroPronto;
    const inscricao = reg ? await reg.pushManager.getSubscription() : null;
    if (inscricao) await clienteSupabase.rpc('remover_push', { p_endpoint: inscricao.endpoint });
  } catch (e) { console.warn('Notificações:', e); }
}

async function notifAlternar() {
  const reg = await notifRegistroPronto;
  if (!reg) return;
  const atual = await reg.pushManager.getSubscription();
  if (atual && Notification.permission === 'granted') {
    const r = await abrirDialogo({
      titulo: 'Desativar avisos',
      mensagem: 'Este aparelho deixará de receber as notificações da plataforma. Você pode ativar de novo quando quiser.',
      botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Desativar', valor: 'ok', estilo: 'vermelho' }]
    });
    if (r.valor !== 'ok') return;
    await clienteSupabase.rpc('remover_push', { p_endpoint: atual.endpoint });
    await atual.unsubscribe();
    notifAtualizarBotao(false);
    notificar('Avisos desativados neste aparelho.');
    return;
  }
  if (Notification.permission === 'denied') {
    await abrirDialogo({
      titulo: 'Notificações bloqueadas',
      mensagem: 'O navegador está bloqueando os avisos deste site.\n\nClique no cadeado ao lado do endereço, em "Notificações" escolha "Permitir" e recarregue a página. No app instalado, use o menu ⋮ da janela para abrir as permissões.',
      botoes: [{ rotulo: 'Entendi', valor: null }]
    });
    return;
  }
  try {
    if (await Notification.requestPermission() !== 'granted') {
      notificar('Sem a permissão do navegador os avisos não podem ser ativados.', 'erro');
      return;
    }
    const inscricao = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: notifChave(NOTIF_VAPID_PUBLICA) });
    await notifRegistrarNoServidor(inscricao);
    notifAtualizarBotao(true);
    reg.showNotification('Avisos ativados', { body: 'É assim que as notificações da plataforma vão aparecer.', icon: 'icone-192.png', lang: 'pt-BR' });
    notificar('Avisos ativados neste aparelho.');
  } catch (e) {
    console.warn('Notificações:', e);
    notificar(`Não foi possível ativar os avisos: ${e.message ? e.message : mensagemErro(e)}`, 'erro');
  }
}

// Instalação do app -----------------------------------------------------------
function notifAtualizarBotaoInstalar() {
  const b = document.getElementById('btnInstalarApp');
  if (b) b.classList.toggle('hidden', !notifEventoInstalar || notifRodandoInstalado());
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  notifEventoInstalar = e;
  notifAtualizarBotaoInstalar();
});

window.addEventListener('appinstalled', () => {
  notifEventoInstalar = null;
  notifAtualizarBotaoInstalar();
  notificar('App instalado. Ele já está no menu Iniciar.');
});

async function instalarApp() {
  if (!notifEventoInstalar) return;
  notifEventoInstalar.prompt();
  await notifEventoInstalar.userChoice;
  notifEventoInstalar = null;
  notifAtualizarBotaoInstalar();
}
