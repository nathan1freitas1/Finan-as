/* Meu Caixa: conexão com a nuvem (só a caixinha compartilhada).
   Usa fetch direto no Supabase (login + banco), sem biblioteca. A chave abaixo é a chave PÚBLICA (publishable):
   ela é feita para ficar no app; quem protege os dados são as regras de segurança do banco (RLS). */
(function (root) {
  'use strict';
  const URL_BASE = 'https://fghcoxferprkzsemicnw.supabase.co';
  const CHAVE = 'sb_publishable_f5xtcOn12xXcun7dYQZ8XA_hDJp5WQO';
  const SCHEMA = 'meucaixa';
  const LS = 'mc_sessao';

  let sessao = null;
  try { sessao = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { sessao = null; }

  function guardar(s) {
    sessao = s;
    try { s ? localStorage.setItem(LS, JSON.stringify(s)) : localStorage.removeItem(LS); } catch (e) {}
  }
  const traduzir = (m) => {
    m = String(m || '');
    if (/invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/email not confirmed/i.test(m)) return 'Confirme o e-mail: abra a mensagem que o Supabase enviou e clique no link.';
    if (/already registered|already been registered/i.test(m)) return 'Esse e-mail já tem conta. Use "Entrar".';
    if (/password.*(least|short)|weak/i.test(m)) return 'Senha muito curta ou fraca (use 8 ou mais caracteres).';
    if (/rate limit/i.test(m)) return 'Muitas tentativas. Espere alguns minutos.';
    if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Sem conexão com a internet.';
    return m || 'Algo deu errado.';
  };
  async function chamar(caminho, opcoes) {
    let r;
    try { r = await fetch(URL_BASE + caminho, opcoes); } catch (e) { const er = new Error('Sem conexão com a internet.'); er.offline = true; throw er; }
    let corpo = null;
    const txt = await r.text();
    try { corpo = txt ? JSON.parse(txt) : null; } catch (e) { corpo = txt; }
    if (!r.ok) {
      const er = new Error(traduzir(corpo && (corpo.error_description || corpo.msg || corpo.message || corpo.error)));
      er.status = r.status; er.codigo = corpo && (corpo.code || corpo.error_code); throw er;
    }
    return corpo;
  }
  const auth = (corpo, grant) => chamar('/auth/v1/' + grant, { method: 'POST', headers: { apikey: CHAVE, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  function daResposta(d) {
    guardar({ access_token: d.access_token, refresh_token: d.refresh_token, expira: Date.now() + (d.expires_in - 60) * 1000, email: d.user && d.user.email, id: d.user && d.user.id });
  }

  async function entrar(email, senha) {
    daResposta(await auth({ email: email.trim().toLowerCase(), password: senha }, 'token?grant_type=password'));
  }
  // devolve true se já entrou, false se precisa confirmar o e-mail
  async function cadastrar(email, senha) {
    const d = await auth({ email: email.trim().toLowerCase(), password: senha }, 'signup');
    if (d && d.access_token) { daResposta(d); return true; }
    return false;
  }
  function sair() { guardar(null); }
  const logado = () => !!sessao;
  const email = () => (sessao ? sessao.email : null);
  const meuId = () => (sessao ? sessao.id : null);

  async function token() {
    if (!sessao) throw new Error('Entre na sua conta.');
    if (Date.now() < sessao.expira) return sessao.access_token;
    try {
      const d = await auth({ refresh_token: sessao.refresh_token }, 'token?grant_type=refresh_token');
      daResposta(d);
    } catch (e) { if (!e.offline) { guardar(null); e.message = 'Sua sessão expirou. Entre de novo.'; e.sessaoExpirou = true; } throw e; }
    return sessao.access_token;
  }
  async function api(metodo, caminho, corpo, extra) {
    const t = await token();
    const h = Object.assign({ apikey: CHAVE, Authorization: 'Bearer ' + t, 'Accept-Profile': SCHEMA, 'Content-Profile': SCHEMA }, extra || {});
    if (corpo !== undefined) h['Content-Type'] = 'application/json';
    return chamar('/rest/v1/' + caminho, { method: metodo, headers: h, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  }
  const ler = (tabela, consulta) => api('GET', tabela + '?' + (consulta || 'select=*'));
  const criar = (tabela, linha) => api('POST', tabela, linha, { Prefer: 'return=representation' });
  const mudar = (tabela, filtro, campos) => api('PATCH', tabela + '?' + filtro, campos, { Prefer: 'return=representation' });
  const apagar = (tabela, filtro) => api('DELETE', tabela + '?' + filtro);
  // grava ou atualiza (pela chave primária)
  const gravar = (tabela, linha) => api('POST', tabela, linha, { Prefer: 'resolution=merge-duplicates,return=minimal' });
  // lê tudo, de 1000 em 1000 (limite do servidor)
  async function lerTudo(tabela, filtro) {
    const out = [];
    for (let i = 0; i < 50; i++) {
      const p = await ler(tabela, 'select=*' + (filtro ? '&' + filtro : '') + '&order=id&limit=1000&offset=' + (i * 1000));
      out.push(...p);
      if (p.length < 1000) break;
    }
    return out;
  }
  const rpc = (nome, args) => api('POST', 'rpc/' + nome, args || {});

  root.Nuvem = { entrar, cadastrar, sair, logado, email, meuId, ler, lerTudo, criar, mudar, apagar, gravar, rpc };
})(typeof window !== 'undefined' ? window : globalThis);
