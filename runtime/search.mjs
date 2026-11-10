// Retrieval scoring: BM25 over stemmed tokens, with a small generic synonym
// map and per-item aliases. Pure functions, no dependencies, no I/O. The
// corpus statistics (IDF, average length) are computed only over the items the
// caller passes in, which are the items one principal may read, so a hidden
// item cannot influence what a reader sees.

const STOP = new Set(
  'the a an of to and or in on for is it we do are was were be been am as at by from with that this these those our us you your i my me what how which who whom when where why does did has have had not can could would should will shall may might one every each any all today than then there their they them its if so but about into over also'.split(' '),
);

// ---- stemmer (Porter-style, trimmed) -------------------------------------------

const VOWEL = /[aeiouy]/;

export function stem(input) {
  let w = String(input).toLowerCase();
  if (w.length <= 3 || /[^a-z]/.test(w)) return w; // digits and non-Latin scripts stay as written
  // step 1a
  if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ies')) w = `${w.slice(0, -3)}i`;
  else if (w.endsWith('ss')) { /* keep */ } else if (w.endsWith('s')) w = w.slice(0, -1);
  // step 1b
  if (w.endsWith('eed')) {
    if (w.length > 4) w = w.slice(0, -1);
  } else {
    for (const suffix of ['ed', 'ing']) {
      if (w.endsWith(suffix) && VOWEL.test(w.slice(0, -suffix.length))) {
        w = w.slice(0, -suffix.length);
        if (/(at|bl|iz)$/.test(w)) w += 'e';
        else if (/([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1);
        break;
      }
    }
  }
  // step 1c
  if (w.endsWith('y') && w.length > 3 && VOWEL.test(w.slice(0, -1))) w = `${w.slice(0, -1)}i`;
  // steps 2-4: common derivational suffixes, keeping a stem of 4+ letters
  const rules = [
    ['ational', 'ate'], ['tional', 'tion'], ['ization', 'ize'], ['izer', 'ize'], ['fulness', 'ful'],
    ['ousness', 'ous'], ['iveness', 'ive'], ['ation', 'ate'], ['ator', 'ate'], ['alism', 'al'],
    ['ness', ''], ['ment', ''], ['ance', ''], ['ence', ''], ['able', ''], ['ible', ''],
    ['ful', ''], ['ous', ''], ['ive', ''], ['ic', ''], ['al', ''], ['er', ''], ['ity', ''],
  ];
  for (const [suffix, replacement] of rules) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 4) {
      w = w.slice(0, -suffix.length) + replacement;
      break;
    }
  }
  if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
  return w;
}

export function tokenize(text) {
  return (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((token) => !STOP.has(token) && (token.length > 1 || /\d/.test(token)))
    .map(stem);
}

// ---- synonyms -------------------------------------------------------------------

// Generic business and research vocabulary. Groups are symmetric; a query word
// also scores its group mates at a discount.
const SYNONYM_GROUPS = [
  ['funder', 'investor', 'backer', 'patron', 'sponsor', 'donor', 'grantor', 'supporter'],
  ['money', 'funding', 'capital', 'finance', 'cash', 'fundraising'],
  ['deck', 'presentation', 'pitch', 'slides'],
  ['critic', 'reviewer', 'evaluator'],
  ['false', 'untrue', 'incorrect', 'wrong', 'inaccurate'],
  ['story', 'tale', 'narrative'],
  ['objection', 'pushback', 'rebuttal', 'counterargument'],
  ['gpu', 'graphics', 'accelerator'],
  ['partner', 'collaborator', 'ally'],
  ['goal', 'objective', 'target', 'aim'],
  ['risk', 'danger', 'hazard'],
  ['rule', 'policy', 'guideline', 'principle'],
  ['experiment', 'trial', 'pilot'],
  ['evidence', 'proof'],
  ['measure', 'metric', 'indicator', 'kpi'],
  ['customer', 'client', 'buyer'],
  ['hire', 'recruit', 'staff'],
  ['launch', 'release', 'publish'],
  ['cost', 'price', 'expense', 'spend'],
  ['income', 'revenue', 'earnings', 'sales'],
  ['deadline', 'cutoff'],
  ['meeting', 'call', 'conversation'],
  ['plan', 'roadmap', 'strategy'],
  ['lawyer', 'counsel', 'attorney'],
  ['grant', 'award', 'fellowship'],
  ['verify', 'validate', 'audit'],
  ['founder', 'cofounder'],
  ['mistake', 'error', 'fault'],
  ['promise', 'commitment', 'pledge'],
  ['decline', 'reject', 'refuse'],
  ['bet', 'wager', 'gamble'],
  ['stop', 'kill', 'halt', 'abandon'],
  ['checklist', 'gate', 'criteria'],
  ['weakness', 'flaw', 'gap', 'vulnerability'],
  ['skeptical', 'sceptical', 'skeptic', 'sceptic', 'doubtful'],
  ['group', 'cohort', 'batch'],
  ['size', 'number', 'count', 'amount'],
];

const SYNONYMS = (() => {
  const map = new Map();
  for (const group of SYNONYM_GROUPS) {
    const stems = [...new Set(group.map(stem))];
    for (const term of stems) {
      map.set(term, new Set([...(map.get(term) ?? []), ...stems.filter((other) => other !== term)]));
    }
  }
  return map;
})();

// ---- BM25 -------------------------------------------------------------------------

const K1 = 1.2;
const B = 0.3;
const SYNONYM_WEIGHT = 0.6;
// Field weights: a term in the title or an alias counts like several body hits.
const W_TITLE = 3;
const W_ALIAS = 3;
const W_SUMMARY = 2;

export function indexDocs(items) {
  const docs = items.map((item) => {
    const tf = new Map();
    const add = (text, weight) => {
      for (const token of tokenize(text)) tf.set(token, (tf.get(token) ?? 0) + weight);
    };
    add(item.text, 1);
    add(item.title, W_TITLE);
    add(item.aliases ?? '', W_ALIAS);
    add(item.summary, W_SUMMARY);
    let length = 0;
    for (const count of tf.values()) length += count;
    return { item, tf, length };
  });
  const df = new Map();
  for (const doc of docs) for (const term of doc.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  const avg = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(docs.length, 1);
  return { docs, df, avg: avg || 1, n: docs.length };
}

function termScore(index, doc, term) {
  const tf = doc.tf.get(term);
  if (!tf) return 0;
  const df = index.df.get(term);
  const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
  return idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.length) / index.avg)));
}

// Scores one query against the index: for each query word, the best of the
// word itself and its synonyms (discounted); words add up. Returns only items
// with a positive score, best first.
export function rankQuery(index, query) {
  const terms = [...new Set(tokenize(query))];
  const scored = [];
  for (const doc of index.docs) {
    let score = 0;
    for (const term of terms) {
      let best = termScore(index, doc, term);
      for (const synonym of SYNONYMS.get(term) ?? []) {
        best = Math.max(best, SYNONYM_WEIGHT * termScore(index, doc, synonym));
      }
      score += best;
    }
    if (score > 0) scored.push({ item: doc.item, score });
  }
  return scored.sort((a, b) => b.score - a.score || String(b.item.updated).localeCompare(String(a.item.updated)) || a.item.id.localeCompare(b.item.id));
}

// Several rephrasings ("q1 | q2 | q3"): rank each, fuse by reciprocal rank so
// an item that answers more than one phrasing rises, one hit still counts.
export function rankQueries(index, queries) {
  const fused = new Map();
  for (const query of queries) {
    rankQuery(index, query).forEach(({ item }, rank) => {
      const entry = fused.get(item.id) ?? { item, score: 0, best: rank };
      entry.score += 1 / (10 + rank);
      entry.best = Math.min(entry.best, rank);
      fused.set(item.id, entry);
    });
  }
  return [...fused.values()].sort(
    (a, b) => b.score - a.score || a.best - b.best || String(b.item.updated).localeCompare(String(a.item.updated)) || a.item.id.localeCompare(b.item.id),
  );
}

export function splitQueries(query) {
  return String(query).split('|').map((part) => part.trim()).filter(Boolean);
}
