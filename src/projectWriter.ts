export interface AppendOpts {
  sizeCap?: number;
}

export interface ArchivedSection {
  date: string;
  content: string;
}

export interface AppendResult {
  body: string;
  archived: ArchivedSection[];
}

const DEFAULT_SIZE_CAP = 20480;
const HARD_CEILING_BYTES = Number(process.env.SUPERBRAIN_PROJECT_NOTE_CAP_BYTES) || 32 * 1024;
const LOW_WATER_RATIO = 0.8;
const RECENT_HEADING = "## Recent activity";

const STRUCTURAL_HEADINGS = new Set([
  "## What it is",
  "## Status",
  "## Architecture",
  "## Recent activity",
  "## Gotchas",
]);

interface RawSection { date: string; start: number; end: number; heading: string }

function collectArchivableSections(body: string): RawSection[] {
  const headingRe = /\n(#{2,3}) (.+)\n/g;
  const heads: Array<{ idx: number; level: number; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(body)) !== null) {
    heads.push({ idx: m.index, level: m[1].length, text: m[2].trim() });
  }
  const sections: RawSection[] = [];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const fullHeading = `${"#".repeat(h.level)} ${h.text}`;
    if (h.level === 2 && STRUCTURAL_HEADINGS.has(`## ${h.text}`)) continue;
    const dateM = h.text.match(/^(\d{4}-\d{2}-\d{2})/);
    const isGotcha = /^Gotcha\b/.test(h.text);
    if (!dateM && !isGotcha) continue;
    const start = h.idx;
    const end = i + 1 < heads.length ? heads[i + 1].idx : body.length;
    sections.push({
      date: dateM ? dateM[1] : "0000-00-00",
      start,
      end,
      heading: fullHeading,
    });
  }
  return sections;
}

function findOldestArchivableSection(
  body: string,
): { date: string; content: string; start: number; end: number } | null {
  const secs = collectArchivableSections(body);
  if (secs.length === 0) return null;
  let oldest = secs[0];
  for (const s of secs) {
    if (s.date < oldest.date || (s.date === oldest.date && s.start < oldest.start)) oldest = s;
  }
  const block = body.slice(oldest.start, oldest.end);
  const headingEnd = block.indexOf("\n", 1) + 1;
  const content = block.slice(headingEnd).replace(/^\s+|\s+$/g, "");
  return { date: oldest.date, content, start: oldest.start, end: oldest.end };
}

export function appendDatedSection(
  body: string,
  date: string,
  content: string,
): string {
  if (
    !body.includes(`\n${RECENT_HEADING}\n`) &&
    !body.endsWith(RECENT_HEADING) &&
    !body.startsWith(`${RECENT_HEADING}\n`)
  ) {
    throw new Error(`project body missing '${RECENT_HEADING}' section`);
  }
  const dupRe = new RegExp(`((?:^|\\n)### ${escapeRegex(date)}\\n)`);
  if (dupRe.test(body)) {
    return body.replace(dupRe, `$1\n${content}\n\n`).replace(/\n{3,}/g, "\n\n");
  }
  const newSection = `### ${date}\n\n${content}\n\n`;
  const updated = body.replace(
    `${RECENT_HEADING}\n`,
    `${RECENT_HEADING}\n\n${newSection}`,
  );
  return updated.replace(/\n{3,}/g, "\n\n");
}

export function appendDatedSectionWithArchive(
  body: string,
  date: string,
  content: string,
  opts: AppendOpts = {},
): AppendResult {
  const cap = opts.sizeCap ?? HARD_CEILING_BYTES;
  const lowWater = Math.floor(cap * LOW_WATER_RATIO);
  let updated = appendDatedSection(body, date, content);
  const archived: ArchivedSection[] = [];

  if (Buffer.byteLength(updated, "utf8") > cap) {
    let target = lowWater;
    while (Buffer.byteLength(updated, "utf8") > target) {
      const oldest = findOldestArchivableSection(updated);
      if (!oldest) break;
      archived.push({ date: oldest.date, content: oldest.content });
      updated = updated.slice(0, oldest.start) + updated.slice(oldest.end);
      updated = updated.replace(/\n{3,}/g, "\n\n");
      if (Buffer.byteLength(updated, "utf8") <= cap && archived.length > 0) target = cap;
    }
  }

  return { body: updated, archived };
}

/**
 * Build a minimal project note body when the file does not yet exist.
 * Always includes "## Recent activity" so appendDatedSection can find it.
 */
export function initializeProjectNote(
  slug: string,
  frontmatter: Record<string, any>,
): string {
  const title = frontmatter.title || slug;
  return `# ${title}\n\n## Recent activity\n`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
