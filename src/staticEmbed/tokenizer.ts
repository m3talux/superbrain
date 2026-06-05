/**
 * WordPiece tokenizer for Model2Vec / potion-base-8M.
 * Adapted from @yarflam/potion-base-8m (MIT). See LICENSE.attribution.
 */
import fs from "node:fs";

export interface TokenizerData {
  vocab: Record<string, number>;
  unkTokenId: number;
  continuingSubwordPrefix: string;
  maxInputCharsPerWord: number;
  doLowerCase: boolean;
  specialTokens: Set<number>;
}

export function loadTokenizerSync(tokenizerJsonPath: string): TokenizerData {
  const raw = fs.readFileSync(tokenizerJsonPath, "utf-8");
  const parsed = JSON.parse(raw);
  const vocab: Record<string, number> = parsed.model.vocab;
  const unkToken: string = parsed.model.unk_token ?? "[UNK]";
  return {
    vocab,
    unkTokenId: vocab[unkToken] ?? 1,
    continuingSubwordPrefix: parsed.model.continuing_subword_prefix ?? "##",
    maxInputCharsPerWord: parsed.model.max_input_chars_per_word ?? 100,
    doLowerCase: parsed.normalizer?.lowercase ?? true,
    specialTokens: new Set<number>(
      (parsed.added_tokens ?? []).map((t: { id: number }) => t.id)
    ),
  };
}

function normalizeText(text: string, doLowerCase: boolean): string {
  let s = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return doLowerCase ? s.toLowerCase() : s;
}

function preTokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const char of text) {
    if (/\s/.test(char)) {
      if (current) { tokens.push(current); current = ""; }
    } else if (/[.!?,:;"'()[\]{}]/.test(char)) {
      if (current) { tokens.push(current); current = ""; }
      tokens.push(char);
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function wordpieceTokenize(word: string, tok: TokenizerData): number[] {
  if (word.length > tok.maxInputCharsPerWord) return [tok.unkTokenId];
  const subTokens: number[] = [];
  let start = 0;
  while (start < word.length) {
    let end = word.length;
    let found: number | null = null;
    while (start < end) {
      const sub = (start > 0 ? tok.continuingSubwordPrefix : "") + word.substring(start, end);
      if (tok.vocab[sub] !== undefined) { found = tok.vocab[sub]; break; }
      end--;
    }
    if (found === null) return [tok.unkTokenId];
    subTokens.push(found);
    start = end;
  }
  return subTokens;
}

export function tokenizeSync(text: string, tok: TokenizerData): number[] {
  const normalized = normalizeText(text, tok.doLowerCase);
  const preTokens = preTokenize(normalized);
  const ids: number[] = [];
  for (const word of preTokens) {
    for (const id of wordpieceTokenize(word, tok)) ids.push(id);
  }
  return ids;
}
