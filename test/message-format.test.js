import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMessage } from '../public/message-format.js';

test('renderiza parágrafos, listas, negrito, código inline e links permitidos', () => {
  assert.equal(
    formatMessage('Olá, **tutor**.\n\n- primeiro\n- segundo\n\n[documentação](https://example.com) e [seção](#exemplo) com `const x = 1`.'),
    '<p>Olá, <strong>tutor</strong>.</p>\n<ul>\n  <li>primeiro</li>\n  <li>segundo</li>\n</ul>\n<p><a href="https://example.com">documentação</a> e <a href="#exemplo">seção</a> com <code>const x = 1</code>.</p>',
  );
});

test('renderiza listas ordenadas e blocos de código fenced sem interpretar Markdown', () => {
  assert.equal(
    formatMessage('1. preparar\n2. testar\n\n```html\n<div>&</div>\n<script>alert(1)</script>\n```'),
    '<ol>\n  <li>preparar</li>\n  <li>testar</li>\n</ol>\n<pre><code class="language-html">&lt;div&gt;&amp;&lt;/div&gt;\n&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>',
  );
});

test('escapa HTML em texto e código e não permite XSS por links', () => {
  const result = formatMessage('<img src=x onerror=alert(1)> **<svg/onload=alert(2)>**\n\n`<script>alert(3)</script>`\n\n[x](javascript:alert(4)) [y](data:text/html,alert(5))');

  assert.equal(result, '<p>&lt;img src=x onerror=alert(1)&gt; <strong>&lt;svg/onload=alert(2)&gt;</strong></p>\n<p><code>&lt;script&gt;alert(3)&lt;/script&gt;</code></p>\n<p>x y</p>');
  assert.doesNotMatch(result, /<img|<svg|<script|javascript:|data:/i);
});

test('aceita valores vazios e não modifica a entrada', () => {
  const input = 'texto **forte**';
  assert.equal(formatMessage(), '');
  assert.equal(formatMessage(null), '');
  assert.equal(formatMessage(input), '<p>texto <strong>forte</strong></p>');
  assert.equal(input, 'texto **forte**');
});

test('subtítulos separam explicação e exemplo sem permitir HTML nem interpretar código como título', () => {
  assert.equal(formatMessage('## Uma **tag**\nExplicação\n\n### Exemplo\n```html\n# não é título\n<div>Oi</div>\n```\n## <img onerror=x>'), '<h4>Uma <strong>tag</strong></h4>\n<p>Explicação</p>\n<h5>Exemplo</h5>\n<pre><code class="language-html"># não é título\n&lt;div&gt;Oi&lt;/div&gt;</code></pre>\n<h4>&lt;img onerror=x&gt;</h4>');
});

test('itálico não deixa marcadores visíveis nem altera identificadores com underscore', () => {
  assert.equal(formatMessage('*recomendo começar aqui* e _um exemplo_. nome_da_variavel\n\n*<img src=x>*\n\n`*literal*`'), '<p><em>recomendo começar aqui</em> e <em>um exemplo</em>. nome_da_variavel</p>\n<p><em>&lt;img src=x&gt;</em></p>\n<p><code>*literal*</code></p>');
});
