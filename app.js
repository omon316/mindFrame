/* MindFrame V2.0 // SYSTEM CORE */
(() => {
    // --- CONFIG ---
    const STORAGE_TASKS = 'mf_v2_tasks';
    const STORAGE_HABITS = 'mf_v2_habits';
    // 60px pro Stunde, d.h. 15px pro 15min Slot
    const SLOT_HEIGHT = 15; 
    const SLOTS_PER_HOUR = 4;
    const TOTAL_HOURS = 24;
    const TOTAL_SLOTS = TOTAL_HOURS * SLOTS_PER_HOUR; // 96 Slots

    // --- STATE ---
    let tasks = [];
    let habits = [];
    let currentView = 'view-dashboard';

    // --- DOM CACHE ---
    const els = (sel) => document.querySelectorAll(sel);
    const el = (sel) => document.querySelector(sel);

    // --- INIT ---
    function init() {
        loadData();
        setupNavigation();
        renderHabits();
        renderBacklog();
        renderTimeGrid(); // Baut das statische Grid
        renderSchedule(); // Platziert die Tasks
        setupInteractions();
        updateMetrics();
        
        // Default View
        el('.nav-links li[data-view="view-dashboard"]').click();
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
        
        // Generiere 24 Stunden Zeilen
        for(let h = 0; h < 24; h++) {
            // Eine Stunden-Zeile (Höhe = 4 Slots)
            const row = document.createElement('div');
            row.className = 'time-row';
            row.style.height = (SLOT_HEIGHT * 4) + 'px'; // 60px
            
            const label = document.createElement('div');
            label.className = 'time-label';
            // Format 08:00
            label.innerText = `${h.toString().padStart(2, '0')}:00`;
            
            row.appendChild(label);
            container.appendChild(row);
        }
    }

    function renderSchedule() {
        const layer = el('#task-layer');
        // Entferne alte Tasks (aber behalte nicht den Ghost, der ist im container parent)
        layer.innerHTML = '';

        const scheduledTasks = tasks.filter(t => t.startIndex !== null);

        scheduledTasks.forEach(t => {
            const div = document.createElement('div');
            div.className = `task-block ${t.completed ? 'done' : ''}`;
            div.innerText = t.title;
            div.dataset.id = t.id;
            
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
            
            // Single Click to toggle done
            div.addEventListener('click', (e) => {
                 // Prevent trigger on drag end
                 if(div.getAttribute('data-dragging') === 'true') return;
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
            tr.innerHTML = `
                <td style="font-family:var(--font-mono); color:var(--text-muted)">${t.id.substr(-4)}</td>
                <td>${t.title}</td>
                <td style="color:${getPriorityColor(t.priority)}">${getPriorityLabel(t.priority)}</td>
                <td>
                   <button class="btn-text" onclick="window.mf.scheduleNow('${t.id}')">SCHEDULE ></button>
                </td>
            `;
            tbody.appendChild(tr);
        });
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
    
    function initInteract(element) {
        interact(element)
        .draggable({
            modifiers: [
                interact.modifiers.restrictRect({ containment: '#schedule-container' })
            ],
            listeners: {
                start(event) {
                    event.target.setAttribute('data-dragging', 'true');
                    // Ghost anzeigen
                    const ghost = el('#drag-ghost');
                    const rect = event.target.getBoundingClientRect();
                    // Initiale Position des Ghost
                    ghost.style.top = event.target.style.top;
                    ghost.style.height = event.target.style.height;
                    ghost.style.display = 'block';
                },
                move(event) {
                    const target = event.target;
                    const ghost = el('#drag-ghost');
                    
                    // Berechne aktuelle Verschiebung
                    const currentY = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
                    
                    // Bewege das Element visuell
                    target.style.transform = `translate(0px, ${currentY}px)`;
                    target.setAttribute('data-y', currentY);
                    
                    // --- GHOST LOGIC ---
                    // Wir müssen wissen, wo das Element relativ zum Container ist
                    // Einfacher: Wir nehmen die Original top Position + currentY
                    const originalTop = parseInt(target.style.top || 0);
                    const absoluteY = originalTop + currentY;
                    
                    // Snap Berechnung für den Ghost
                    const snapIndex = Math.round(absoluteY / SLOT_HEIGHT);
                    const snapTop = snapIndex * SLOT_HEIGHT;
                    
                    ghost.style.top = snapTop + 'px';
                },
                end(event) {
                    const target = event.target;
                    const ghost = el('#drag-ghost');
                    ghost.style.display = 'none'; // Ghost verstecken
                    
                    // Berechne die finalen Slots
                    const currentY = parseFloat(target.getAttribute('data-y')) || 0;
                    const originalTop = parseInt(target.style.top || 0);
                    const finalY = originalTop + currentY;
                    
                    let newStartIndex = Math.round(finalY / SLOT_HEIGHT);
                    
                    // Bounds Check (0 bis 96)
                    if(newStartIndex < 0) newStartIndex = 0;
                    if(newStartIndex > 95) newStartIndex = 95;
                    
                    // Update Model
                    const t = tasks.find(x => x.id === target.dataset.id);
                    if(t) {
                        t.startIndex = newStartIndex;
                        saveData();
                    }
                    
                    // Reset DOM (Render macht den Rest sauber)
                    target.setAttribute('data-dragging', 'false');
                    target.style.transform = 'translate(0px, 0px)';
                    target.setAttribute('data-y', 0);
                    renderSchedule();
                }
            }
        })
        .resizable({
            edges: { bottom: true, top: false, left: false, right: false },
            listeners: {
                move(event) {
                    let { height } = event.rect;
                    event.target.style.height = height + 'px';
                },
                end(event) {
                    const h = event.rect.height;
                    const slots = Math.round(h / SLOT_HEIGHT);
                    const t = tasks.find(x => x.id === event.target.dataset.id);
                    if(t) {
                        t.durationSlots = Math.max(1, slots);
                        saveData();
                        renderSchedule();
                    }
                }
            }
        });
    }

    // --- LOGIC: HELPERS ---

    window.mf = {
        scheduleNow: (id) => {
            const t = tasks.find(x => x.id === id);
            if(t) {
                // Finde ersten freien Slot ab 08:00 (32 slots)
                t.startIndex = 32; 
                t.durationSlots = 4; // 1h
                saveData();
                renderSchedule();
                renderBacklog();
                // Wechsle zur Schedule View
                el('.nav-links li[data-view="view-schedule"]').click();
            }
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
