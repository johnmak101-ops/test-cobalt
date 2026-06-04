// @ts-check
/**
 * Vite plugin (dev-only) that injects `data-pave-source="src/Foo.tsx:line:col"`
 * onto every JSX/TSX element. The Pave Studio inspector reads this attribute
 * when an element is clicked, so the chat reference includes the source location.
 *
 * Uses only @babel/parser and magic-string — both are transitive Vite deps.
 */
import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import path from 'node:path';

const VALID_EXTS = new Set(['.jsx', '.tsx']);

/** @returns {import('vite').Plugin} */
export function paveSourceTagger() {
  return {
    name: 'vite-plugin-pave-source-tagger',
    apply: 'serve',
    enforce: 'pre',

    transform(code, id) {
      if (!VALID_EXTS.has(path.extname(id)) || id.includes('node_modules')) {
        return null;
      }

      let ast;
      try {
        ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
      } catch {
        return null;
      }

      const ms = new MagicString(code);
      const rel = path.relative(process.cwd(), id);

      walkAst(ast, (node) => {
        if (node.type !== 'JSXOpeningElement') return;
        if (node.name?.type !== 'JSXIdentifier') return;

        const alreadyTagged = node.attributes?.some(
          (a) => a.type === 'JSXAttribute' && a.name?.name === 'data-pave-source'
        );
        if (alreadyTagged) return;

        const loc = node.name.loc?.start;
        if (!loc || node.name.end == null) return;

        ms.appendLeft(node.name.end, ` data-pave-source="${rel}:${loc.line}:${loc.column}"`);
      });

      if (ms.toString() === code) return null;
      return { code: ms.toString(), map: ms.generateMap({ hires: true }) };
    },
  };
}

/**
 * Minimal recursive AST walker — visits every node, calls visitor(node).
 * @param {any} node
 * @param {(node: any) => void} visitor
 */
function walkAst(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'tokens' || key === 'comments') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) walkAst(item, visitor);
    } else if (child && typeof child === 'object' && child.type) {
      walkAst(child, visitor);
    }
  }
}
