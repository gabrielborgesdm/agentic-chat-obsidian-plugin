import type { Attachment, ToolCall } from "../types";

/**
 * Deterministic handling of the most common write requests, so they do not
 * depend on the small on-device model choosing the right tool (or asking the
 * user for a path). Returns the tool calls to run directly, or null to use the model.
 *
 * Defaults instead of questions:
 *  - "add X" with no target -> current note, or today's daily note if none is open
 *  - "create X at the root / in folder Y" -> create_note
 */

const ADD_VERB = /\b(add|insert|put|embed|attach|save|adiciona\w*|adicione|insere|inserir|insira|coloca\w*|coloque|anexa\w*|salva\w*|p[oõ]e)\b/i;
const VERB = String.raw`(?:please\s+|por favor\s+)?(?:add|append|write|insert|put|adiciona(?:r)?|adicione|coloca(?:r)?|coloque|escreve(?:r)?|escreva|anota(?:r)?|anote|p[oõ]e)`;
const PREP = String.raw`(?:to|into|in|on|na|no|em|ao|[àa]|para|pra)`;
/** "that note", "this note", "nessa nota", "na nota atual", "to my notes", "nas notas" ... */
const CURRENT = String.raw`(?:(?:to|into|in|on)\s+(?:that|this|the current|the open|the same|my current|current)\s+note|(?:to|into|in|on)\s+(?:the|my)\s+notes?|(?:na|em|para|pra)\s+(?:essa|esta)\s+nota|(?:nessa|nesta)\s+nota|(?:na|para|pra)\s+nota\s+(?:atual|aberta)|(?:na|nas|na minha|nas minhas|[àa]s?)\s+notas?)`;
const Q_OPEN = "[\"“'`]?";
const Q_CLOSE = "[\"”'`]?";

const RE_CURRENT = new RegExp(String.raw`^${VERB}\s+${Q_OPEN}([\s\S]+?)${Q_CLOSE}\s+${CURRENT}\s*[.!]?\s*$`, "i");
const RE_NAMED = new RegExp(
  String.raw`^${VERB}\s+${Q_OPEN}([\s\S]+?)${Q_CLOSE}\s+${PREP}\s+(?:(?:the\s+)?note|(?:a\s+)?nota)\s+["“\[]*([^"”\]\n]+?)["”\]]*\s*[.!]?\s*$`,
  "i"
);
const RE_LINK = new RegExp(String.raw`^${VERB}\s+${Q_OPEN}([\s\S]+?)${Q_CLOSE}\s+${PREP}\s+\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*[.!]?\s*$`, "i");

const CREATE_VERB = String.raw`(?:please\s+|por favor\s+)?(?:create|make|cria(?:r)?|crie|fa[çc]a)`;
const RE_CREATE = new RegExp(
  String.raw`^${CREATE_VERB}\s+(?:(?:a|an|uma|um)\s+)?(?:(?:new|nova|novo)\s+)?(?:(?:note|nota|file|arquivo|page|p[aá]gina)\s+)?` +
    String.raw`(?:(called|named|titled|chamad[ao]|com\s+o\s+(?:nome|t[ií]tulo))\s+)?` +
    String.raw`["“']?(.+?)["”']?` +
    String.raw`(?:\s+(?:at|in|on|into|inside|na|no|em|dentro\s+d[ae])\s+(?:the\s+|a\s+|o\s+|my\s+|minha\s+)?(?:(root|raiz|vault|cofre)|(?:folder|pasta)\s+["“']?([^"”'\n]+?)["”']?|["“']?([^"”'\n]+?)["”']?\s+folder))?` +
    String.raw`(?:\s*[,:]?\s+(?:with|com)\s+(?:(?:the|o)\s+)?(?:(?:texto|text|conte[uú]do|content)\b)?\s*:?\s*["“']?([\s\S]+?)["”']?)?` +
    String.raw`\s*[.!]?\s*$`,
  "i"
);

function embed(a: Attachment): string {
  return a.kind === "image" ? `![[${a.path}]]` : `[[${a.path}]]`;
}

function appendTo(currentPath: string | null, content: string): ToolCall[] {
  return currentPath
    ? [{ name: "append_to_note", arguments: { path: currentPath, content } }]
    : [{ name: "append_to_daily_note", arguments: { content } }];
}

export function detectFastPath(
  text: string,
  attachments: Attachment[],
  currentPath: string | null,
  resolve: (name: string) => string | null = () => null
): ToolCall[] | null {
  const t = text.trim();

  // 1) attachments + "add it to the note" (or no text at all) -> current note
  if (attachments.length && currentPath && (!t || t === "(attachment)" || (ADD_VERB.test(t) && t.length < 200))) {
    return appendTo(currentPath, attachments.map(embed).join("\n"));
  }

  // 2) "add <text> to [[Note]]" / "add <text> to note <Name>" -> that note, if it exists
  const named = t.match(RE_LINK) ?? t.match(RE_NAMED);
  if (named && named[1].trim()) {
    const target = resolve(named[2].trim());
    if (target) return [{ name: "append_to_note", arguments: { path: target, content: named[1].trim() } }];
  }

  // 3) "add <text> to this note / to my notes" -> current note, else today's daily note
  const cur = t.match(RE_CURRENT);
  if (cur && cur[1].trim()) return appendTo(currentPath, cur[1].trim());

  // 4) "create <title> at the root / in folder X / with <text>"
  const c = t.match(RE_CREATE);
  if (c) {
    const [, namedKw, rawTitle, root, folderA, folderB, content] = c;
    const folder = (folderA ?? folderB ?? "").trim();
    // Only act when the request is clearly about a note's name/location/content;
    // "create a summary of my trip" needs the model to write the content.
    if (namedKw || root || folder || content) {
      const title = rawTitle
        .trim()
        .replace(/[<>:"|?*\\]/g, "")
        .slice(0, 80);
      if (title) {
        const path = (folder && !root ? folder.replace(/^\/+|\/+$/g, "") + "/" : "") + title;
        return [{ name: "create_note", arguments: { path, content: (content ?? "").trim() } }];
      }
    }
  }
  return null;
}
