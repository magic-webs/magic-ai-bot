import { Fragment, type ReactNode } from "react";

const CODE = /`([^`\n]+)`/;
const URL = /\b(?:https?:\/\/|www\.)[^\s<]*[^\s<.,:;"')\]!?*_~]/i;
const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/;
const STYLE = /(^|[^\w*_~])([*_~])(?![\s*_~])(.+?)(?<!\s)\2(?![\w*_~])/;

const STYLE_TAG = {
  "*": (children: ReactNode, key: string) => (
    <strong key={key} className="font-semibold">
      {children}
    </strong>
  ),
  _: (children: ReactNode, key: string) => <em key={key}>{children}</em>,
  "~": (children: ReactNode, key: string) => <s key={key}>{children}</s>,
} as const;

const linkClass =
  "text-[var(--chat-action,var(--primary))] underline-offset-2 hover:underline break-all";

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;

  while (rest) {
    const candidates = [
      { kind: "code", match: CODE.exec(rest), offset: 0 },
      { kind: "url", match: URL.exec(rest), offset: 0 },
      { kind: "email", match: EMAIL.exec(rest), offset: 0 },
      { kind: "style", match: STYLE.exec(rest), offset: 1 },
    ]
      .filter((c) => c.match)
      .map((c) => ({
        ...c,
        at: c.match!.index + (c.offset ? c.match![1].length : 0),
      }))
      .sort((a, b) => a.at - b.at);

    const next = candidates[0];
    if (!next) {
      out.push(rest);
      break;
    }

    const match = next.match!;
    if (next.at > 0) out.push(rest.slice(0, next.at));
    const key = `${keyPrefix}-${n++}`;

    if (next.kind === "code") {
      out.push(
        <code
          key={key}
          className="rounded bg-foreground/8 px-1 py-0.5 font-mono text-[0.85em]"
        >
          {match[1]}
        </code>
      );
      rest = rest.slice(next.at + match[0].length);
    } else if (next.kind === "url") {
      const href = /^www\./i.test(match[0]) ? `https://${match[0]}` : match[0];
      out.push(
        <a key={key} href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
          {match[0]}
        </a>
      );
      rest = rest.slice(next.at + match[0].length);
    } else if (next.kind === "email") {
      out.push(
        <a key={key} href={`mailto:${match[0]}`} className={linkClass}>
          {match[0]}
        </a>
      );
      rest = rest.slice(next.at + match[0].length);
    } else {
      const marker = match[2] as keyof typeof STYLE_TAG;
      out.push(STYLE_TAG[marker](inline(match[3], key), key));
      rest = rest.slice(match.index + match[0].length);
    }
  }

  return out;
}

type Block =
  | { type: "text"; lines: string[] }
  | { type: "pre"; lines: string[] }
  | { type: "quote"; lines: string[] }
  | { type: "bullets"; lines: string[] }
  | { type: "numbers"; lines: string[]; start: number };

const BULLET = /^\s*[-*•]\s+/;
const NUMBER = /^\s*(\d+)\.\s+/;

function blocks(text: string): Block[] {
  const lines = text.split("\n");
  const out: Block[] = [];
  const push = (type: Block["type"], line: string, start = 1) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.lines.push(line);
    else if (type === "numbers") out.push({ type, lines: [line], start });
    else out.push({ type, lines: [line] } as Block);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (trimmed.length > 6 && trimmed.endsWith("```")) {
        out.push({ type: "pre", lines: [trimmed.slice(3, -3)] });
        continue;
      }
      const body = [trimmed.slice(3)];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().endsWith("```")) {
        body.push(lines[j]);
        j++;
      }
      if (j < lines.length) {
        body.push(lines[j].trim().slice(0, -3));
        if (!body[0]) body.shift();
        if (!body[body.length - 1]) body.pop();
        out.push({ type: "pre", lines: body });
        i = j;
        continue;
      }
    }

    if (/^>\s?/.test(line)) push("quote", line.replace(/^>\s?/, ""));
    else if (BULLET.test(line)) push("bullets", line.replace(BULLET, ""));
    else if (NUMBER.test(line)) {
      push("numbers", line.replace(NUMBER, ""), Number(NUMBER.exec(line)![1]));
    } else push("text", line);
  }

  return out;
}

/**
 * A message body with WhatsApp's own markup: *bold*, _italic_, ~strike~,
 * `code`, ``` blocks, > quotes and lists, with links and emails made live.
 */
export function WhatsAppText({ text, children }: { text: string; children?: ReactNode }) {
  const parsed = blocks(text);

  return (
    <>
      {parsed.map((block, b) => {
        const key = `b${b}`;
        switch (block.type) {
          case "pre":
            return (
              <pre
                key={key}
                className="my-0.5 overflow-x-auto rounded bg-foreground/6 px-2 py-1 font-mono text-[0.85em] whitespace-pre"
              >
                {block.lines.join("\n")}
              </pre>
            );
          case "quote":
            return (
              <span
                key={key}
                className="my-0.5 block border-l-[3px] border-foreground/25 pl-2 text-muted-foreground"
              >
                {block.lines.map((line, l) => (
                  <Fragment key={l}>
                    {l ? "\n" : null}
                    {inline(line, `${key}-${l}`)}
                  </Fragment>
                ))}
              </span>
            );
          case "bullets":
          case "numbers":
            return (
              <span key={key} className="my-0.5 block">
                {block.lines.map((line, l) => (
                  <span key={l} className="flex gap-1.5">
                    <span className="shrink-0 tabular-nums">
                      {block.type === "bullets" ? "•" : `${block.start + l}.`}
                    </span>
                    <span className="min-w-0">{inline(line, `${key}-${l}`)}</span>
                  </span>
                ))}
              </span>
            );
          default:
            return (
              <Fragment key={key}>
                {block.lines.map((line, l) => (
                  <Fragment key={l}>
                    {l ? "\n" : null}
                    {inline(line, `${key}-${l}`)}
                  </Fragment>
                ))}
              </Fragment>
            );
        }
      })}
      {children}
    </>
  );
}

const EMOJI_ONLY =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|\s)+$/u;

/** One to three emoji and nothing else, which WhatsApp draws large and bubble-less. */
export function isJumboEmoji(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || !EMOJI_ONLY.test(trimmed)) return false;
  const segments = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      trimmed.replace(/\s+/g, "")
    ),
  ];
  return segments.length <= 3;
}
