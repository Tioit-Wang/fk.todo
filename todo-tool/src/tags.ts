export function normalizeTag(raw: string): string | null {
  let value = (raw ?? "").trim();
  if (!value) return null;

  // Allow users to type "#tag" in the tag input.
  if (value.startsWith("#")) value = value.slice(1).trim();

  // Trim common punctuation users may accidentally include.
  value = value.replace(/^[\s,.;:，。！？、（）()\[\]{}<>《》"'“”]+/, "");
  value = value.replace(/[\s,.;:，。！？、（）()\[\]{}<>《》"'“”]+$/, "");
  value = value.trim();
  if (!value) return null;

  // Normalize ASCII-ish tags so filtering feels consistent (work == WORK).
  if (/^[A-Za-z0-9_-]+$/.test(value)) value = value.toLowerCase();

  // Keep tags short for UI readability.
  if (value.length > 32) value = value.slice(0, 32);

  return value;
}

export function extractTagsFromTitle(input: string): { title: string; tags: string[] } {
  const tokens = (input ?? "").split(/\s+/).filter(Boolean);
  const titleTokens: string[] = [];
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (token.startsWith("#") && token.length > 1) {
      const tag = normalizeTag(token);
      if (tag) {
        if (!seen.has(tag)) {
          tags.push(tag);
          seen.add(tag);
        }
        // Even if it's a duplicate, treat it as a tag token and strip it from the title.
        continue;
      }
    }
    titleTokens.push(token);
  }

  return {
    title: titleTokens.join(" ").trim(),
    tags,
  };
}
