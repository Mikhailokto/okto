(() => {
  const normalize = (value) => value.toLocaleLowerCase('ru').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  document.querySelectorAll('img[data-fallback]').forEach((image) => {
    image.addEventListener('error', () => {
      if (image.dataset.fallback) image.src = image.dataset.fallback;
      image.dataset.fallback = '';
    }, { once: true });
  });

  const catalogSearch = document.querySelector('#catalog-search');
  if (catalogSearch) {
    const cards = [...document.querySelectorAll('.course-card')];
    const empty = document.querySelector('#catalog-empty');
    catalogSearch.addEventListener('input', () => {
      const query = normalize(catalogSearch.value);
      let visible = 0;
      cards.forEach((card) => {
        const match = normalize(card.textContent).includes(query);
        card.hidden = !match;
        if (match) visible += 1;
      });
      if (empty) empty.hidden = visible !== 0;
    });
  }

  const toc = document.querySelector('#course-toc');
  const article = document.querySelector('#course-content');
  if (toc && article) {
    const courseId = document.body.dataset.courseId || 'course';
    const tocToggle = document.querySelector('#toc-toggle');
    const mobileTocQuery = window.matchMedia('(max-width: 820px)');
    let mobileTocExpanded = false;
    const updateTocMode = () => {
      const isMobile = mobileTocQuery.matches;
      if (tocToggle) {
        tocToggle.hidden = !isMobile;
        tocToggle.setAttribute('aria-expanded', String(!isMobile || mobileTocExpanded));
        const arrow = tocToggle.querySelector('[aria-hidden="true"]');
        if (arrow) arrow.textContent = isMobile && mobileTocExpanded ? '⌃' : '⌄';
      }
      toc.hidden = isMobile && !mobileTocExpanded;
    };
    if (tocToggle) {
      tocToggle.addEventListener('click', () => {
        mobileTocExpanded = !mobileTocExpanded;
        updateTocMode();
      });
      if (mobileTocQuery.addEventListener) mobileTocQuery.addEventListener('change', updateTocMode);
      else mobileTocQuery.addListener(updateTocMode);
    }
    updateTocMode();
    const progressKey = `okto-progress-${courseId}`;
    let completed = new Set();
    try { completed = new Set(JSON.parse(localStorage.getItem(progressKey) || '[]')); } catch { completed = new Set(); }
    const lessonHeadings = [...article.querySelectorAll('h2')].filter((heading) => /^Занятие\s+\d+/i.test(heading.textContent.trim()));
    const countText = document.querySelector('#progress-label');
    const progressFill = document.querySelector('#progress-fill');

    const updateProgress = () => {
      const count = lessonHeadings.filter((heading) => completed.has(heading.id)).length;
      if (countText) countText.textContent = `${count} из ${lessonHeadings.length} занятий отмечено`;
      if (progressFill) progressFill.style.width = `${lessonHeadings.length ? (count / lessonHeadings.length) * 100 : 0}%`;
      try { localStorage.setItem(progressKey, JSON.stringify([...completed])); } catch { /* local storage may be unavailable */ }
    };

    const allHeadings = [...article.querySelectorAll('h2, h3')];
    allHeadings.forEach((heading) => {
      if (!heading.id) return;
      const isLesson = /^Занятие\s+\d+/i.test(heading.textContent.trim());
      const item = document.createElement('div');
      item.className = `toc-item${heading.tagName === 'H3' ? ' depth-2' : ''}`;
      const link = document.createElement('a');
      link.href = `#${encodeURIComponent(heading.id)}`;
      link.textContent = heading.textContent.trim();
      link.addEventListener('click', () => {
        if (mobileTocQuery.matches && mobileTocExpanded) {
          mobileTocExpanded = false;
          updateTocMode();
        }
      });
      item.append(link);
      if (isLesson) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'progress-toggle';
        const updateToggle = () => {
          const isCompleted = completed.has(heading.id);
          toggle.setAttribute('aria-label', `${isCompleted ? 'Снять отметку' : 'Отметить занятие'}: ${heading.textContent.trim()}`);
          toggle.setAttribute('aria-pressed', String(isCompleted));
          toggle.textContent = isCompleted ? '✓' : '';
        };
        updateToggle();
        toggle.addEventListener('click', () => {
          if (completed.has(heading.id)) completed.delete(heading.id);
          else completed.add(heading.id);
          updateToggle();
          updateProgress();
        });
        item.append(toggle);
      }
      toc.append(item);
    });
    updateProgress();

    document.querySelector('#reset-progress')?.addEventListener('click', () => {
      completed.clear();
      toc.querySelectorAll('.progress-toggle').forEach((button) => {
        const heading = button.closest('.toc-item')?.querySelector('a')?.textContent || 'занятие';
        button.setAttribute('aria-label', `Отметить занятие: ${heading}`);
        button.setAttribute('aria-pressed', 'false');
        button.textContent = '';
      });
      updateProgress();
    });

    if ('IntersectionObserver' in window) {
      const links = new Map([...toc.querySelectorAll('a')].map((link) => [decodeURIComponent(link.hash.slice(1)), link.parentElement]));
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            toc.querySelectorAll('.toc-item.active').forEach((item) => item.classList.remove('active'));
            links.get(entry.target.id)?.classList.add('active');
          }
        });
      }, { rootMargin: '-12% 0px -72% 0px' });
      allHeadings.forEach((heading) => observer.observe(heading));
    }
  }

  const courseSearch = document.querySelector('#course-search');
  if (courseSearch && article) {
    const status = document.querySelector('#search-status');
    let previous = null;
    courseSearch.addEventListener('input', () => {
      previous?.classList.remove('search-match');
      previous = null;
      const query = normalize(courseSearch.value);
      if (!query) { if (status) status.textContent = ''; return; }
      const candidates = [...article.querySelectorAll('h2, h3, h4, p, li')];
      const match = candidates.find((node) => normalize(node.textContent).includes(query));
      if (match) {
        match.classList.add('search-match');
        previous = match;
        match.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (status) status.textContent = 'Первое совпадение в курсе';
      } else if (status) {
        status.textContent = 'Совпадений не найдено';
      }
    });
  }

  document.querySelectorAll('.quiz-form').forEach((form) => {
    const result = form.querySelector('.quiz-result');
    const storageKey = `okto-quiz-${document.body.dataset.courseId || 'course'}`;
    const persistAnswers = (submitted) => {
      const answers = {};
      form.querySelectorAll('.quiz-question').forEach((question) => {
        const selected = form.querySelector(`input[name="${question.dataset.name}"]:checked`);
        if (selected) answers[question.dataset.name] = Number(selected.value);
      });
      try { localStorage.setItem(storageKey, JSON.stringify({ answers, submitted })); } catch { /* local storage may be unavailable */ }
    };
    const showResults = (restored = false) => {
      let score = 0;
      form.querySelectorAll('.quiz-question').forEach((question) => {
        const correct = Number(question.dataset.answer);
        const selected = Number(form.querySelector(`input[name="${question.dataset.name}"]:checked`)?.value);
        const right = selected === correct;
        if (right) score += 1;
        const note = question.querySelector('.quiz-feedback');
        note.hidden = false;
        note.textContent = `${right ? 'Верно.' : 'Проверьте ещё раз.'} ${question.dataset.explanation}`;
      });
      if (result) {
        const suffix = restored ? ' Результат сохранён в этом браузере.' : ' Ошибка — тоже репетиционный материал.';
        result.textContent = `Ваш результат: ${score} из ${form.querySelectorAll('.quiz-question').length}.${suffix}`;
      }
    };

    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved?.answers) {
        Object.entries(saved.answers).forEach(([name, value]) => {
          const input = form.querySelector(`input[name="${name}"][value="${value}"]`);
          if (input) input.checked = true;
        });
        if (saved.submitted) showResults(true);
      }
    } catch { /* saved answers may be unavailable or malformed */ }

    form.addEventListener('change', () => persistAnswers(false));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      showResults();
      persistAnswers(true);
    });
    form.addEventListener('reset', () => {
      window.setTimeout(() => {
        try { localStorage.removeItem(storageKey); } catch { /* local storage may be unavailable */ }
        form.querySelectorAll('.quiz-feedback').forEach((note) => { note.hidden = true; note.textContent = ''; });
        if (result) result.textContent = '';
      }, 0);
    });
  });
})();
