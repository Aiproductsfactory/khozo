// A small, dependency-free XML reader for the parts of an .xlsx package the
// bulk importer needs (sheet cells, shared strings with their font runs,
// styles, drawings and relationships).
//
// It is not a general XML parser: no DTDs, no namespace resolution beyond
// dropping prefixes. It runs the same in the browser and in Node, which is
// why it exists instead of DOMParser: the smoke and acceptance checks parse
// real workbooks under Node with exactly the code the page uses.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s) {
  if (!s || s.indexOf('&') === -1) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
      } catch {
        return m;
      }
    }
    return ENTITIES[e] ?? m;
  });
}

const localName = (q) => {
  const i = q.indexOf(':');
  return i === -1 ? q : q.slice(i + 1);
};

/**
 * Parses XML text into { name, qname, attrs, children, text }.
 * `name` is the local name (prefix dropped), `attrs` is keyed by the
 * qualified name, `text` is the element's own character data.
 */
export function parseXml(xml) {
  const root = { name: '#root', qname: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const n = xml.length;
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      top().text += decodeEntities(xml.slice(i));
      break;
    }
    if (lt > i) top().text += decodeEntities(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      top().text += xml.slice(lt + 9, end === -1 ? n : end);
      i = end === -1 ? n : end + 3;
      continue;
    }
    const c1 = xml[lt + 1];
    if (c1 === '?' || c1 === '!') {
      const end = xml.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (c1 === '/') {
      const end = xml.indexOf('>', lt);
      if (stack.length > 1) stack.pop();
      i = end === -1 ? n : end + 1;
      continue;
    }
    // Start tag: find the closing '>' outside quoted attribute values.
    let j = lt + 1;
    let quote = null;
    for (; j < n; j++) {
      const c = xml[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    const selfClose = xml[j - 1] === '/';
    const inner = xml.slice(lt + 1, selfClose ? j - 1 : j);
    const m = /^[^\s/>]+/.exec(inner);
    const qname = m ? m[0] : '';
    const attrs = {};
    const re = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    re.lastIndex = qname.length;
    let a;
    while ((a = re.exec(inner))) attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '');
    const node = { name: localName(qname), qname, attrs, children: [], text: '' };
    top().children.push(node);
    if (!selfClose) stack.push(node);
    i = j + 1;
  }
  return root;
}

/** Attribute by local name: attr(node, 'embed') finds r:embed. */
export function attr(node, name) {
  if (!node) return undefined;
  if (name in node.attrs) return node.attrs[name];
  for (const [k, v] of Object.entries(node.attrs)) if (localName(k) === name) return v;
  return undefined;
}

export const child = (node, name) => node?.children.find((c) => c.name === name) || null;
export const childrenOf = (node, name) => (node ? node.children.filter((c) => c.name === name) : []);

/** Depth-first search for every descendant with this local name. */
export function descendants(node, name, out = []) {
  if (!node) return out;
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

/** All character data under a node, in document order. */
export function deepText(node) {
  if (!node) return '';
  let s = node.text || '';
  for (const c of node.children) s += deepText(c);
  return s;
}
