import { readdir, readFile, writeFile, mkdir, stat, copyFile, rm } from 'node:fs/promises';
import { dirname, join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = __dirname;
const WRITES_DIR = join(ROOT, 'writes');
const SRC_DIR = join(ROOT, 'src');
const DIST_DIR = join(ROOT, 'dist');
const OUTPUT_WRITES_DIR = join(DIST_DIR, 'writes');
const WRITES_JSON = join(SRC_DIR, 'writes.json');

function ensureLeadingHash(title) {
  if (!title) return '';
  return title.replace(/^#+\s*/, '').trim();
}

function extractFirstHeading(markdown) {
  const match = markdown.match(/^\s*#\s+(.+)$/m);
  return match ? ensureLeadingHash(match[1]) : '';
}

function extractSummary(markdown, maxLen = 140) {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, '');
  const withoutFrontmatter = withoutCode.replace(/^---[\s\S]*?---\s*/m, '');
  const paragraphs = withoutFrontmatter
    .split(/\n\s*\n/)
    .map(s => s.replace(/\n/g, ' ').trim())
    .filter(Boolean);
  const text = paragraphs[0] || '';
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

function parseHtmlCommentMeta(markdown) {
  const lines = markdown.split(/\n/);
  const data = {};
  let endIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { endIndex = i + 1; continue; }
    const m = line.match(/^<!--\s*([^:：]+?)\s*[:：]\s*(.*?)\s*-->$/);
    if (!m) { break; }
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    data[key] = value;
    endIndex = i + 1;
  }
  if (Object.keys(data).length === 0) return { content: markdown, data: {} };
  const content = lines.slice(endIndex).join('\n');
  return { content, data };
}

function parseFrontmatter(markdown) {
  const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch) return { content: markdown, data: {} };
  const body = fmMatch[1];
  const rest = markdown.slice(fmMatch[0].length);
  const data = {};
  body.split(/\n/).forEach(line => {
    const m = line.match(/^([A-Za-z0-9_\-]+):\s*(.*)$/);
    if (m) {
      const key = m[1].trim();
      let value = m[2].trim();
      value = value.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
      data[key] = value;
    }
  });
  return { content: rest, data };
}

function slugifyHeading(text) {
  return (text || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[^;]+;?/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5\-\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildTocAndAnchorize(html) {
  const toc = [];
  let idx = 0;
  const replaced = html.replace(/<h([1-3])>([\s\S]*?)<\/h\1>/g, (m, level, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    let id = slugifyHeading(text);
    if (!id) id = `section-${++idx}`;
    toc.push({ level: Number(level), id, text });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });

  // Build nested list
  let tocHtml = '';
  if (toc.length) {
    tocHtml = '<ul class="toc-list">\n';
    let prev = toc[0].level;
    for (const item of toc) {
      while (item.level > prev) { tocHtml += '<ul class="toc-sub">'; prev++; }
      while (item.level < prev) { tocHtml += '</ul>'; prev--; }
      tocHtml += `<li class="toc-item level-${item.level}"><a href="#${item.id}">${item.text}</a></li>`;
    }
    while (prev > (toc[0]?.level || 1)) { tocHtml += '</ul>'; prev--; }
    tocHtml += '\n</ul>';
  }

  return { html: replaced, tocHtml };
}

function stripDuplicateTopTitle(html, title) {
  try {
    const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (!m) return html;
    const onlyText = m[1].replace(/<[^>]+>/g, '').trim();
    if (onlyText && title && onlyText === title.trim()) {
      return html.replace(m[0], '');
    }
    return html;
  } catch { return html; }
}

async function ensureDir(dir) { await mkdir(dir, { recursive: true }); }

async function listMdFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listMdFiles(abs, base)));
    else if (entry.isFile() && abs.toLowerCase().endsWith('.md')) files.push(abs.slice(base.length + 1));
  }
  return files;
}

const mdRender = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true, // 启用单个换行支持，无需两个空格即可换行
  highlight: (str, lang) => {
    try {
      if (lang && hljs.getLanguage(lang)) {
        const out = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        return `<pre><code class="hljs language-${lang}">${out}</code></pre>`;
      }
      const out = hljs.highlightAuto(str).value;
      return `<pre><code class="hljs">${out}</code></pre>`;
    } catch (e) {
      const esc = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<pre><code>${esc}</code></pre>`;
    }
  }
});
function simpleMarkdownToHtml(md) {
  return mdRender.render(md);
}

function addLazyLoadingToImages(html) {
  return html.replace(/<img(?![^>]*\bloading=)[^>]*>/g, (tag) => {
    if (tag.includes('loading=')) return tag;
    return tag.replace(/<img\s*/i, '<img loading="lazy" ');
  });
}

async function build() {
  await ensureDir(DIST_DIR);
  try { await rm(join(DIST_DIR, 'posts'), { recursive: true, force: true }); } catch {}
  try { await rm(join(DIST_DIR, 'posts.json'), { force: true }); } catch {}
  try { await rm(join(SRC_DIR, 'posts.json'), { force: true }); } catch {}
  try { await rm(OUTPUT_WRITES_DIR, { recursive: true, force: true }); } catch {}
  await ensureDir(OUTPUT_WRITES_DIR);

  // load styles once
  let articleCss = '';
  try { articleCss = await readFile(join(SRC_DIR, 'article.css'), 'utf-8'); } catch {}
  let siteCss = '';
  try { siteCss = await readFile(join(SRC_DIR, 'index.css'), 'utf-8'); } catch {}

  // load article HTML template once
  let articleTemplate = '';
  try { articleTemplate = await readFile(join(SRC_DIR, 'articles.template.html'), 'utf-8'); } catch {}

  // prepare highlight.js CSS into dist/writes/highlight (prefer src/vendor, fallback to node_modules)
  let hlCssHref = '';
  try {
    const distHighlightDir = join(OUTPUT_WRITES_DIR, 'highlight');
    await ensureDir(distHighlightDir);
    const distHlCss = join(distHighlightDir, 'github.min.css');
    let cssBuf = '';
    try {
      const srcHlCss = join(SRC_DIR, 'vendor', 'highlight', 'styles', 'github.min.css');
      cssBuf = await readFile(srcHlCss, 'utf-8');
    } catch {
      const nmHlCss = join(ROOT, 'node_modules', 'highlight.js', 'styles', 'github.min.css');
      cssBuf = await readFile(nmHlCss, 'utf-8');
    }
    await writeFile(distHlCss, cssBuf, 'utf-8');
    hlCssHref = './highlight/github.min.css';
  } catch {}

  const files = await listMdFiles(WRITES_DIR);
  const posts = [];

  for (const rel of files) {
    const abs = join(WRITES_DIR, rel);
    const md = await readFile(abs, 'utf-8');
    const st = await stat(abs);

    let parsed = parseHtmlCommentMeta(md);
    let fmParsed = parseFrontmatter(parsed.content);
    const data = { ...fmParsed.data, ...parsed.data };
    
    // 如果标记为 private: true，跳过此文件，不生成 HTML
    if (data.private === 'true' || data.private === true) {
      continue;
    }
    
    const content = fmParsed.content;

    const titleFromHeading = extractFirstHeading(content);
    const title = (data.title || titleFromHeading || basename(rel, extname(rel)));

    const summary = (data.summary || extractSummary(content));
    let date = (data.date || '').trim();
    if (date) date = date.replace(/\./g, '-');
    else date = st.mtime.toISOString().slice(0, 10);

    const parentDir = dirname(rel).split(/\\|\//).filter(Boolean).pop();
    const category = (data.category || parentDir || 'uncategorized');

    let htmlBody = simpleMarkdownToHtml(content);
    htmlBody = stripDuplicateTopTitle(htmlBody, title);
    htmlBody = addLazyLoadingToImages(htmlBody);
    const { html: anchoredHtml, tocHtml } = buildTocAndAnchorize(htmlBody);

    const pathParts = rel.replace(/\\/g, '/').split('/');
    const base = basename(rel, '.md');
    const flatName = pathParts.slice(0, -1).concat(base).join('-') + '.html';
    const htmlFile = join(OUTPUT_WRITES_DIR, flatName);

    // 从模板渲染页面，将 index.css 和 article.css 分别注入到两个 style 标签中
    let page = articleTemplate || '';
    const categorySuffix = category ? ` · ${category}` : '';
    const hlLink = hlCssHref ? `<link rel="stylesheet" href="${hlCssHref}">` : '';
    page = page.replace(/\{\{INDEX_CSS\}\}/g, siteCss)
               .replace(/\{\{ARTICLE_CSS\}\}/g, articleCss)
               .replace(/\{\{HL_CSS_LINK\}\}/g, hlLink)
               .replace(/\{\{TITLE\}\}/g, title)
               .replace(/\{\{DATE\}\}/g, date)
               .replace(/\{\{CATEGORY_SUFFIX\}\}/g, categorySuffix)
               .replace(/\{\{TOC\}\}/g, tocHtml)
               .replace(/\{\{CONTENT\}\}/g, anchoredHtml);

    await writeFile(htmlFile, page, 'utf-8');

    const webPath = 'writes/' + flatName;
    posts.push({
      title,
      summary,
      date,
      category,
      path: webPath.replace(/\\/g, '/'),
      originPath: ('writes/' + rel).replace(/\\/g, '/')
    });
  }

  // Sort and write writes.json ... (unchanged below)
  posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  await writeFile(WRITES_JSON, JSON.stringify(posts, null, 2), 'utf-8');

  await renderIndexHtml(posts);
  await copyAssets();
}

async function renderIndexHtml(posts) {
  const templatePath = join(SRC_DIR, 'index.template.html');
  let html = await readFile(templatePath, 'utf-8');

  // Inline index.css
  try {
    const cssPath = join(SRC_DIR, 'index.css');
    const css = await readFile(cssPath, 'utf-8');
    html = html.replace(/<link\s+rel="stylesheet"[^>]*href="index\.css"[^>]*>/, `<style>\n${css}\n</style>`);
  } catch {}

  // Load programs.json
  let programs = [];
  try {
    const programsJsonPath = join(SRC_DIR, 'programs.json');
    const programsRaw = await readFile(programsJsonPath, 'utf-8');
    programs = JSON.parse(programsRaw);
  } catch {}

  const programsLis = programs.map(p => {
    const title = p.title || '';
    const link = p.link || '#';
    const summary = p.summary || '';
    return `        <li>\n          <a class=\"link\" target=\"_blank\" href=\"${link}\">${title}</a>: \n          <small>${summary}</small>\n        </li>`;
  }).join('\n');
  const programsUl = programs.length ? `      <ul class=\"list\">\n${programsLis}\n      </ul>` : '';

  const postsUl = `      <ul id="posts-list">\n${posts.map(p => {
    const category = p.category || '';
    const date = p.date || '';
    const href = p.path;
    const title = p.title || '未命名';
    const summary = p.summary || '';
    return `        <li><span class=\"category ${category}\">${category}</span><time>${date}</time><a class=\"link\" target=\"_blank\" href=\"${href}\" class=\"title\"><span>${title}</span></a><small class=\"summary\">${summary}</small></li>`;
  }).join('\n')}\n      </ul>`;

  // Inject markers
  html = html.replace(/<!--\s*programs\.json\s*-->/, programsUl || '');
  html = html.replace(/<!--\s*writes\.json\s*-->/, postsUl || '');

  await ensureDir(DIST_DIR);
  const outIndex = join(DIST_DIR, 'index.html');
  await writeFile(outIndex, html, 'utf-8');
}

async function copyAssets() {
  // Copy pitaya.svg from root or src to dist
  const candidates = [join(ROOT, 'pitaya.svg'), join(SRC_DIR, 'pitaya.svg')];
  for (const c of candidates) {
    try {
      await copyFile(c, join(DIST_DIR, 'pitaya.svg'));
      break;
    } catch {}
  }
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});


