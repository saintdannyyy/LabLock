// Persistent child-side planner sidebar: an interactive month calendar plus
// three Apple-style cards (Calendar events / Timetable / To-dos) stacked on the
// left of the kiosk. Plain browser script over file:// (IIFE, no import/export).
//
// Selecting a day in the calendar drives every section below it:
//   - Events  -> those dated that day
//   - Timetable -> that day's weekday schedule
//   - To-dos  -> undated (general) ones plus dated ones for that day
// To-dos added while a date is selected are stamped with that date; undated
// to-dos (created from the admin console) always show.
//
// Reads the ACTIVE profile's planner via getPlanner; to-do edits go back through
// saveTodos (scoped to the active profile in main). Reloads when the active
// profile changes (whitelist-refresh push) and when the admin saves the planner
// (planner-changed push).
(() => {
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  type Todo = { id: string; text: string; done: boolean; date?: string };

  let todos: Todo[] = [];
  let events: { date: string; title: string }[] = [];
  let timetable: { day: string; period: string; subject: string }[] = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selected = new Date(today);
  let viewDate = new Date(today.getFullYear(), today.getMonth(), 1);

  function keyOf(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function sameDay(a: Date, b: Date): boolean {
    return keyOf(a) === keyOf(b);
  }

  function selectedKey(): string {
    return keyOf(selected);
  }

  function selectedWeekday(): string {
    return DAY_NAMES[selected.getDay()];
  }

  function appendEmpty(list: HTMLElement | null, text: string): void {
    if (!list) return;
    const li = document.createElement('li');
    li.className = 'sidebar-empty';
    li.textContent = text;
    list.appendChild(li);
  }

  // ---------- Interactive month calendar ----------

  function renderCalendarGrid(): void {
    const cellsEl = document.getElementById('cal-cells') as HTMLElement | null;
    const monthEl = document.getElementById('cal-month') as HTMLElement | null;
    if (!cellsEl) return;
    if (monthEl) {
      monthEl.textContent = viewDate.toLocaleDateString([], { month: 'long', year: 'numeric' });
    }
    cellsEl.replaceChildren();

    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDow = new Date(year, month, 1).getDay();

    for (let i = 0; i < 42; i++) {
      const cellDate = new Date(year, month, 1 - firstDow + i);
      const key = keyOf(cellDate);
      const inMonth = cellDate.getMonth() === month;

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-cell';
      cell.textContent = String(cellDate.getDate());
      cell.setAttribute('data-date', key);
      cell.setAttribute(
        'aria-label',
        cellDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
      );
      cell.setAttribute('aria-pressed', sameDay(cellDate, selected) ? 'true' : 'false');

      if (!inMonth) cell.classList.add('is-outside');
      if (sameDay(cellDate, today)) cell.classList.add('is-today');
      if (sameDay(cellDate, selected)) cell.classList.add('is-selected');

      // Day dots: an event dot (primary) and/or an undone to-do dot (neutral).
      if (events.some((e) => e.date === key)) {
        const dot = document.createElement('span');
        dot.className = 'cal-dot cal-dot-event';
        dot.setAttribute('aria-hidden', 'true');
        cell.appendChild(dot);
      }
      if (todos.some((t) => t.date === key && !t.done)) {
        const dot = document.createElement('span');
        dot.className = 'cal-dot cal-dot-todo';
        dot.setAttribute('aria-hidden', 'true');
        cell.appendChild(dot);
      }

      cell.addEventListener('click', () => {
        selected.setTime(cellDate.getTime());
        if (cellDate.getMonth() !== viewDate.getMonth()) {
          viewDate = new Date(cellDate.getFullYear(), cellDate.getMonth(), 1);
        }
        renderCalendarGrid();
        renderPlan();
      });

      cellsEl.appendChild(cell);
    }
  }

  // ---------- The plan sections below the calendar ----------

  function renderCalendarEvents(): void {
    const list = document.getElementById('sidebar-events') as HTMLElement | null;
    const dateLabel = document.getElementById('cal-events-date') as HTMLElement | null;
    if (dateLabel) {
      dateLabel.textContent = selected.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    }
    if (!list) return;
    list.replaceChildren();
    const todays = events.filter((e) => e.date === selectedKey());
    if (todays.length === 0) {
      appendEmpty(list, 'No events on this day.');
      return;
    }
    for (const ev of todays) {
      const li = document.createElement('li');
      li.className = 'sidebar-item';
      const text = document.createElement('span');
      text.className = 'sidebar-text';
      text.textContent = ev.title;
      li.appendChild(text);
      list.appendChild(li);
    }
  }

  function renderTimetable(): void {
    const list = document.getElementById('sidebar-timetable') as HTMLElement | null;
    const dayLabel = document.getElementById('sidebar-timetable-day') as HTMLElement | null;
    if (dayLabel) {
      dayLabel.textContent = selected.toLocaleDateString([], { weekday: 'long' });
    }
    if (!list) return;
    list.replaceChildren();
    const todays = timetable.filter((r) => r.day === selectedWeekday());
    if (todays.length === 0) {
      appendEmpty(list, 'No classes this weekday.');
      return;
    }
    for (const row of todays) {
      const li = document.createElement('li');
      li.className = 'sidebar-item';
      const period = document.createElement('span');
      period.className = 'sidebar-period';
      period.textContent = row.period;
      const text = document.createElement('span');
      text.className = 'sidebar-text';
      text.textContent = row.subject;
      li.appendChild(period);
      li.appendChild(text);
      list.appendChild(li);
    }
  }

  function renderTodos(): void {
    const list = document.getElementById('sidebar-todos') as HTMLElement | null;
    if (!list) return;
    const visible = todos.filter((t) => !t.date || t.date === selectedKey());
    list.replaceChildren();
    if (visible.length === 0) {
      appendEmpty(list, 'Nothing to do. Add one above!');
      return;
    }
    for (const todo of visible) {
      const li = document.createElement('li');
      li.className = 'sidebar-item' + (todo.done ? ' is-done' : '');

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'sidebar-check';
      check.checked = todo.done;
      check.setAttribute('aria-label', `Mark "${todo.text}" as ${todo.done ? 'not done' : 'done'}`);
      check.addEventListener('change', () => {
        todo.done = check.checked;
        renderTodos();
        renderCalendarGrid();
        void syncTodos();
      });

      const text = document.createElement('span');
      text.className = 'sidebar-text';
      text.textContent = todo.text;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'sidebar-remove';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove to-do "${todo.text}"`);
      remove.addEventListener('click', () => {
        todos = todos.filter((t) => t.id !== todo.id);
        renderTodos();
        renderCalendarGrid();
        void syncTodos();
      });

      li.appendChild(check);
      li.appendChild(text);
      li.appendChild(remove);
      list.appendChild(li);
    }
  }

  // Persist the to-do list to the active profile's planner (main validates and
  // writes it). Optimistic UI; a failed save is only logged — a sidebar widget
  // must never block the child on a transient error.
  async function syncTodos(): Promise<void> {
    const saveTodos = window.lockdown.saveTodos;
    if (!saveTodos) return;
    try {
      const result = await saveTodos(todos);
      if (!result.ok) console.warn('Sidebar: to-dos not saved:', result.error);
    } catch {
      // no-op
    }
  }

  // Header date + every section below the calendar, for the selected day.
  function renderPlan(): void {
    const dateEl = document.getElementById('sidebar-date') as HTMLElement | null;
    if (dateEl) {
      dateEl.textContent = sameDay(selected, today)
        ? 'Today · ' + selected.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
        : selected.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    }
    renderCalendarEvents();
    renderTimetable();
    renderTodos();
  }

  async function loadPlanner(): Promise<void> {
    const getPlanner = window.lockdown.getPlanner;
    if (!getPlanner) {
      appendEmpty(document.getElementById('sidebar-events'), 'Could not load your plan.');
      appendEmpty(document.getElementById('sidebar-timetable'), 'Could not load your plan.');
      renderTodos();
      return;
    }
    try {
      const planner = await getPlanner();
      events = planner.events ?? [];
      timetable = planner.timetable ?? [];
      todos = planner.todos ?? [];
    } catch {
      events = [];
      timetable = [];
      todos = [];
      appendEmpty(document.getElementById('sidebar-events'), 'Could not load your plan.');
      appendEmpty(document.getElementById('sidebar-timetable'), 'Could not load your plan.');
    }
    renderCalendarGrid();
    renderPlan();
  }

  function addTodo(): void {
    const input = document.getElementById('sidebar-todo-input') as HTMLInputElement | null;
    const text = (input?.value ?? '').trim();
    if (!text) return;
    // Stamp with the selected day: to-dos added on a date are shown with that
    // day's plan; undated (general) to-dos come from the admin console.
    todos.push({ id: 'td-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, done: false, date: selectedKey() });
    if (input) input.value = '';
    renderTodos();
    renderCalendarGrid();
    void syncTodos();
  }

  document.getElementById('sidebar-todo-add-btn')?.addEventListener('click', addTodo);
  document.getElementById('sidebar-todo-input')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addTodo();
  });

  document.getElementById('cal-prev')?.addEventListener('click', () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
    renderCalendarGrid();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    renderCalendarGrid();
  });

  function initTheme(): void {
    window.lockdown.getTheme?.().then((theme) => {
      document.documentElement.dataset.theme = theme;
    }).catch(() => {});
    window.lockdown.onThemeChanged?.((theme) => {
      document.documentElement.dataset.theme = theme;
    });
  }

  initTheme();
  void loadPlanner();
  // Refresh when the active profile changes (a successful sign-in pushes this)
  // or the admin saves a profile/planner. A profile switch restarts on today; a
  // planner save keeps the child's selected date.
  window.lockdown.onWhitelistRefreshed?.(() => {
    selected.setTime(today.getTime());
    viewDate = new Date(today.getFullYear(), today.getMonth(), 1);
    void loadPlanner();
  });
  window.lockdown.onPlannerChanged?.(() => void loadPlanner());
})();
