# SEO / AEO / GEO Playbook — theurlshortner.com

This file tracks what's already done (in code) and what **you** need to do to actually rank.
On-page SEO is necessary but not sufficient: ranking #1 for "url shortener" also needs
indexing, authority (backlinks), content, and time.

## ✅ Already done in the code
- Keyword-targeted titles + meta descriptions on every page
- `canonical`, `robots`, Open Graph + Twitter cards, `theme-color`
- Favicon/logo (`favicon.svg`) + 1200×630 `og-image.png`
- `robots.txt` (with AI crawlers allowed) + `sitemap.xml`
- Structured data: `WebApplication`, `Organization`, `FAQPage`, `HowTo`, `Article`, `BreadcrumbList`
- `llms.txt` for generative engines (GEO)
- SEO content pages under `/guides` with internal linking
- `noindex` on private pages (dashboard, 404)

---

## 🚀 Do these now (highest impact first)

### 1. Google Search Console  (most important — do today)
1. Go to https://search.google.com/search-console
2. Add property → **Domain** → `theurlshortner.com`
3. Verify via DNS TXT record (add the record at your domain registrar). Domain-level
   verification covers www + all paths.
4. **Sitemaps** → submit: `https://theurlshortner.com/sitemap.xml`
5. **URL Inspection** → enter the homepage → **Request indexing**. Repeat for `/guides` pages.

### 2. Bing Webmaster Tools
- https://www.bing.com/webmasters → add site → import from Search Console (1 click) → submit sitemap.
- (Bing also feeds ChatGPT search results.)

### 3. Confirm everything is crawlable
- Test rich results: https://search.google.com/test/rich-results (paste the homepage URL — should detect FAQ + WebApplication).
- Check mobile-friendliness and PageSpeed: https://pagespeed.web.dev

---

## 📈 To climb toward the top (ongoing)

### Authority / backlinks (the biggest ranking factor)
- List the tool on directories: Product Hunt, AlternativeTo, SaaS directories, Capterra-style sites.
- Answer relevant questions on Reddit, Quora, Stack Overflow with a genuine link.
- Write a launch post; ask any blogs/friends to link to you.
- Create a free tool people *embed/link to* (the shortener itself is shareable — every short link is a backlink-ish signal when posted publicly).

### Content (rank for long-tail first, then head terms)
- Keep adding `/guides` articles targeting specific searches, e.g.:
  - "url shortener for whatsapp", "shorten youtube link", "free link shortener for instagram bio",
    "qr code from short link", "branded short domain", "utm link builder".
- Each guide: clear H1, helpful answer in the first paragraph, internal links, one CTA.

### Technical hygiene
- Keep the site fast (it already is — static + edge).
- Make sure every new page is in `sitemap.xml` and linked from somewhere.
- Avoid duplicate content; keep canonicals correct.

### AEO (answer engines / featured snippets)
- Keep FAQ answers concise (1–3 sentences) and factual — that's what gets pulled into snippets.
- Add more Q&As as you learn what users ask.

### GEO (ChatGPT, Perplexity, Google AI Overviews)
- Keep `llms.txt` accurate and updated.
- State facts plainly and consistently across the site (name, what it does, that it's free).
- Earn mentions on other sites — LLMs cite sources that appear in multiple places.

---

## Realistic timeline
- Indexing: days to ~2 weeks after Search Console submission.
- Long-tail rankings (specific guide queries): a few weeks to months.
- Competitive head term ("url shortener"): months+ and depends heavily on backlinks/authority.
