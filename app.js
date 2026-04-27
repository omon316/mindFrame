/* MindFrame V2.0 // SYSTEM CORE */
(() => {
    // --- CONFIG ---
    const STORAGE_TASKS = 'mf_v2_tasks';
    const STORAGE_HABITS = 'mf_v2_habits';
    const SLOTS_PER_HOUR = 4;
    const TOTAL_HOURS = 24;
    const TOTAL_SLOTS = TOTAL_HOURS * SLOTS_PER_HOUR; // 96 Slots
    // Slot-Höhe wird aus CSS (--slot-height) gelesen → eine Quelle der Wahrheit.
    // let, weil sich der Wert je Breakpoint (Mobile/Desktop) aendern kann.
    let SLOT_HEIGHT = readSlotHeight();
    function readSlotHeight() {
        return parseInt(
            getComputedStyle(document.documentElement).getPropertyValue('--slot-height')
        ) || 15;
    }

    // --- STATE ---
    let tasks = [];
    let habits = [];
    let currentView = 'view-dashboard';
    let armedTaskId = null;  // Task, der per Tap auf Slot platziert wird

    // --- DOM CACHE ---
    const els = (sel) => document.querySelectorAll(sel);
    const el = (sel) => document.querySelector(sel);

    // --- INIT ---
    function init() {
        loadData();
        setupNavigation();
        // Globale interact.js Konfiguration:
        // - 5px Bewegungstoleranz → Tipp/Klick zaehlt nicht als Drag
        if (window.interact) {
            // 8px Toleranz: Finger-Jitter beim Tippen zaehlt nicht als Drag
            interact.pointerMoveTolerance(8);
        }
        renderHabits();
        renderBacklog();
        renderTimeGrid(); // Baut das statische Grid
        renderSchedule(); // Platziert die Tasks
        updateMetrics();

        // "Jetzt"-Linie: einmal positionieren + initial in den Sichtbereich scrollen,
        // dann minuetlich aktualisieren.
        updateNowLine();
        scrollToNow();
        setInterval(updateNowLine, 60 * 1000);
        // Wenn der User in die Timeline wechselt: nochmal auf "jetzt" scrollen
        els('.nav-links li[data-view="view-schedule"]').forEach(li => {
            li.addEventListener('click', () => setTimeout(scrollToNow, 0));
        });

        // Bei Orientierungswechsel/Resize: Slot-Hoehe neu lesen + Schedule rendern,
        // damit Tasks beim Wechsel Mobile <-> Desktop richtig positioniert bleiben.
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                SLOT_HEIGHT = readSlotHeight();
                renderSchedule();
                updateNowLine();
            }, 150);
        });
    }

    // --- NAVIGATION ---
    function setupNavigation() {
        els('.nav-links li[data-view]').forEach(li => {
            li.addEventListener('click', () => {
                // UI Toggle
                els('.nav-links li').forEach(x => x.classList.remove('active'));
                li.classList.add('active');
                
                // View Toggle
                els('.view').forEach(v => v.classList.remove('active'));
                const targetId = li.dataset.view;
                el('#' + targetId).classList.add('active');
                currentView = targetId;
            });
        });
        
        // Date Display
        el('#date-display').innerText = new Date().toLocaleDateString('de-DE');
    }

    // --- DATA HANDLING ---
    function loadData() {
        try {
            tasks = JSON.parse(localStorage.getItem(STORAGE_TASKS) || '[]');
            habits = JSON.parse(localStorage.getItem(STORAGE_HABITS) || '[]');
        } catch(e) { console.error('Data corrupted', e); }
    }
    
    function saveData() {
        localStorage.setItem(STORAGE_TASKS, JSON.stringify(tasks));
        localStorage.setItem(STORAGE_HABITS, JSON.stringify(habits));
        updateMetrics();
    }

    // --- RENDERERS: GRID & SCHEDULE ---
    
    function renderTimeGrid() {
        const container = el('#time-grid');
        container.innerHTML = '';

        // Generiere 24 Stunden Zeilen (Höhe wird via CSS --hour-height gesetzt)
        for(let h = 0; h < TOTAL_HOURS; h++) {
            const row = document.createElement('div');
            row.className = 'time-row';

            const label = document.createElement('div');
            label.className = 'time-label';
            label.innerText = `${h.toString().padStart(2, '0')}:00`;

            row.appendChild(label);
            container.appendChild(row);
        }
    }

    // Aktuelle Zeit als horizontale Linie. Wird minuetlich aktualisiert.
    function updateNowLine() {
        const line = el('#now-line');
        if(!line) return;
        const now = new Date();
        const minutesFromMidnight = now.getHours() * 60 + now.getMinutes();
        // 1 Slot = 15 Minuten => Pixel = (Minuten / 15) * SLOT_HEIGHT
        const y = (minutesFromMidnight / 15) * SLOT_HEIGHT;
        line.style.top = y + 'px';
        line.querySelector('.now-time').innerText =
            `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    }

    // Beim ersten Rendern auf "Jetzt" scrollen
    function scrollToNow() {
        const wrapper = el('.schedule-wrapper');
        if(!wrapper) return;
        const now = new Date();
        const minutesFromMidnight = now.getHours() * 60 + now.getMinutes();
        const y = (minutesFromMidnight / 15) * SLOT_HEIGHT;
        // 2 Stunden vor Jetzt sichtbar machen
        wrapper.scrollTop = Math.max(0, y - 2 * SLOT_HEIGHT * 4);
    }

    function renderSchedule() {
        const layer = el('#task-layer');
        // Entferne alte Tasks (aber behalte nicht den Ghost, der ist im container parent)
        layer.innerHTML = '';

        const scheduledTasks = tasks.filter(t => t.startIndex !== null);

        scheduledTasks.forEach(t => {
            const div = document.createElement('div');
            div.className = `task-block prio-${t.priority || 2} ${t.completed ? 'done' : ''}`;
            div.dataset.id = t.id;

            // Inhalt + dedizierter Resize-Griff (eigenes Element = grosser Touch-Hotspot)
            div.innerHTML = `
                <div class="task-block-body">${escapeHtml(t.title)}</div>
                <div class="resize-handle" aria-label="Groesse aendern"></div>
            `;

            // Positioning absolute based on slots
            const topPos = t.startIndex * SLOT_HEIGHT;
            const height = t.durationSlots * SLOT_HEIGHT;

            div.style.top = topPos + 'px';
            div.style.height = (height - 2) + 'px'; // -2 für Margin/Border
            
            // Edit Click
            div.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                openEditDialog(t.id);
            });

            // Single Click to toggle done – aber nur wenn nicht gezogen/resized wurde
            div.addEventListener('click', (e) => {
                 if(div.getAttribute('data-moved') === 'true') return;
                 if(div.getAttribute('data-resized') === 'true') return;
                 t.completed = !t.completed;
                 saveData();
                 renderSchedule();
            });

            layer.appendChild(div);
            initInteract(div);
        });
    }

    // --- RENDERERS: TABLES ---

    function renderBacklog() {
        const tbody = el('#backlog-table-body');
        tbody.innerHTML = '';

        const backlogTasks = tasks.filter(t => t.startIndex === null);

        backlogTasks.forEach(t => {
            const tr = document.createElement('tr');
            tr.className = 'backlog-row' + (armedTaskId === t.id ? ' armed' : '');
            tr.innerHTML = `
                <td style="font-family:var(--font-mono); color:var(--text-muted)">${t.id.slice(-4)}</td>
                <td>${escapeHtml(t.title)}</td>
                <td style="color:${getPriorityColor(t.priority)}">${getPriorityLabel(t.priority)}</td>
                <td style="display:flex; gap:6px">
                   <button class="btn-text" onclick="window.mf.armPlacement('${t.id}')">PLACE&nbsp;&gt;</button>
                   <button class="btn-text" style="color:var(--danger)" onclick="window.mf.deleteTask('${t.id}')">X</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        })[c]);
    }

    function renderHabits() {
        const tbody = el('#habit-table-body');
        tbody.innerHTML = '';
        
        habits.forEach(h => {
            const today = new Date().toISOString().split('T')[0];
            const isDoneToday = (h.lastCompleted === today);
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <button class="btn-text" style="color:${isDoneToday ? 'var(--success)' : '#444'}" onclick="window.mf.toggleHabit('${h.id}')">
                        ${isDoneToday ? '[X]' : '[ ]'}
                    </button>
                </td>
                <td style="${isDoneToday ? 'text-decoration:line-through;color:var(--text-muted)' : ''}">${h.title}</td>
                <td style="font-family:var(--font-mono); color:var(--accent)">${h.streak} DAYS</td>
                <td><button class="btn-text" style="color:var(--danger)" onclick="window.mf.deleteHabit('${h.id}')">X</button></td>
            `;
            tbody.appendChild(tr);
        });
    }

    // --- INTERACT.JS & GHOST PREVIEW ---

    // Scroll des Schedule-Wrappers waehrend Drag/Resize sperren,
    // damit Touch-Gesten nicht versehentlich die Liste scrollen.
    function lockScroll() {
        const w = el('.schedule-wrapper');
        if (w) {
            w.dataset.scrollY = w.scrollTop;
            w.style.overflowY = 'hidden';
        }
    }
    function unlockScroll() {
        const w = el('.schedule-wrapper');
        if (w) {
            w.style.overflowY = 'auto';
            if (w.dataset.scrollY) w.scrollTop = parseInt(w.dataset.scrollY);
        }
    }

    function initInteract(element) {
        interact(element)
        .draggable({
            autoScroll: false, // selbst scrollen verwirrt auf Touch nur
            modifiers: [
                interact.modifiers.restrictRect({ containment: '#schedule-container' })
            ],
            listeners: {
                start(event) {
                    const target = event.target;
                    target.classList.add('dragging');
                    target.setAttribute('data-moved', 'false');
                    target.setAttribute('data-y', '0');
                    lockScroll();
                    // Ghost anzeigen
                    const ghost = el('#drag-ghost');
                    ghost.style.top = target.style.top;
                    ghost.style.height = target.style.height;
                    ghost.style.display = 'block';
                },
                move(event) {
                    const target = event.target;
                    const ghost = el('#drag-ghost');

                    // Bewegung registrieren (verhindert Done-Toggle nach Drag)
                    target.setAttribute('data-moved', 'true');

                    // Aktuelle Verschiebung
                    const currentY = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
                    target.style.transform = `translate(0px, ${currentY}px)`;
                    target.setAttribute('data-y', currentY);

                    // Ghost auf das nächste Slot-Raster snappen
                    const originalTop = parseInt(target.style.top) || 0;
                    const snapIndex = Math.round((originalTop + currentY) / SLOT_HEIGHT);
                    ghost.style.top = (snapIndex * SLOT_HEIGHT) + 'px';
                },
                end(event) {
                    const target = event.target;
                    target.classList.remove('dragging');
                    unlockScroll();
                    const ghost = el('#drag-ghost');
                    ghost.style.display = 'none';

                    const currentY = parseFloat(target.getAttribute('data-y')) || 0;
                    const originalTop = parseInt(target.style.top) || 0;
                    let newStartIndex = Math.round((originalTop + currentY) / SLOT_HEIGHT);

                    // Bounds Check
                    const t = tasks.find(x => x.id === target.dataset.id);
                    const dur = t ? t.durationSlots : 1;
                    if(newStartIndex < 0) newStartIndex = 0;
                    if(newStartIndex > TOTAL_SLOTS - dur) newStartIndex = TOTAL_SLOTS - dur;

                    if(t) {
                        t.startIndex = newStartIndex;
                        saveData();
                    }

                    target.style.transform = 'translate(0px, 0px)';
                    target.setAttribute('data-y', '0');
                    renderSchedule();
                }
            }
        })
        .resizable({
            // Resize wird ueber dediziertes Handle-Element ausgeloest -> grosse,
            // gut sichtbare Touch-Flaeche, keine Verwechslung mit Drag.
            edges: { bottom: '.resize-handle', top: false, left: false, right: false },
            autoScroll: false,
            listeners: {
                start(event) {
                    event.target.setAttribute('data-resized', 'false');
                    event.target.classList.add('resizing');
                    lockScroll();
                },
                move(event) {
                    event.target.setAttribute('data-resized', 'true');
                    // Hoehe begrenzen: mind. 1 Slot, max bis Mitternacht
                    const top = parseInt(event.target.style.top) || 0;
                    const minH = SLOT_HEIGHT;
                    const maxH = TOTAL_SLOTS * SLOT_HEIGHT - top;
                    const h = Math.max(minH, Math.min(maxH, event.rect.height));
                    event.target.style.height = h + 'px';
                },
                end(event) {
                    event.target.classList.remove('resizing');
                    unlockScroll();
                    const slots = Math.round(event.rect.height / SLOT_HEIGHT);
                    const t = tasks.find(x => x.id === event.target.dataset.id);
                    if(t) {
                        t.durationSlots = Math.max(1, slots);
                        // Bounds: Block darf nicht über Mitternacht hinausragen
                        if(t.startIndex + t.durationSlots > TOTAL_SLOTS) {
                            t.durationSlots = TOTAL_SLOTS - t.startIndex;
                        }
                        saveData();
                        renderSchedule();
                    }
                }
            }
        });
    }

    // --- LOGIC: HELPERS ---

    window.mf = {
        // Tap-to-Place: armiert einen Task und wechselt in die Timeline.
        // User tippt dann einen Slot, um den Task dort zu platzieren.
        armPlacement: (id) => {
            const t = tasks.find(x => x.id === id);
            if(!t) return;
            armedTaskId = id;
            // Hint-Banner anzeigen
            const hint = el('#placement-hint');
            const title = el('#placement-hint-title');
            if(title) title.innerText = t.title;
            if(hint) hint.hidden = false;
            el('#schedule-container').classList.add('placement-mode');
            // View wechseln
            el('.nav-links li[data-view="view-schedule"]').click();
            renderBacklog(); // damit "armed"-Highlight erscheint
        },
        cancelPlacement: () => {
            armedTaskId = null;
            const hint = el('#placement-hint');
            if(hint) hint.hidden = true;
            el('#schedule-container').classList.remove('placement-mode');
            renderBacklog();
        },
        deleteTask: (id) => {
            if(!confirm('TASK LOESCHEN?')) return;
            tasks = tasks.filter(x => x.id !== id);
            // Falls geloeschter Task armed war, abbrechen
            if(armedTaskId === id) window.mf.cancelPlacement();
            saveData();
            renderBacklog();
            renderSchedule();
        },
        toggleHabit: (id) => {
            const h = habits.find(x => x.id === id);
            const today = new Date().toISOString().split('T')[0];
            if(h.lastCompleted === today) {
                h.lastCompleted = null;
                h.streak = Math.max(0, h.streak - 1);
            } else {
                h.lastCompleted = today;
                h.streak++;
            }
            saveData();
            renderHabits();
        },
        deleteHabit: (id) => {
            if(confirm('CONFIRM DELETION?')) {
                habits = habits.filter(x => x.id !== id);
                saveData();
                renderHabits();
            }
        }
    };

    // UI Inputs
    el('#addTaskBtn').addEventListener('click', () => {
        const title = el('#newTaskInput').value;
        if(title) {
            tasks.push({
                id: 't-' + Date.now(),
                title,
                priority: parseInt(el('#newPriority').value),
                startIndex: null, // Backlog
                durationSlots: 4,
                completed: false
            });
            el('#newTaskInput').value = '';
            saveData();
            renderBacklog();
        }
    });

    el('#new-habit-input').addEventListener('keydown', (e) => {
        if(e.key === 'Enter' && e.target.value) {
            habits.push({
                id: 'h-' + Date.now(),
                title: e.target.value,
                streak: 0,
                lastCompleted: null
            });
            e.target.value = '';
            saveData();
            renderHabits();
        }
    });
    
    el('#clear-schedule-btn').addEventListener('click', () => {
        // Remove only completed from schedule, put back to backlog? Or delete?
        // Let's delete completed
        if(confirm('PURGE COMPLETED TASKS?')) {
            tasks = tasks.filter(t => !t.completed);
            saveData();
            renderSchedule();
            updateMetrics();
        }
    });

    // Cancel-Button im Placement-Banner
    el('#placement-cancel-btn').addEventListener('click', () => window.mf.cancelPlacement());

    // Tap auf einen Slot im Schedule = armierter Task wird hier platziert.
    // Klicks auf bestehende Task-Blocks werden ignoriert (eigener Handler dort).
    el('#schedule-container').addEventListener('click', (e) => {
        if(!armedTaskId) return;
        if(e.target.closest('.task-block')) return; // Klick auf bestehenden Task -> ignorieren

        const t = tasks.find(x => x.id === armedTaskId);
        if(!t) { window.mf.cancelPlacement(); return; }

        // Y-Position relativ zum Container -> Slot-Index
        // getBoundingClientRect beruecksichtigt Scroll bereits.
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        let slotIndex = Math.floor(y / SLOT_HEIGHT);

        // Defaults + Bounds
        if(t.durationSlots == null || t.durationSlots < 1) t.durationSlots = 4; // 1h
        if(slotIndex < 0) slotIndex = 0;
        if(slotIndex + t.durationSlots > TOTAL_SLOTS) {
            slotIndex = TOTAL_SLOTS - t.durationSlots;
        }
        t.startIndex = slotIndex;

        // State zuruecksetzen
        armedTaskId = null;
        const hint = el('#placement-hint');
        if(hint) hint.hidden = true;
        el('#schedule-container').classList.remove('placement-mode');

        saveData();
        renderBacklog();
        renderSchedule();
    });

    // Helper functions
    function getPriorityLabel(p) { return p===1 ? 'HIGH' : (p===2 ? 'NRML' : 'LOW'); }
    function getPriorityColor(p) { return p===1 ? 'var(--danger)' : (p===2 ? 'var(--warn)' : 'var(--accent)'); }

    function updateMetrics() {
        // Tasks
        const scheduled = tasks.filter(t => t.startIndex !== null);
        const done = scheduled.filter(t => t.completed).length;
        const total = scheduled.length;
        const tPerc = total === 0 ? 0 : Math.round((done/total)*100);
        el('#task-percent').innerText = tPerc + '%';
        el('#task-bar').style.width = tPerc + '%';

        // Habits
        const hDone = habits.filter(h => h.lastCompleted === new Date().toISOString().split('T')[0]).length;
        const hTotal = habits.length;
        const hPerc = hTotal === 0 ? 0 : Math.round((hDone/hTotal)*100);
        el('#habit-percent').innerText = hPerc + '%';
        el('#habit-bar').style.width = hPerc + '%';
    }
    
    // --- EDIT DIALOG ---
    const dialog = el('#editDialog');
    let editingId = null;
    
    window.openEditDialog = (id) => {
        const t = tasks.find(x => x.id === id);
        if(!t) return;
        editingId = id;
        el('#editTitle').value = t.title;
        el('#editPriority').value = t.priority;
        dialog.showModal();
    };
    
    dialog.querySelector('button[value="save"]').addEventListener('click', () => {
        if(editingId) {
            const t = tasks.find(x => x.id === editingId);
            t.title = el('#editTitle').value;
            t.priority = parseInt(el('#editPriority').value);
            saveData();
            renderSchedule();
            renderBacklog();
        }
    });

    // Start
    init();
})();
