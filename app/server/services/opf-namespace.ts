/**
 * Package documents come in two spellings of the same XML: a default
 * namespace (`<package xmlns="…opf">`, by far the most common) and a prefix
 * (`<opf:package xmlns:opf="…opf">`, which some Calibre exports produce). The
 * parser and the writer both address elements by name — `package`,
 * `metadata`, `manifest`, `item`, `spine` — so a prefixed document used to
 * read as having none of them: the parser fell back to the filename title
 * and an empty author, and the writer appended a SECOND `<metadata>` and
 * `<manifest>` after the closing root tag (epubcheck RSC-005, "documents may
 * contain only one root"). Found 2026-10-26 on a real library file.
 *
 * `unprefixOpf` turns a parsed prefixed document into the default-namespace
 * shape in place: every element key carrying the root's prefix loses it, and
 * the package gains `xmlns` for the OPF namespace so the unprefixed elements
 * stay in it when the writer serialises them back. The prefix declaration
 * itself is kept because attributes such as `opf:role` and `opf:file-as`
 * still use it, and both declarations may legally bind the same URI.
 * Attribute keys (`@_…`) and text keys (`#text`) are never renamed; `dc:`
 * elements are a different prefix and are never touched.
 *
 * One subtlety keeps the transformation faithful: in a prefixed document an
 * UNprefixed element with no `xmlns` of its own was in NO namespace at all
 * (the root declares only the prefix), and epubcheck accepts such elements
 * inside `<metadata>` as foreign — a 2.0 package from the wild carried
 * `<meta property="dcterms:modified">` that way. Once the package declares a
 * default namespace that element would be pulled into OPF, where the 2.0
 * schema rejects `property`. So every unprefixed, undeclared element gets an
 * explicit `xmlns=""`, which undeclares the default and leaves it exactly as
 * foreign as it was.
 */

export const OPF_NAMESPACE = 'http://www.idpf.org/2007/opf';

/** Element names the parser and writer expect as arrays. `isArray` sees the
 * RAW tag name, so a prefixed `opf:item` must match the same way `item` does;
 * the `dc:` names are a different namespace and match only exactly. */
const OPF_LIST_ELEMENTS = new Set(['item', 'meta']);
const DC_LIST_ELEMENTS = new Set(['dc:title', 'dc:creator', 'dc:identifier', 'dc:subject']);

export function isOpfListElement(tagName: string): boolean {
  if (DC_LIST_ELEMENTS.has(tagName)) return true;
  const colon = tagName.indexOf(':');
  const local = colon === -1 ? tagName : tagName.slice(colon + 1);
  return OPF_LIST_ELEMENTS.has(local);
}

const isElementKey = (key: string): boolean => !key.startsWith('@_') && !key.startsWith('#');

/** An unprefixed, undeclared element was in no namespace; pin that with
 * `xmlns=""` so a default namespace added on the package cannot claim it. A
 * text-only element parses as a bare string and has to become an object to
 * carry the attribute. */
function pinNoNamespace(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pinNoNamespace);
  if (value === null || typeof value !== 'object') {
    return { '#text': value, '@_xmlns': '' };
  }
  const element = value as Record<string, unknown>;
  return element['@_xmlns'] === undefined ? { ...element, '@_xmlns': '' } : element;
}

function renameKeys(node: unknown, prefix: string): unknown {
  if (Array.isArray(node)) return node.map((child) => renameKeys(child, prefix));
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (!isElementKey(key)) {
      out[key] = value;
    } else if (key.startsWith(prefix)) {
      out[key.slice(prefix.length)] = renameKeys(value, prefix);
    } else if (!key.includes(':')) {
      out[key] = pinNoNamespace(renameKeys(value, prefix));
    } else {
      out[key] = renameKeys(value, prefix);
    }
  }
  return out;
}

/** Generic so the XML parser's loosely typed output passes through unchanged
 * for the parser, which reads it dynamically. */
export function unprefixOpf<T extends Record<string, unknown>>(opf: T): T {
  if (opf.package !== undefined) return opf;
  const rootKey = Object.keys(opf).find((key) => isElementKey(key) && key.endsWith(':package'));
  if (rootKey === undefined) return opf;
  const prefix = rootKey.slice(0, -'package'.length); // "opf:"
  const renamed = renameKeys(opf, prefix) as T;
  const pkg = renamed.package as Record<string, unknown> | undefined;
  if (pkg !== undefined && typeof pkg === 'object' && pkg['@_xmlns'] === undefined) {
    pkg['@_xmlns'] = OPF_NAMESPACE;
  }
  return renamed;
}
