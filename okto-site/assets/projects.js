(function () {
  'use strict';
  const cfg = window.OKTO_CONFIG || {};
  const list = document.getElementById('project-list');
  const empty = document.getElementById('project-empty');
  if (!list || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const render = (rows) => {
    if (!rows.length) return;
    if (empty) empty.remove();
    list.innerHTML = rows.map((row) => {
      const tag = row.tag ? `<p class="project-period">${esc(row.tag)}</p>` : '';
      const link = row.link ? `<a class="project-open" href="${esc(row.link)}" target="_blank" rel="noopener noreferrer">Открыть</a>` : '';
      return `<article class="project-card">
        ${tag}
        <h3>${esc(row.title)}</h3>
        <p>${esc(row.description)}</p>
        ${link}
      </article>`;
    }).join('');
  };

  fetch(cfg.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/projects?select=title,tag,description,link,published,created_at&published=eq.true&order=created_at.desc', {
    headers: { apikey: cfg.supabaseAnonKey, Accept: 'application/json' },
  })
    .then((response) => (response.ok ? response.json() : []))
    .then((rows) => render(Array.isArray(rows) ? rows : []))
    .catch(() => {});
})();