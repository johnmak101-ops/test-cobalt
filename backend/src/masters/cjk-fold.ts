import * as OpenCC from 'opencc-js'

/**
 * Simplified/traditional Chinese folding for MATCH KEYS (shiptrack — Chinese-name retrieval).
 *
 * The Mesh mirror stores Chinese legal names as the ERP wrote them (mostly traditional, e.g.
 * 東莞市嘉發服飾有限公司) while mainland documents write simplified (东莞市嘉发服饰有限公司). A byte
 * comparison misses the same company across scripts, so every name-similarity path folds BOTH sides
 * to simplified before comparing. Comparison-only: stored and displayed values keep their original
 * script — folding never rewrites data (a fold is a key, not a correction).
 */
const toSimplified: (s: string) => string = OpenCC.Converter({ from: 't', to: 'cn' })

/** Any Han ideograph (CJK Unified + Ext-A) — the only inputs worth the converter call. */
const HAS_HAN = /[㐀-鿿]/

/** Fold traditional→simplified for comparison keys; non-CJK strings pass through untouched. */
export function foldCjk(s: string): string {
  return HAS_HAN.test(s) ? toSimplified(s) : s
}
