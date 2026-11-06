// ===== ARQUIVO PDF DOS PROJETOS ESTRATÉGICOS =====
// Anexar (na criação ou depois), substituir, excluir, visualizar dentro da plataforma e baixar.
// Arquivos no Supabase Storage (bucket privado "projetos-arquivos"); leitura: gestão e diretoria; escrita: gestão.
// Visualizador com PDF.js (renderiza em qualquer navegador, inclusive Chrome no Android, que não abre PDF embutido).

const PA_BUCKET = 'projetos-arquivos';
const PA_LIMITE_BYTES = 25 * 1024 * 1024;
const PA_PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

function paFmtTamanho(bytes) {
  const n = Number(bytes || 0);
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

// Valida o arquivo escolhido; devolve mensagem de erro ou null
function paValidar(arquivo) {
  if (!arquivo) return 'Selecione um arquivo.';
  const ehPdf = arquivo.type === 'application/pdf' || /\.pdf$/i.test(arquivo.name);
  if (!ehPdf) return 'O arquivo precisa ser um PDF.';
  if (arquivo.size > PA_LIMITE_BYTES) return `O PDF tem ${paFmtTamanho(arquivo.size)}. O limite é 25 MB.`;
  if (arquivo.size === 0) return 'O arquivo está vazio.';
  return null;
}

function paNovoCaminho(projetoId) {
  const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${projetoId}/${id}.pdf`;
}

// Envia o PDF e grava no projeto. Remove o arquivo anterior (substituição). Lança erro em caso de falha.
async function paEnviarArquivo(projetoId, arquivo) {
  const anterior = (projetos.find(p => p.id === projetoId) || {}).arquivo || null;
  const caminho = paNovoCaminho(projetoId);
  const { error: erroUpload } = await clienteSupabase.storage.from(PA_BUCKET)
    .upload(caminho, arquivo, { contentType: 'application/pdf', upsert: false });
  if (erroUpload) throw erroUpload;

  const { data, error } = await clienteSupabase.from('projetos').update({
    arquivo_path: caminho,
    arquivo_nome: arquivo.name,
    arquivo_tamanho: arquivo.size,
    arquivo_enviado_em: new Date().toISOString(),
    arquivo_enviado_por: usuarioLogado ? usuarioLogado.nome : null
  }).eq('id', projetoId).select('id');
  if (error || !data || !data.length) {
    await clienteSupabase.storage.from(PA_BUCKET).remove([caminho]); // não deixa arquivo órfão
    throw error || new Error('Projeto não encontrado ou sem permissão.');
  }
  if (anterior && anterior.path && anterior.path !== caminho) {
    await clienteSupabase.storage.from(PA_BUCKET).remove([anterior.path]);
  }
}

// ---------- Campo no modal "Novo Projeto" ----------
function paCampoNovoProjetoLimpar() {
  const input = document.getElementById('novoProjetoArquivo');
  if (input) input.value = '';
  paCampoNovoProjetoAtualizar();
}

function paCampoNovoProjetoAtualizar() {
  const input = document.getElementById('novoProjetoArquivo');
  const info = document.getElementById('novoProjetoArquivoInfo');
  const vazio = document.getElementById('novoProjetoArquivoVazio');
  if (!input || !info) return;
  const arq = input.files && input.files[0];
  if (arq) {
    const erro = paValidar(arq);
    if (erro) { notificar(erro, 'erro'); input.value = ''; return paCampoNovoProjetoAtualizar(); }
    info.innerHTML = `<span class="text-lg leading-none">📄</span>
      <span class="min-w-0 flex-1"><strong class="block truncate text-neutral-900">${escaparHtml(arq.name)}</strong><span class="text-neutral-500">${paFmtTamanho(arq.size)}</span></span>
      <button type="button" onclick="paCampoNovoProjetoLimpar()" class="px-2 py-1 rounded text-[11px] font-bold border border-neutral-300 hover:bg-neutral-100">Remover</button>`;
    info.classList.remove('hidden');
    vazio.classList.add('hidden');
  } else {
    info.classList.add('hidden');
    vazio.classList.remove('hidden');
  }
}

function paArquivoNovoProjeto() {
  const input = document.getElementById('novoProjetoArquivo');
  return input && input.files && input.files[0] ? input.files[0] : null;
}

// ---------- Bloco no card do projeto (Projetos & Pilares) ----------
function paBlocoProjeto(p) {
  const gestor = usuarioLogado && usuarioLogado.role === 'gestor';
  const a = p.arquivo;
  const btn = (rotulo, acao, extra = '') => `<button type="button" onclick="${acao}" class="px-2.5 py-1 rounded text-[11px] font-bold whitespace-nowrap ${extra || 'border border-neutral-300 hover:bg-neutral-100 text-neutral-800'}">${rotulo}</button>`;
  if (!a) {
    if (!gestor) return '';
    return `<div class="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border border-dashed border-neutral-300 text-xs">
      <span class="text-neutral-500">📄 Nenhum PDF de detalhamento anexado.</span>
      ${btn('＋ Anexar PDF', `paEscolherArquivo('${p.id}')`)}
    </div>`;
  }
  return `<div class="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 rounded-lg border border-neutral-200 bg-white text-xs">
    <button type="button" onclick="paAbrirVisualizador('${p.id}')" class="flex items-center gap-2 min-w-0 flex-1 text-left group" title="Visualizar o PDF">
      <span class="shrink-0 w-8 h-8 rounded bg-red-50 text-red-700 font-black text-[10px] flex items-center justify-center border border-red-200">PDF</span>
      <span class="min-w-0">
        <strong class="block truncate text-neutral-900 group-hover:underline">${escaparHtml(a.nome)}</strong>
        <span class="text-neutral-500">${paFmtTamanho(a.tamanho)}${a.enviadoEm ? ` · enviado em ${fmtDataHora(a.enviadoEm)}` : ''}${a.enviadoPor ? ` por ${escaparHtml(a.enviadoPor)}` : ''}</span>
      </span>
    </button>
    <div class="flex flex-wrap gap-1.5">
      ${btn('👁 Visualizar', `paAbrirVisualizador('${p.id}')`, 'bg-neutral-900 hover:bg-neutral-700 text-white')}
      ${btn('⬇ Baixar', `paBaixar('${p.id}')`)}
      ${gestor ? btn('Substituir', `paEscolherArquivo('${p.id}')`) : ''}
      ${gestor ? btn('Excluir', `paExcluir('${p.id}')`, 'border border-red-200 text-red-700 hover:bg-red-50') : ''}
    </div>
  </div>`;
}

function paEscolherArquivo(projetoId) {
  if (!usuarioPodeGerir()) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.onchange = async () => {
    const arq = input.files && input.files[0];
    if (!arq) return;
    const erro = paValidar(arq);
    if (erro) { notificar(erro, 'erro'); return; }
    const projeto = projetos.find(p => p.id === projetoId);
    if (projeto && projeto.arquivo) {
      const r = await abrirDialogo({
        titulo: 'Substituir o PDF do projeto?',
        mensagem: `"${projeto.arquivo.nome}" será substituído por "${arq.name}". O arquivo anterior será apagado.`,
        botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Substituir', valor: 'sim', estilo: 'vermelho' }]
      });
      if (!r || r.valor !== 'sim') return;
    }
    notificar(`Enviando "${arq.name}"...`);
    try {
      await paEnviarArquivo(projetoId, arq);
      notificar('PDF do projeto salvo.');
      await recarregarDados();
    } catch (e) {
      notificar(`Não foi possível enviar o PDF: ${paMensagemErro(e)}`, 'erro');
    }
  };
  input.click();
}

async function paExcluir(projetoId) {
  if (!usuarioPodeGerir()) return;
  const projeto = projetos.find(p => p.id === projetoId);
  if (!projeto || !projeto.arquivo) return;
  const r = await abrirDialogo({
    titulo: 'Excluir o PDF do projeto?',
    mensagem: `"${projeto.arquivo.nome}" será apagado do projeto "${projeto.nome}". Esta ação não pode ser desfeita.`,
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Excluir PDF', valor: 'sim', estilo: 'vermelho' }]
  });
  if (!r || r.valor !== 'sim') return;
  const { data, error } = await clienteSupabase.from('projetos').update({
    arquivo_path: null, arquivo_nome: null, arquivo_tamanho: null, arquivo_enviado_em: null, arquivo_enviado_por: null
  }).eq('id', projetoId).select('id');
  if (error || !data || !data.length) {
    notificar(`Não foi possível excluir: ${error ? mensagemErro(error) : 'sem permissão.'}`, 'erro');
    return;
  }
  await clienteSupabase.storage.from(PA_BUCKET).remove([projeto.arquivo.path]);
  notificar('PDF excluído.');
  await recarregarDados();
}

function paMensagemErro(e) {
  const msg = (e && (e.message || e.error)) || String(e);
  if (/bucket not found/i.test(msg)) return 'o banco ainda não foi atualizado. Execute a migração 20261113_projetos_arquivo_pdf.sql.';
  if (/row-level security|unauthorized|403/i.test(msg)) return 'seu perfil não tem permissão.';
  if (/payload too large|exceeded the maximum/i.test(msg)) return 'o arquivo passa do limite de 25 MB.';
  if (/mime type/i.test(msg)) return 'o arquivo precisa ser um PDF.';
  return e && e.code ? mensagemErro(e) : msg;
}

async function paObterBlob(projeto) {
  const { data, error } = await clienteSupabase.storage.from(PA_BUCKET).download(projeto.arquivo.path);
  if (error) throw error;
  return data;
}

function paSalvarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = /\.pdf$/i.test(nome) ? nome : `${nome}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function paBaixar(projetoId) {
  const projeto = projetos.find(p => p.id === projetoId);
  if (!projeto || !projeto.arquivo) return;
  try {
    const blob = (paVisor.projetoId === projetoId && paVisor.blob) ? paVisor.blob : await paObterBlob(projeto);
    paSalvarBlob(blob, projeto.arquivo.nome);
  } catch (e) {
    notificar(`Não foi possível baixar: ${paMensagemErro(e)}`, 'erro');
  }
}

// ---------- Visualizador (popup quase tela cheia) ----------
const paVisor = { projetoId: null, blob: null, pdf: null, escala: null, ajuste: 'largura', observador: null, token: 0 };

function paCarregarPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (paCarregarPdfJs.promessa) return paCarregarPdfJs.promessa;
  paCarregarPdfJs.promessa = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PA_PDFJS + 'pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PA_PDFJS + 'pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = () => { paCarregarPdfJs.promessa = null; reject(new Error('Não foi possível carregar o visualizador de PDF. Verifique a internet.')); };
    document.head.appendChild(s);
  });
  return paCarregarPdfJs.promessa;
}

function paGarantirVisor() {
  if (document.getElementById('modalVisorPdf')) return;
  const el = document.createElement('div');
  el.id = 'modalVisorPdf';
  el.className = 'fixed inset-0 bg-black bg-opacity-80 hidden z-[60] flex items-center justify-center p-2 sm:p-4';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'visorPdfTitulo');
  el.innerHTML = `
    <div class="bg-neutral-100 rounded-xl w-full h-full max-w-[1400px] flex flex-col overflow-hidden shadow-2xl border-t-4 border-red-600">
      <div class="bg-white border-b border-neutral-200 px-3 sm:px-4 py-2 flex flex-wrap sm:flex-nowrap items-center gap-2">
        <div class="flex items-center gap-2 w-full sm:w-auto sm:flex-1 min-w-0">
          <div class="min-w-0 flex-1">
            <p id="visorPdfProjeto" class="text-[10px] font-bold uppercase text-red-600 truncate"></p>
            <h3 id="visorPdfTitulo" class="text-sm font-black text-neutral-900 truncate"></h3>
          </div>
          <button type="button" onclick="paFecharVisualizador()" class="sm:hidden shrink-0 w-9 h-9 rounded bg-neutral-900 text-white text-sm font-bold" aria-label="Fechar visualizador">✕</button>
        </div>
        <div class="flex items-center gap-2 w-full sm:w-auto">
          <span id="visorPdfPaginas" class="text-[11px] text-neutral-500 font-semibold whitespace-nowrap"></span>
          <div class="flex items-center gap-1">
            <button type="button" onclick="paZoom(-1)" class="w-8 h-8 rounded border border-neutral-300 hover:bg-neutral-100 font-black text-sm" title="Diminuir zoom" aria-label="Diminuir zoom">−</button>
            <button type="button" onclick="paAjustar()" id="visorPdfZoom" class="h-8 px-2 rounded border border-neutral-300 hover:bg-neutral-100 text-[11px] font-bold min-w-[52px]" title="Ajustar à largura da tela">100%</button>
            <button type="button" onclick="paZoom(1)" class="w-8 h-8 rounded border border-neutral-300 hover:bg-neutral-100 font-black text-sm" title="Aumentar zoom" aria-label="Aumentar zoom">＋</button>
          </div>
          <button type="button" onclick="paBaixar(paVisor.projetoId)" class="ml-auto sm:ml-0 h-8 px-3 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-bold whitespace-nowrap">⬇ Baixar PDF</button>
          <button type="button" onclick="paFecharVisualizador()" class="hidden sm:block h-8 px-3 rounded bg-neutral-900 hover:bg-neutral-700 text-white text-xs font-bold whitespace-nowrap" aria-label="Fechar visualizador">✕ Fechar</button>
        </div>
      </div>
      <div id="visorPdfArea" class="flex-1 overflow-auto p-2 sm:p-4" tabindex="0">
        <div id="visorPdfPaginasArea" class="flex flex-col items-center gap-3 w-max min-w-full"></div>
        <div id="visorPdfStatus" class="text-center text-xs text-neutral-500 py-10"></div>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', ev => { if (ev.target === el) paFecharVisualizador(); });
  let espera;
  window.addEventListener('resize', () => {
    if (el.classList.contains('hidden') || paVisor.ajuste !== 'largura') return;
    clearTimeout(espera);
    espera = setTimeout(() => paRenderizarPaginas(), 250);
  });
  document.addEventListener('keydown', ev => {
    if (el.classList.contains('hidden')) return;
    if (ev.key === 'Escape') paFecharVisualizador();
  });
}

async function paAbrirVisualizador(projetoId) {
  const projeto = projetos.find(p => p.id === projetoId);
  if (!projeto || !projeto.arquivo) return;
  paGarantirVisor();
  const token = ++paVisor.token;
  Object.assign(paVisor, { projetoId, blob: null, pdf: null, escala: null, ajuste: 'largura' });
  document.getElementById('visorPdfProjeto').textContent = projeto.nome;
  document.getElementById('visorPdfTitulo').textContent = projeto.arquivo.nome;
  document.getElementById('visorPdfPaginas').textContent = '';
  document.getElementById('visorPdfPaginasArea').innerHTML = '';
  const status = document.getElementById('visorPdfStatus');
  status.textContent = 'Carregando o PDF...';
  status.classList.remove('hidden');
  document.getElementById('modalVisorPdf').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  try {
    const [lib, blob] = await Promise.all([paCarregarPdfJs(), paObterBlob(projeto)]);
    if (token !== paVisor.token) return;
    paVisor.blob = blob;
    const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    if (token !== paVisor.token) return;
    paVisor.pdf = pdf;
    document.getElementById('visorPdfPaginas').textContent = `${pdf.numPages} página${pdf.numPages > 1 ? 's' : ''}`;
    status.classList.add('hidden');
    await paRenderizarPaginas();
    document.getElementById('visorPdfArea').focus();
  } catch (e) {
    if (token !== paVisor.token) return;
    status.innerHTML = `<p class="font-bold text-red-700 mb-2">Não foi possível abrir o PDF.</p><p>${escaparHtml(paMensagemErro(e))}</p>
      <button type="button" onclick="paBaixar(paVisor.projetoId)" class="mt-3 px-3 py-1.5 rounded bg-red-600 text-white font-bold">Tentar baixar o arquivo</button>`;
  }
}

function paFecharVisualizador() {
  const el = document.getElementById('modalVisorPdf');
  if (!el) return;
  el.classList.add('hidden');
  document.body.style.overflow = '';
  paVisor.token++;
  if (paVisor.observador) paVisor.observador.disconnect();
  if (paVisor.pdf) paVisor.pdf.destroy();
  Object.assign(paVisor, { projetoId: null, blob: null, pdf: null, observador: null });
  document.getElementById('visorPdfPaginasArea').innerHTML = '';
}

// Cria as páginas com o tamanho certo e desenha só as que estão perto da área visível
async function paRenderizarPaginas() {
  const pdf = paVisor.pdf;
  if (!pdf) return;
  const area = document.getElementById('visorPdfArea');
  const cont = document.getElementById('visorPdfPaginasArea');
  const primeira = await pdf.getPage(1);
  const base = primeira.getViewport({ scale: 1 });
  if (paVisor.ajuste === 'largura' || !paVisor.escala) {
    const larguraUtil = Math.max(200, area.clientWidth - (window.innerWidth < 640 ? 16 : 40));
    paVisor.escala = Math.min(larguraUtil / base.width, 1.5); // no computador não amplia demais
  }
  const escala = paVisor.escala;
  document.getElementById('visorPdfZoom').textContent = `${Math.round(escala * 100)}%`;

  if (paVisor.observador) paVisor.observador.disconnect();
  const posRelativa = area.scrollHeight > 0 ? area.scrollTop / area.scrollHeight : 0;
  cont.innerHTML = '';
  const paginas = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pag = i === 1 ? primeira : await pdf.getPage(i);
    const vp = pag.getViewport({ scale: escala });
    const caixa = document.createElement('div');
    caixa.className = 'bg-white shadow-md relative shrink-0';
    caixa.style.width = `${Math.floor(vp.width)}px`;
    caixa.style.height = `${Math.floor(vp.height)}px`;
    caixa.dataset.pagina = i;
    caixa.innerHTML = `<span class="absolute inset-0 flex items-center justify-center text-[11px] text-neutral-300">Página ${i}</span>`;
    cont.appendChild(caixa);
    paginas.push({ caixa, pag, vp });
  }
  area.scrollTop = posRelativa * area.scrollHeight;

  const token = paVisor.token;
  const desenhar = async item => {
    if (item.desenhada) return;
    item.desenhada = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(item.vp.width * dpr);
    canvas.height = Math.floor(item.vp.height * dpr);
    canvas.style.width = `${Math.floor(item.vp.width)}px`;
    canvas.style.height = `${Math.floor(item.vp.height)}px`;
    canvas.className = 'block';
    try {
      await item.pag.render({ canvasContext: canvas.getContext('2d'), viewport: item.vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      if (token !== paVisor.token || !item.caixa.isConnected) return;
      item.caixa.innerHTML = '';
      item.caixa.appendChild(canvas);
    } catch (e) { item.desenhada = false; }
  };
  paVisor.observador = new IntersectionObserver(entradas => {
    entradas.forEach(en => {
      if (!en.isIntersecting) return;
      const item = paginas[Number(en.target.dataset.pagina) - 1];
      if (item) desenhar(item);
    });
  }, { root: area, rootMargin: '600px 0px' });
  paginas.forEach(p => paVisor.observador.observe(p.caixa));
}

function paZoom(direcao) {
  if (!paVisor.pdf) return;
  const passos = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  const atual = paVisor.escala || 1;
  const prox = direcao > 0 ? passos.find(s => s > atual + 0.01) : [...passos].reverse().find(s => s < atual - 0.01);
  if (!prox) return;
  paVisor.ajuste = 'manual';
  paVisor.escala = prox;
  paRenderizarPaginas();
}

function paAjustar() {
  if (!paVisor.pdf) return;
  paVisor.ajuste = 'largura';
  paRenderizarPaginas();
}
