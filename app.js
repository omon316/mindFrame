/* MindFrame core — Timeboxing & Habits Integration */
(() => {
  const STORAGE_KEY_TASKS = 'mindframe_tasks_v1';
  const STORAGE_KEY_HABITS = 'mindframe_habits_v1'; // NEU
  
  const SLOT_HEIGHT = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--slot-height')) || 24;
  const sections = [
    { id: 'sec-night', start: 0, end: 24 },
    { id: 'sec-morning', start: 24, end: 48 },
    { id: 'sec-midday', start: 48, end: 72 },
    { id: 'sec-evening', start: 72, end: 96 }
  ];

  /** ---------- State ---------- */
  let tasks = [];
  let habits = []; // NEU: Habit State

  // Variables used during HTML drag operations
  let currentDragId = null;
  let dragImageEl = null;

  /** ---------- Utilities ---------- */
  const uuid = () => 't-' + (crypto.randomUUID?.() || Math.random().toString(36).slice(2));
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const el = (sel, root=document) => root.querySelector(sel);
  const els = (sel, root=document) => [...root.querySelectorAll(sel)];
  
  // Datums-Helper für Streaks
  const getTodayStr = () => new Date().toISOString().split('T')[0];

  /** ---------- Logic: Habits (MindsetStack Features) ---------- */
  
  function addHabit(title) {
    if (!title) return;
    const newHabit = {
      id: uuid(),
      title: title,
      streak: 0,
      lastCompleted: null, // "YYYY-MM-DD"
      completedToday: false // Temporärer State für die UI
    };
    habits.push(newHabit);
    saveHabits();
    renderHabits();
  }

  function toggleHabit(id) {
    const today = getTodayStr();
    const habit = habits.find(h => h.id === id);
    if (!habit) return;

    // Logik: Toggle
    if (habit.lastCompleted === today) {
      // Undo completion
      habit.lastCompleted = null; // Oder das Datum davor, aber einfachheitshalber null
      habit.streak = Math.max(0, habit.streak - 1);
      habit.completedToday = false;
    } else {
      // Complete
      habit.lastCompleted = today;
      habit.streak += 1;
      habit.completedToday = true;
    }
    saveHabits();
    renderHabits();
  }

  function deleteHabit(id) {
    habits = habits.filter(h => h.id !== id);
    saveHabits();
    renderHabits();
  }

  function checkStreakReset() {
    // Prüfen, ob Streaks gebrochen sind (Gestern nicht erledigt)
    const today = getTodayStr();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    habits.forEach(h => {
        // UI State syncen
        h.completedToday = (h.lastCompleted === today);

        // Wenn zuletzt vorgestern erledigt, ist Streak heute noch aktiv, aber wenn man heute verpasst, ist er morgen 0.
        // Einfache Logik: Wenn lastCompleted älter als gestern, reset Streak.
        if (h.lastCompleted && h.lastCompleted !== today && h.lastCompleted !== yesterdayStr) {
            h.streak = 0;
        }
    });
  }

  /** ---------- Logic: Tasks ---------- */
  function addTask(title, priority=2) {
    tasks.push({
      id: uuid(),
      title,
      priority: parseInt(priority),
      list: 'today', // 'today' means visible in left sidebar
      startIndex: null,
      durationSlots: 4, // 1 hour default
      completed: false // NEU: Completed status
    });
    saveTasks();
    render();
  }

  function updateTask(id, updates) {
    const idx = tasks.findIndex(t => t.id === id);
    if (idx !== -1) {
      tasks[idx] = { ...tasks[idx], ...updates };
      saveTasks();
      render();
    }
  }

  function removeTask(id) {
    tasks = tasks.filter(t => t.id !== id);
    saveTasks();
    render();
  }

  function clearDoneTasks() {
      // Löscht nur Tasks, die NICHT im Schedule sind, aber "Done" markiert (falls wir das später erlauben)
      // Oder löscht Tasks aus dem Schedule, die erledigt sind? 
      // User Request "Aufräumen" bezieht sich meist auf die linke Liste.
      // Hier löschen wir Tasks, die 'completed' sind UND nicht im Schedule (also im Backlog).
      tasks = tasks.filter(t => !(t.list === 'today' && t.completed));
      saveTasks();
      render();
  }

  /** ---------- Storage ---------- */
  function load() {
    // Tasks laden
    try {
      const stored = localStorage.getItem(STORAGE_KEY_TASKS);
      if (stored) tasks = JSON.parse(stored);
    } catch (e) { console.error(e); }

    // Habits laden
    try {
        const storedHabits = localStorage.getItem(STORAGE_KEY_HABITS);
        if (storedHabits) habits = JSON.parse(storedHabits);
    } catch(e) { console.error(e); }
    
    checkStreakReset();
  }

  function saveTasks() {
    localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(tasks));
    updateProgress();
  }

  function saveHabits() {
    localStorage.setItem(STORAGE_KEY_HABITS, JSON.stringify(habits));
    updateProgress();
  }

  /** ---------- Rendering ---------- */
  
  // 1. Habits Render
  function renderHabits() {
    const listEl = el('#habit-list');
    listEl.innerHTML = '';

    habits.forEach(h => {
        const div = document.createElement('div');
        div.className = `habit-item ${h.completedToday ? 'completed' : ''}`;
        div.innerHTML = `
            <div class="habit-left">
                <div class="habit-check" onclick="window._mindframe.toggleHabit('${h.id}')">
                    ${h.completedToday ? '✓' : ''} </div>
                <span class="habit-text">${h.title}</span>
            </div>
            <div class="habit-meta">
                <span>🔥 ${h.streak}</span>
                <span class="habit-delete" onclick="window._mindframe.deleteHabit('${h.id}')">✕</span>
            </div>
        `;
        listEl.appendChild(div);
    });
    updateProgress();
  }

  // 2. Tasks & Schedule Render
  function render() {
    // Render Todo List (Left sidebar)
    const listEl = el('#todo-list');
    listEl.innerHTML = '';
    const todoTasks = tasks.filter(t => t.list === 'today');
    
    todoTasks.forEach(t => {
      const div = document.createElement('div');
      div.className = `task-item priority-${t.priority}`;
      div.draggable = true;
      div.dataset.id = t.id;
      // Double click to edit title
      div.ondblclick = () => openEditDialog(t.id);
      
      div.innerHTML = `
        <span>${t.title}</span>
        <span style="color:var(--muted); font-size:10px;">::</span>
      `;
      
      // Drag Events
      div.addEventListener('dragstart', handleDragStart);
      div.addEventListener('dragend', handleDragEnd);
      
      listEl.appendChild(div);
    });

    // Render Schedule (Timeboxing)
    // Clear sections
    els('.section-body').forEach(b => b.innerHTML = '');
    
    // Create Time Grid backgrounds
    sections.forEach(sec => {
       const secEl = el('#' + sec.id);
       // Add time markers
       for (let i = sec.start; i < sec.end; i += 4) {
         const timeLabel = document.createElement('div');
         timeLabel.style.position = 'absolute';
         timeLabel.style.top = ((i - sec.start) * SLOT_HEIGHT) + 'px';
         timeLabel.style.left = '4px';
         timeLabel.style.fontSize = '10px';
         timeLabel.style.color = 'var(--muted)';
         const hour = Math.floor(i / 4);
         timeLabel.innerText = `${hour}:00`;
         secEl.appendChild(timeLabel);
       }
    });

    // Render Scheduled Tasks
    const scheduled = tasks.filter(t => t.startIndex !== null);
    scheduled.forEach(t => {
        // Find which section it belongs to
        // Note: Cross-section tasks are tricky. Assuming simple mapping for now.
        const sec = sections.find(s => t.startIndex >= s.start && t.startIndex < s.end);
        if(!sec) return;
        
        const container = el('#' + sec.id);
        const block = document.createElement('div');
        // NEU: Class 'is-done'
        block.className = `event-block ${t.completed ? 'is-done' : ''}`;
        block.dataset.id = t.id;
        
        const offset = t.startIndex - sec.start;
        block.style.top = (offset * SLOT_HEIGHT) + 'px';
        block.style.height = (t.durationSlots * SLOT_HEIGHT - 2) + 'px'; // -2 for margin
        
        block.innerHTML = `
            <div class="event-title">${t.title}</div>
            <div class="block-edit" onclick="window._mindframe.openEdit('${t.id}', event)">✎</div>
        `;

        // NEU: Toggle Done bei Klick auf den Block (nicht auf Edit Button)
        block.addEventListener('click', (e) => {
            if(e.target.classList.contains('block-edit')) return;
            // Toggle Completion
            t.completed = !t.completed;
            saveTasks(); // This triggers updateProgress
            render();
        });

        // Interact.js init for this block
        initInteract(block);
        
        container.appendChild(block);
    });

    updateProgress();
  }

  // 3. Update Progress Bars
  function updateProgress() {
      // 1. Habit Progress
      const totalHabits = habits.length;
      const doneHabits = habits.filter(h => h.completedToday).length;
      const habitPercent = totalHabits === 0 ? 0 : Math.round((doneHabits / totalHabits) * 100);
      
      el('#habit-bar').style.width = `${habitPercent}%`;
      el('#habit-percent').innerText = `${habitPercent}%`;

      // 2. Task Progress (Nur Scheduled Tasks zählen für den Tagesfortschritt)
      const scheduledTasks = tasks.filter(t => t.startIndex !== null);
      const totalScheduled = scheduledTasks.length;
      const doneScheduled = scheduledTasks.filter(t => t.completed).length;
      const taskPercent = totalScheduled === 0 ? 0 : Math.round((doneScheduled / totalScheduled) * 100);

      el('#task-bar').style.width = `${taskPercent}%`;
      el('#task-percent').innerText = `${taskPercent}%`;
  }


  /** ---------- Drag & Drop (HTML5 for Sidebar -> Schedule) ---------- */
  function handleDragStart(e) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', e.target.dataset.id);
    e.target.style.opacity = '0.4';
    currentDragId = e.target.dataset.id;
  }

  function handleDragEnd(e) {
    e.target.style.opacity = '1';
    currentDragId = null;
    els('.drop-hover').forEach(x => x.classList.remove('drop-hover'));
  }

  function setupHtmlDnD() {
    // Drop Zones: Sections
    els('.section-body').forEach(body => {
      body.addEventListener('dragover', e => { 
        e.preventDefault(); 
        body.classList.add('drop-hover');
      });
      body.addEventListener('dragleave', () => body.classList.remove('drop-hover'));
      body.addEventListener('drop', e => {
        e.preventDefault();
        body.classList.remove('drop-hover');
        const id = e.dataTransfer.getData('text/plain');
        if(!id) return;
        
        // Calculate Slot
        const rect = body.getBoundingClientRect();
        const y = e.clientY - rect.top + body.scrollTop;
        const secStart = parseInt(body.dataset.rangeStart);
        const idxInSection = Math.floor(y / SLOT_HEIGHT);
        const startIndex = clamp(secStart + idxInSection, secStart, secStart + 24 - 1);
        
        // Update Task
        updateTask(id, { list: null, startIndex, durationSlots: 4 }); // default 1h
      });
    });

    // Drop Zone: Todo List (Back from schedule)
    const listZone = el('#todo-list');
    // Note: Moving back is tricky with HTML5 DnD if source was Interact.js. 
    // Usually easier to use double-click on schedule to unschedule.
  }

  /** ---------- Interact.js (Resizing & Moving within Schedule) ---------- */
  function initInteract(element) {
    interact(element)
      .draggable({
        modifiers: [
          interact.modifiers.restrictRect({ containment: '.schedule', endOnly: true }),
          interact.modifiers.snap({
            targets: [ interact.createSnapGrid({ x: null, y: SLOT_HEIGHT }) ],
            range: Infinity,
            relativePoints: [ { x: 0, y: 0 } ]
          })
        ],
        listeners: {
          move(event) {
            // Visual feedback only, actual logic on end
            const target = event.target;
            const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
            target.style.transform = `translate(0px, ${y}px)`;
            target.setAttribute('data-y', y);
            target.style.zIndex = 100;
          },
          end(event) {
             const target = event.target;
             const id = target.dataset.id;
             const movedSlots = Math.round((parseFloat(target.getAttribute('data-y')) || 0) / SLOT_HEIGHT);
             
             // Find current task
             const t = tasks.find(x => x.id === id);
             if(t) {
                let newStart = t.startIndex + movedSlots;
                // Bounds check roughly
                if(newStart < 0) newStart = 0;
                if(newStart > 96) newStart = 96; 
                
                updateTask(id, { startIndex: newStart });
             }
             // Reset CSS transform
             target.style.transform = 'translate(0px, 0px)';
             target.setAttribute('data-y', 0);
          }
        }
      })
      .resizable({
        edges: { bottom: true, right: false, left: false, top: false },
        modifiers: [
            interact.modifiers.restrictEdges({ outer: 'parent' }),
            interact.modifiers.snapSize({ targets: [ interact.createSnapGrid({ y: SLOT_HEIGHT }) ] })
        ],
        listeners: {
            move: function (event) {
                let { h } = event.rect;
                event.target.style.height = h + 'px';
            },
            end: function(event) {
                const id = event.target.dataset.id;
                const h = event.rect.height;
                const slots = Math.round(h / SLOT_HEIGHT);
                updateTask(id, { durationSlots: Math.max(1, slots) });
            }
        }
      });
  }

  // Trash Zone
  function setupTrash() {
      const trash = el('#trash-zone');
      trash.addEventListener('dragover', e => { e.preventDefault(); trash.classList.add('drag-hover'); });
      trash.addEventListener('dragleave', () => trash.classList.remove('drag-hover'));
      trash.addEventListener('drop', e => {
          e.preventDefault();
          trash.classList.remove('drag-hover');
          const id = e.dataTransfer.getData('text/plain');
          if(id) removeTask(id);
      });
      
      interact('#trash-zone').dropzone({
          accept: '.event-block',
          ondrop: function(event) {
              const id = event.relatedTarget.dataset.id;
              removeTask(id);
          }
      });
  }

  /** ---------- UI Interactions ---------- */
  function setupUI() {
      // Add Task
      el('#newTaskInput').addEventListener('keydown', e => {
          if(e.key === 'Enter' && e.target.value.trim()) {
              addTask(e.target.value.trim(), el('#newPriority').value);
              e.target.value = '';
          }
      });
      
      // Add Habit
      el('#new-habit-input').addEventListener('keydown', e => {
          if(e.key === 'Enter' && e.target.value.trim()) {
              addHabit(e.target.value.trim());
              e.target.value = '';
          }
      });
      
      // Clear Done
      el('#btnClearDone').addEventListener('click', clearDoneTasks);

      // Section Toggles
      els('.section-toggle').forEach(btn => {
          btn.addEventListener('click', () => {
              const targetId = btn.dataset.target;
              const body = el(targetId);
              body.hidden = !body.hidden;
          });
      });
      // Default: Expand Morning & Midday
      el('#sec-morning').hidden = false;
      el('#sec-midday').hidden = false;
      
      // Export
      el('#exportButton').addEventListener('click', () => {
          alert('Export Feature Placeholder');
          // Hier käme die PDF/CSV Logik aus dem original README hin
      });
      
      // Dialog
      el('#editDialog').addEventListener('close', () => {
         // handle dialog close if needed
      });
  }

  // Edit Dialog
  window._mindframe = {
      openEdit: (id, e) => {
          e.stopPropagation(); // prevent toggle done
          openEditDialog(id);
      },
      toggleHabit: toggleHabit,
      deleteHabit: deleteHabit
  };

  let editingId = null;
  const dialog = el('#editDialog');
  
  function openEditDialog(id) {
      const t = tasks.find(x => x.id === id);
      if(!t) return;
      editingId = id;
      el('#editTitle').value = t.title;
      el('#editPriority').value = t.priority;
      dialog.showModal();
  }
  
  dialog.querySelector('button[value="save"]').addEventListener('click', (e) => {
      // e.preventDefault() handled by form method="dialog" usually, but let's be safe
      if(editingId) {
          updateTask(editingId, {
              title: el('#editTitle').value,
              priority: el('#editPriority').value
          });
      }
  });


  /** ---------- Init ---------- */
  function init() {
    load();
    setupHtmlDnD();
    setupTrash();
    setupUI();
    render();
    renderHabits();
    
    // Global Loop to update date if it changes at midnight? 
    // For now simple load is enough.
  }

  init();
})();
