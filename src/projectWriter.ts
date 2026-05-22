export interface AppendOpts {
  sizeCap?: number; // bytes; default 20480
}

export interface ArchivedSection {
  date: string; // YYYY-MM-DD extracted from the heading
  content: string; // the content after the heading, up to (but not including) the next ### or ## boundary
}

export interface AppendResult {
  body: string; // updated full body
  archived: ArchivedSection[]; // sections that overflowed; caller persists them
}

const DEFAULT_SIZE_CAP = 20480;
const RECENT_HEADING = "## Recent activity";

export function appendDatedSection(
  body: string,
  date: string,
  content: string
): string {
  if (
    !body.includes(`\n${RECENT_HEADING}\n`) &&
    !body.endsWith(RECENT_HEADING) &&
    !body.startsWith(`${RECENT_HEADING}\n`)
  ) {
    throw new Error(`project body missing '${RECENT_HEADING}' section`);
  }
  if (new RegExp(`(^|\\n)### ${escapeRegex(date)}\\n`).test(body)) {
    throw new Error(`duplicate heading: ### ${date}`);
  }
  const newSection = `### ${date}\n\n${content}\n\n`;
  // Insert immediately after "## Recent activity\n"
  const updated = body.replace(
    `${RECENT_HEADING}\n`,
    `${RECENT_HEADING}\n\n${newSection}`
  );
  // Normalize excessive blank lines (3+ newlines -> 2)
  return updated.replace(/\n{3,}/g, "\n\n");
}

export function appendDatedSectionWithArchive(
  body: string,
  date: string,
  content: string,
  opts: AppendOpts = {}
): AppendResult {
  const cap = opts.sizeCap ?? DEFAULT_SIZE_CAP;
  let updated = appendDatedSection(body, date, content);
  const archived: ArchivedSection[] = [];

  while (Buffer.byteLength(updated, "utf8") > cap) {
    const oldest = findOldestSubsection(updated);
    if (!oldest) break;
    archived.push({ date: oldest.date, content: oldest.content });
    updated = updated.slice(0, oldest.start) + updated.slice(oldest.end);
    updated = updated.replace(/\n{3,}/g, "\n\n");
  }

  return { body: updated, archived };
}

function findOldestSubsection(
  body: string
): { date: string; content: string; start: number; end: number } | null {
  const recentIdx = body.indexOf(`\n${RECENT_HEADING}\n`);
  const recentStart =
    recentIdx >= 0 ? recentIdx : body.startsWith(`${RECENT_HEADING}\n`) ? 0 : -1;
  if (recentStart < 0) return null;

  const afterHeadingIdx = recentStart + (recentIdx >= 0 ? 1 : 0);
  // Find boundary: next "## " heading (NOT "###") after Recent activity, or end of file
  const afterRecent = body.slice(afterHeadingIdx + RECENT_HEADING.length);
  const nextSectionMatch = afterRecent.match(/\n## [^#]/);
  const recentEnd = nextSectionMatch
    ? afterHeadingIdx + RECENT_HEADING.length + nextSectionMatch.index!
    : body.length;

  // Find all "### YYYY-MM-DD" subsections within the Recent activity block
  const ra = body.slice(afterHeadingIdx, recentEnd);
  const offset = afterHeadingIdx;
  const subSectionRegex = /\n### (\d{4}-\d{2}-\d{2})\n/g;
  let match: RegExpExecArray | null;
  const subs: Array<{ date: string; start: number; end: number }> = [];

  while ((match = subSectionRegex.exec(ra)) !== null) {
    subs.push({ date: match[1], start: match.index + offset, end: -1 });
  }
  if (subs.length === 0) return null;

  // Compute end for each: start of next sub, or recentEnd
  for (let i = 0; i < subs.length; i++) {
    subs[i].end = i + 1 < subs.length ? subs[i + 1].start : recentEnd;
  }

  // Oldest = LAST sub (since they're most-recent-first)
  const oldest = subs[subs.length - 1];
  const block = body.slice(oldest.start, oldest.end);
  // Skip past "\n### date\n"
  const headingEnd = block.indexOf("\n", 1) + 1;
  const content = block.slice(headingEnd).replace(/^\s+|\s+$/g, "");
  return { date: oldest.date, content, start: oldest.start, end: oldest.end };
}

/**
 * Build a minimal project note body when the file does not yet exist.
 * Always includes "## Recent activity" so appendDatedSection can find it.
 */
export function initializeProjectNote(
  slug: string,
  frontmatter: Record<string, any>
): string {
  const title = frontmatter.title || slug;
  return `# ${title}\n\n## Recent activity\n`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
