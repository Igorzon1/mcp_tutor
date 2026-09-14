const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => HTML_ENTITIES[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/\r|\n|\t/g, ' ');
}

function isAllowedLink(value) {
  if (/^#[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) return true;
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020<>"'`]/.test(value)) return false;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function findClosing(text, delimiter, start) {
  let position = start;
  while ((position = text.indexOf(delimiter, position)) !== -1) {
    if (position > start && !/^\s/.test(text[position - 1])) return position;
    position += delimiter.length;
  }
  return -1;
}

function findLinkEnd(text, start) {
  let depth = 0;
  for (let position = start; position < text.length; position += 1) {
    if (text[position] === '(') depth += 1;
    if (text[position] === ')') {
      if (depth === 0) return position;
      depth -= 1;
    }
  }
  return -1;
}

function renderInline(value) {
  const text = String(value);
  let output = '';
  let position = 0;
  let plainStart = 0;

  const flushPlain = end => {
    if (end > plainStart) output += escapeHtml(text.slice(plainStart, end));
  };

  while (position < text.length) {
    let end;

    if (text[position] === '`') {
      const delimiter = text[position + 1] === '`' ? '``' : '`';
      end = text.indexOf(delimiter, position + delimiter.length);
      if (end !== -1) {
        flushPlain(position);
        output += `<code>${escapeHtml(text.slice(position + delimiter.length, end).trim())}</code>`;
        position = end + delimiter.length;
        plainStart = position;
        continue;
      }
    }

    const strongDelimiter = text.startsWith('**', position)
      ? '**'
      : text.startsWith('__', position) ? '__' : null;
    if (strongDelimiter) {
      end = findClosing(text, strongDelimiter, position + strongDelimiter.length);
      if (end !== -1) {
        flushPlain(position);
        output += `<strong>${renderInline(text.slice(position + strongDelimiter.length, end))}</strong>`;
        position = end + strongDelimiter.length;
        plainStart = position;
        continue;
      }
    }

    const emphasis = text[position];
    if ((emphasis === '*' || emphasis === '_') && text[position + 1] !== emphasis
      && text[position - 1] !== emphasis && !/\s/.test(text[position + 1] || ' ')
      && !(emphasis === '_' && /\w/.test(text[position - 1] || ''))) {
      end = findClosing(text, emphasis, position + 1);
      if (end !== -1 && !(emphasis === '_' && /\w/.test(text[end + 1] || ''))) {
        flushPlain(position);
        output += `<em>${renderInline(text.slice(position + 1, end))}</em>`;
        position = end + 1;
        plainStart = position;
        continue;
      }
    }

    if (text[position] === '[' && text[position - 1] !== '!') {
      const labelEnd = text.indexOf('](', position + 1);
      if (labelEnd !== -1) {
        end = findLinkEnd(text, labelEnd + 2);
        if (end !== -1) {
          const label = text.slice(position + 1, labelEnd);
          const destination = text.slice(labelEnd + 2, end).trim();
          flushPlain(position);
          if (isAllowedLink(destination)) {
            output += `<a href="${escapeAttribute(destination)}">${renderInline(label)}</a>`;
          } else {
            output += renderInline(label);
          }
          position = end + 1;
          plainStart = position;
          continue;
        }
      }
    }

    position += 1;
  }

  flushPlain(text.length);
  return output;
}

function renderFence(lines, language) {
  const className = /^[A-Za-z0-9_+-]+$/.test(language) ? ` class="language-${escapeAttribute(language)}"` : '';
  return `<pre><code${className}>${escapeHtml(lines.join('\n'))}</code></pre>`;
}

function renderList(items, ordered) {
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>\n${items.map(item => `  <li>${renderInline(item)}</li>`).join('\n')}\n</${tag}>`;
}

function listMarker(line) {
  const match = line.match(/^ {0,3}([-+*]|\d+[.)])\s+(.*)$/);
  if (!match) return null;
  return { ordered: /^\d/.test(match[1]), body: match[2] };
}

/**
 * Convert the small, safe Markdown subset used by tutor messages to HTML.
 * The returned string is intended for insertion into an HTML container.
 */
export function formatMessage(value) {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;
  let fence = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInline(paragraph.join('\n'))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    blocks.push(renderList(list.items, list.ordered));
    list = null;
  };

  for (const line of lines) {
    if (fence) {
      if (/^ {0,3}```\s*$/.test(line)) {
        blocks.push(renderFence(fence.lines, fence.language));
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }

    const openingFence = line.match(/^ {0,3}```\s*([^\s`]*)\s*$/);
    if (openingFence) {
      flushParagraph();
      flushList();
      fence = { language: openingFence[1] || '', lines: [] };
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/);
    if (heading) {
      flushParagraph();
      flushList();
      // Message headings are subordinate to the conversation/page headings.
      const level = Math.min(6, heading[1].length + 2);
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const marker = listMarker(line);
    if (marker) {
      flushParagraph();
      if (!list || list.ordered !== marker.ordered) {
        flushList();
        list = { ordered: marker.ordered, items: [] };
      }
      list.items.push(marker.body);
      continue;
    }

    if (list && /^ {2,}\S/.test(line)) {
      list.items[list.items.length - 1] += `\n${line.trim()}`;
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (fence) blocks.push(renderFence(fence.lines, fence.language));
  flushParagraph();
  flushList();
  return blocks.join('\n');
}
