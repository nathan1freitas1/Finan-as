/* Leitura da fatura do cartão Itaú (PDF de texto). Funções puras: recebem os itens de texto que o
   leitor de PDF entrega (texto + posição) e devolvem as compras. Nada aqui acessa rede ou arquivo. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Fatura = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RE_DATA = /^\d{2}\/\d{2}$/;
  const RE_VALOR = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/;
  const COLUNA_DIREITA_A_PARTIR_DE = 345; // a página tem duas colunas; a da direita começa depois desta posição

  // "1.234,56" -> 123456 ; "-96,99" -> -9699
  function parseMoeda(t) {
    const s = String(t).trim();
    if (!RE_VALOR.test(s)) return null;
    const neg = s[0] === '-';
    const n = Math.round(parseFloat(s.replace('-', '').replace(/\./g, '').replace(',', '.')) * 100);
    return neg ? -n : n;
  }

  // junta os itens de texto que estão na mesma altura (mesma linha), da esquerda para a direita
  function agruparLinhas(itens) {
    // ignora espaços e as letras-ícone soltas do Itaú ("L", "P", "S", "=") que podem cair na mesma altura de uma compra
    const ordenados = itens.filter((i) => String(i.s).trim() !== '' && !/^[A-Z=]$/.test(String(i.s).trim())).sort((a, b) => b.y - a.y || a.x - b.x);
    const linhas = [];
    let atual = null, yAtual = null;
    for (const i of ordenados) {
      if (atual === null || Math.abs(i.y - yAtual) > 1.5) { atual = []; linhas.push(atual); yAtual = i.y; }
      atual.push(i);
    }
    return linhas.map((l) => l.sort((a, b) => a.x - b.x));
  }

  // texto de um trecho da linha: só coloca espaço onde existe espaço no PDF
  function juntar(itens) {
    let out = '';
    itens.forEach((i, k) => {
      if (k > 0) {
        const ant = itens[k - 1];
        const folga = i.x - (ant.x + (ant.w || 0));
        if (folga > 0.5 || /\s$/.test(out) || /^\s/.test(i.s)) out += ' ';
      }
      out += String(i.s).trim();
    });
    return out.replace(/\s+/g, ' ').trim();
  }

  const titulo = (s) => s.toLowerCase().replace(/(^|[\s*.\-/])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase());

  // O Itaú cola o começo da cidade no fim do nome ("PADARIA NOVA ESTACAOSAO"), às vezes seguido de "BR"/"BRA".
  function limparDescricao(desc, cidade) {
    let d = desc.replace(/\s+/g, ' ').trim();
    if (cidade) {
      const c = cidade.toLowerCase();
      const variantes = [d, d.replace(/BRA$/i, ''), d.replace(/BR$/i, '')];
      achou: for (const v of variantes) {
        for (let k = Math.min(c.length, 24); k >= 3; k--) {
          if (v.toLowerCase().endsWith(c.slice(0, k)) && v.length - k >= 3) { d = v.slice(0, v.length - k).trim(); break achou; }
        }
      }
    }
    return d === d.toUpperCase() && /[A-Z]/.test(d) ? titulo(d) : d;
  }

  function lerFatura(paginas) {
    const r = { ok: false, vencimento: null, total: null, cartaoFinal: null, itens: [], subtotais: {}, somaItens: 0, confere: false, avisos: [], erro: null };
    let secao = null, titular = null, ultimo = null, totalLanc = null;

    paginas.forEach((itens, idxPag) => {
      // ---- resumo (aparece no alto da 1ª página)
      if (idxPag === 0) {
        agruparLinhas(itens).forEach((lin) => {
          const t = juntar(lin);
          let m;
          if ((m = t.match(/Vencimento:\s*(\d{2})\/(\d{2})\/(\d{4})/))) r.vencimento = m[3] + '-' + m[2] + '-' + m[1];
          if (/Total desta fatura/.test(t)) { const v = lin.map((i) => parseMoeda(i.s)).filter((x) => x != null).pop(); if (v != null) r.total = v; }
          if ((m = t.match(/(\d{4})\.X+\.X+\.(\d{4})/i)) && !r.cartaoFinal) r.cartaoFinal = m[2];
        });
      }
      // ---- cada coluna, da esquerda para a direita, na ordem de leitura
      [itens.filter((i) => i.x < COLUNA_DIREITA_A_PARTIR_DE), itens.filter((i) => i.x >= COLUNA_DIREITA_A_PARTIR_DE)].forEach((col) => {
        if (!col.length) return;
        const datas = col.filter((i) => RE_DATA.test(String(i.s).trim())).map((i) => i.x);
        const ancora = datas.length ? Math.min(...datas) : null;
        agruparLinhas(col).forEach((lin) => {
          const t = juntar(lin);
          if (/Pagamentos efetuados/.test(t)) { secao = 'pag'; return; }
          if (/^Lançamentos: compras e saques/.test(t)) { secao = 'compras'; return; }
          if (/Compras parceladas - próximas faturas/.test(t)) { secao = 'futuras'; ultimo = null; return; }
          if (/Limites de crédito|Encargos cobrados/.test(t)) { secao = 'fim'; ultimo = null; return; }
          if (secao !== 'compras') return;

          if (/Total dos lançamentos atuais/.test(t)) { totalLanc = lin.map((i) => parseMoeda(i.s)).filter((x) => x != null).pop(); ultimo = null; return; }
          if (/^Lançamentos no cartão/.test(t)) {
            const v = lin.map((i) => parseMoeda(i.s)).filter((x) => x != null).pop();
            if (titular != null && v != null) r.subtotais[titular] = v;
            ultimo = null; return;
          }
          // nome do titular (linha só com letras maiúsculas)
          if (lin.length === 1 && /^[A-ZÀ-Ú][A-ZÀ-Ú ]{3,}$/.test(t) && !/^(DATA|ESTABELECIMENTO|VALOR EM R\$)$/.test(t)) {
            titular = titulo(t.split(' ')[0]); ultimo = null; return;
          }
          const primeiro = lin[0], final = lin[lin.length - 1];
          const ehItem = ancora != null && RE_DATA.test(String(primeiro.s).trim()) && Math.abs(primeiro.x - ancora) <= 3
            && lin.length >= 3 && RE_VALOR.test(String(final.s).trim());
          if (ehItem) {
            const meio = lin.slice(1, lin.length - 1);
            let descBruta = juntar(meio);
            let parcela = null, parcelaTotal = null, m;
            if ((m = descBruta.match(/\s(\d{2})\/(\d{2})$/)) && +m[1] >= 1 && +m[2] >= +m[1] && +m[2] <= 99) {
              parcela = +m[1]; parcelaTotal = +m[2]; descBruta = descBruta.slice(0, m.index).trim();
            }
            ultimo = { titular: titular || '', data: String(primeiro.s).trim(), descBruta, desc: descBruta, valor: parseMoeda(final.s), parcela, parcelaTotal, catItau: null, cidade: '' };
            r.itens.push(ultimo);
            return;
          }
          // linha de baixo: "categoria CIDADE"
          if (ultimo && !ultimo.catItau && lin.length >= 1 && /^[a-zà-ú]/.test(t)) {
            const partes = t.split(' ');
            ultimo.catItau = partes[0];
            ultimo.cidade = partes.slice(1).join(' ');
            ultimo.desc = limparDescricao(ultimo.descBruta, ultimo.cidade);
          }
        });
      });
    });

    r.itens.forEach((i) => { if (i.desc === i.descBruta) i.desc = limparDescricao(i.descBruta, ''); });
    r.somaItens = r.itens.reduce((s, i) => s + i.valor, 0);
    const alvo = totalLanc != null ? totalLanc : r.total;
    r.confere = alvo != null && r.somaItens === alvo;
    r.totalLancamentos = alvo;
    if (!r.vencimento || !r.itens.length) {
      r.erro = 'Não encontrei as compras neste PDF. Ele precisa ser a fatura do cartão Itaú em PDF (não foto).';
      return r;
    }
    if (!r.confere) r.avisos.push('A soma das compras lidas não bate com o total da fatura. Confira a lista antes de importar.');
    r.ok = true;
    return r;
  }

  // ---------- categoria sugerida ----------
  const CAT_ITAU = {
    supermercado: 'mercado', restaurante: 'alimentacao', saúde: 'saude', saude: 'saude', transporte: 'carro',
    educacao: 'educacao', educação: 'educacao', lazer: 'lazer', viagem: 'lazer',     serviços: 'outros', servicos: 'outros', vestuário: 'outros', vestuario: 'outros', eletronicos: 'outros', eletrônicos: 'outros',
  };
  const PALAVRAS = [
    [/(^|[^a-z])posto|combust|ipiranga|petrobras|\bshell\b/i, 'combustivel'],
    [/mercadolivre|mercado\s?livre|\bmercado\*|shopee|aliexpress|tiktok|magalu|amazon|shein|temu/i, 'online'],
    [/padaria|lanche|pizza|pizzaria|restaurante|ifood|ifd\*|99food|sorvete|hamburg|churras|cafe\b|café/i, 'alimentacao'],
    [/\buber\b|uberrides|99\s?pop|cabify|estacionamento|pedagio|pedágio|sem parar/i, 'carro'],
  ];

  // chave estável do estabelecimento (sem números e símbolos) para lembrar a categoria escolhida
  const chaveMemoria = (desc) => String(desc).toLowerCase().replace(/[^a-zà-ú ]/g, ' ').replace(/\s+/g, ' ').trim();

  function sugerirCategoria(item, memoria) {
    const k = chaveMemoria(item.desc);
    if (memoria && k && memoria[k] !== undefined) return memoria[k]; // o que você escolheu antes vale mais
    for (const [re, cat] of PALAVRAS) if (re.test(item.desc)) return cat;
    const c = item.catItau ? CAT_ITAU[item.catItau.toLowerCase()] : null;
    return c || null;
  }

  // identifica a compra para não importar duas vezes a mesma fatura
  function chavesItens(fatura) {
    const vistos = {};
    return fatura.itens.map((i) => {
      const base = [fatura.vencimento, fatura.cartaoFinal || '', i.titular, i.data, i.descBruta, i.valor, i.parcela || ''].join('|');
      vistos[base] = (vistos[base] || 0) + 1;
      return base + '#' + vistos[base];
    });
  }

  return { parseMoeda, agruparLinhas, lerFatura, sugerirCategoria, chaveMemoria, chavesItens, limparDescricao };
});
