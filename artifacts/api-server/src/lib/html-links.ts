import { parseDocument } from 'htmlparser2';
import render from 'dom-serializer';
import { Element, Text, isTag, isText, type ChildNode } from 'domhandler';

export function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
function linkedText(
  node: Text,
  links: Map<string, string>,
  pattern: RegExp,
): ChildNode[] {
  const result: ChildNode[] = [];
  let offset = 0;
  for (const match of node.data.matchAll(pattern)) {
    if (match.index > offset)
      result.push(new Text(node.data.slice(offset, match.index)));
    result.push(
      new Element('a', { href: links.get(match[0])! }, [new Text(match[0])]),
    );
    offset = match.index + match[0].length;
  }
  if (!offset) return [node];
  if (offset < node.data.length) result.push(new Text(node.data.slice(offset)));
  return result;
}
function linkNodes(
  nodes: ChildNode[],
  links: Map<string, string>,
  pattern: RegExp,
): ChildNode[] {
  return nodes.flatMap((node) => {
    if (isText(node)) return linkedText(node, links, pattern);
    if (isTag(node) && node.name !== 'a')
      node.children = linkNodes(node.children, links, pattern);
    return [node];
  });
}
// Run only after sanitation. DOM text nodes keep URLs intact across HTML entities;
// streaming sanitizer text callbacks can split a query string at every "&".
export function linkifyHtml(html: string, destinations?: Map<string, string>) {
  const links = new Map(
    [...(destinations ?? [])].filter(
      ([url, destination]) => safeHttpUrl(url) && safeHttpUrl(destination),
    ),
  );
  if (!links.size) return html;
  const pattern = new RegExp(
    [...links.keys()]
      .sort((a, b) => b.length - a.length)
      .map((url) => url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|'),
    'g',
  );
  const document = parseDocument(html);
  document.children = linkNodes(document.children, links, pattern);
  return render(document);
}
