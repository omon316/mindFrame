/* MindFrame core — robust, no frameworks */
(() => {
  const STORAGE_KEY = 'mindframe_tasks_v1';
  const SLOT_HEIGHT = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--slot-height')) || 12;
  const DAY_SLOTS = 96; // 24h * 4
  const sections = [
    { id: 'sec-night', start: 0, end: 24 },
    { id: 'sec-morning', start: 24, end: 48 },
    { id: 'sec-midday', start: 48, end: 72 },
    { id: 'sec-evening', start: 72, end: 96 }
  ];

  /** ---------- State ---------- */
  /** @type {Array<{id:string,title:string,priority:1|2|3,list:'today'|'week'|null,startIndex:number|null,durationSlots:number}>} */
  let tasks = [];

  // Variables used during HTML drag operations
  let currentDragId = null;
  let currentDragSlots = 4;
  let dragImageEl = null;

  /** ---------- Utilities ---------- */
  const uuid = () => 't-' + (crypto.randomUUID?.() || Math.random().toString(36).slice(2));
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const el = (sel, root=document) => root.querySelector(sel);
  const els = (sel, root=document) => [...root.querySelectorAll(sel)];
  const fmtTime = idx => {
    const m = idx * 15;
    const hh = String(Math.floor(m/60)).padStart(2,'0');
    const mm = String(m%60).padStart(2,'0');
    return `${hh}:${mm}`;
  };

  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  const load = () => {
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      tasks = raw ? JSON.parse(raw) : [];
    }catch{ tasks = []; }
  };

  /** ---------- Quick Capture ---------- */
  const captureList = el('#captureList');
  function addCaptureRow() {
    // Always remove existing capture rows to avoid duplicates
    captureList.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <textarea placeholder="Task eingeben…"></textarea>
      <select title="Priorität wählen (1=hoch, 2=mittel, 3=niedrig)">
        <option value="1">1 — Hoch</option>
        <option value="2" selected>2 — Mittel</option>
        <option value="3">3 — Niedrig</option>
      </select>
      <button class="add" title="Task hinzufügen">+</button>
    `;
    captureList.appendChild(row);
    const ta = row.querySelector('textarea');
    const prio = row.querySelector('select');
    const btn = row.querySelector('.add');

    const commit = () => {
      const title = ta.value.trim();
      if(!title) return;
      createTask(title, parseInt(prio.value) || 2, 'today');
      // Reset the capture row. Create one new row and focus its textarea.
      addCaptureRow();
      const newTa = captureList.querySelector('textarea');
      if(newTa) newTa.focus();
    };

    ta.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); commit(); }
      if((e.key === 'Enter' && e.ctrlKey) || (e.key === 'Enter' && e.metaKey)){ e.preventDefault(); commit(); }
    });
    btn.addEventListener('click', commit);
    ta.focus();
  }

  /** ---------- Task CRUD ---------- */
  function createTask(title, priority=2, list='today'){
    const t = { id: uuid(), title, priority, list, startIndex: null, durationSlots: 4 };
    tasks.push(t);
    save(); render();
  }

  function updateTask(id, patch){
    const t = tasks.find(x => x.id === id);
    if(!t) return;
    Object.assign(t, patch);
    save(); render();
  }

  function removeTask(id){
    tasks = tasks.filter(x => x.id !== id);
    save(); render();
  }

  /** ---------- Rendering ---------- */
  const todayList = el('#todayList');
  const weekList  = el('#weekList');

  function taskStripeClass(p){ return `priority-${clamp(p,1,3)}`; }

  function buildTaskListItem(t){
    const li = document.createElement('li');
    li.className = `task-item ${taskStripeClass(t.priority)}`;
    li.dataset.id = t.id;
    li.setAttribute('role','listitem');
    li.innerHTML = `
      <div class="title" title="Doppelklick zum Bearbeiten">${escapeHtml(t.title)}</div>
      <div class="tools">
        <button class="tool edit" title="Bearbeiten (✎)" aria-label="Bearbeiten">✎</button>
        <button class="tool move" title="In Schedule ziehen oder in Backlog verschieben" aria-label="Verschieben">⇅</button>
      </div>
    `;

    const edit = () => openInlineEditor(li, t);
    li.querySelector('.edit').addEventListener('click', edit);
    li.querySelector('.title').addEventListener('dblclick', edit);

    // Native drag: enable drag & drop
    li.setAttribute('draggable','true');
    li.addEventListener('dragstart', (e) => {
      currentDragId = t.id;
      currentDragSlots = 4;
      li.classList.add('drag-active');
      // create a custom ghost image to avoid default white rectangle
      try{
        const clone = li.cloneNode(true);
        clone.style.position = 'absolute';
        clone.style.top = '-1000px';
        clone.style.left = '-1000px';
        clone.style.opacity = '0.7';
        clone.style.width = li.offsetWidth + 'px';
        clone.style.height = li.offsetHeight + 'px';
        document.body.appendChild(clone);
        dragImageEl = clone;
        if(e.dataTransfer && e.dataTransfer.setDragImage){
          e.dataTransfer.setDragImage(clone, 0, 0);
        }
      }catch(err){}
      if(e.dataTransfer){ e.dataTransfer.setData('text/plain', t.id); }
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('drag-active');
      hideGhost();
      if(dragImageEl){ dragImageEl.remove(); dragImageEl = null; }
    });
    return li;
  }

  function openInlineEditor(li, t){
    li.innerHTML = `
      <input class="title-edit" value="${escapeHtmlAttr(t.title)}" />
      <select class="prio">
        <option value="1"${t.priority===1?' selected':''}>1 — Hoch</option>
        <option value="2"${t.priority===2?' selected':''}>2 — Mittel</option>
        <option value="3"${t.priority===3?' selected':''}>3 — Niedrig</option>
      </select>
      <div class="tools">
        <button class="tool save" title="Speichern">✔</button>
        <button class="tool cancel" title="Abbrechen">✖</button>
      </div>
    `;
    const input = li.querySelector('.title-edit');
    const prio  = li.querySelector('.prio');
    const commit = () => updateTask(t.id, { title: input.value.trim() || t.title, priority: parseInt(prio.value)||t.priority });
    li.querySelector('.save').addEventListener('click', commit);
    li.querySelector('.cancel').addEventListener('click', render);
    input.addEventListener('keydown', e => { if(e.key==='Enter'){ commit(); }});
    input.focus();
    input.select();
  }

  /**
   * Editor for a scheduled block directly inside the schedule. Allows editing title
   * and priority of a task without unscheduling it. Replaces the block's
   * content with form elements temporarily. When saving or cancelling, the
   * block is re-rendered.
   * @param {HTMLElement} block
   * @param {{id:string,title:string,priority:1|2|3,startIndex:number,durationSlots:number}} task
   */
  function openBlockEditor(block, task){
    // Prevent dragging while editing
    block.setAttribute('draggable','false');
    const originalHTML = block.innerHTML;
    block.innerHTML = `
      <input class="block-title-edit" value="${escapeHtmlAttr(task.title)}" />
      <select class="block-prio" title="Priorität wählen">
        <option value="1"${task.priority===1?' selected':''}>1 — Hoch</option>
        <option value="2"${task.priority===2?' selected':''}>2 — Mittel</option>
        <option value="3"${task.priority===3?' selected':''}>3 — Niedrig</option>
      </select>
      <div class="tools">
        <button class="tool save" title="Speichern">✔</button>
        <button class="tool cancel" title="Abbrechen">✖</button>
      </div>
      <div class="resize-handle" title="Ziehen zum Anpassen (15-Min-Raster)"></div>
    `;
    const input = block.querySelector('.block-title-edit');
    const prioSel = block.querySelector('.block-prio');
    const saveBtn = block.querySelector('.save');
    const cancelBtn = block.querySelector('.cancel');
    const commit = () => {
      const newTitle = input.value.trim() || task.title;
      const newPrio = parseInt(prioSel.value) || task.priority;
      updateTask(task.id, { title: newTitle, priority: newPrio });
      // restore draggable state
      block.setAttribute('draggable','true');
    };
    saveBtn.addEventListener('click', commit);
    cancelBtn.addEventListener('click', () => {
      // simply re-render schedule to restore original block layout
      renderSchedule();
    });
    input.addEventListener('keydown', e => {
      if(e.key === 'Enter'){
        e.preventDefault();
        commit();
      }
    });
    input.focus();
    input.select();
  }

  function renderLists(){
    todayList.innerHTML = '';
    weekList.innerHTML = '';
    for(const t of tasks){
      if(t.list === 'today') todayList.appendChild(buildTaskListItem(t));
      if(t.list === 'week')  weekList.appendChild(buildTaskListItem(t));
    }
  }

  function renderSchedule(){
    // Clear bodies
    for(const s of sections){
      const body = el('#'+s.id);
      body.innerHTML = '';
      // paint hour labels as background markers
      addTimeLabels(body, s.start, s.end);
    }
    // render only scheduled (list === null)
    const scheduled = tasks.filter(t => t.list === null && Number.isInteger(t.startIndex));
    // Place in proper section
    for(const t of scheduled){
      const s = sections.find(ss => t.startIndex >= ss.start && t.startIndex < ss.end);
      if(!s) continue;
      const body = el('#'+s.id);
      const block = buildEventBlock(t, s);
      body.appendChild(block);
    }
    // enable drag & resize on blocks
    activateBlockDnD();
  }

  function addTimeLabels(body, start, end){
    for(let idx=start; idx<end; idx+=4){
      const y = (idx - start) * SLOT_HEIGHT;
      const label = document.createElement('div');
      label.style.position = 'absolute';
      /* position within the time column */
      label.style.left = '0';
      label.style.width = 'var(--time-col-width)';
      label.style.paddingRight = '4px';
      label.style.top = (y - 7) + 'px';
      label.style.fontSize = '11px';
      label.style.color = 'var(--muted)';
      label.style.textAlign = 'right';
      label.style.pointerEvents = 'none';
      label.textContent = fmtTime(idx);
      body.appendChild(label);
    }
  }

  function buildEventBlock(t, s){
    const body = el('#'+s.id);
    const block = document.createElement('div');
    block.className = `event-block ${taskStripeClass(t.priority)}`;
    block.dataset.id = t.id;

    const top = (t.startIndex - s.start) * SLOT_HEIGHT;
    const height = (t.durationSlots) * SLOT_HEIGHT;

    block.style.top = top+'px';
    block.style.height = height+'px';

    block.innerHTML = `
      <div class="event-title" title="Doppelklick: zurück in 'Heutige Tasks'">${escapeHtml(t.title)}</div>
      <div class="event-meta">${fmtTime(t.startIndex)}–${fmtTime(t.startIndex + t.durationSlots)}</div>
      <span class="block-edit" title="Bearbeiten">✎</span>
      <div class="resize-handle" title="Ziehen zum Anpassen (15-Min-Raster)"></div>
    `;
    // unschedule on double-click
    block.addEventListener('dblclick', () => {
      updateTask(t.id, { list: 'today', startIndex: null, durationSlots: 4 });
    });
    // edit button
    const editBtn = block.querySelector('.block-edit');
    editBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openBlockEditor(block, t);
    });

    // HTML5 drag to allow moving back to lists or delete zone and reposition within schedule
    block.setAttribute('draggable','true');
    block.addEventListener('dragstart', (e) => {
      currentDragId = t.id;
      currentDragSlots = t.durationSlots;
      block.classList.add('drag-active');
      // custom ghost image
      try{
        const clone = block.cloneNode(true);
        clone.style.position='absolute';
        clone.style.top='-1000px';
        clone.style.left='-1000px';
        clone.style.opacity='0.7';
        clone.style.width=block.offsetWidth + 'px';
        clone.style.height=block.offsetHeight + 'px';
        document.body.appendChild(clone);
        dragImageEl = clone;
        if(e.dataTransfer && e.dataTransfer.setDragImage){
          e.dataTransfer.setDragImage(clone, 0, 0);
        }
      }catch(err){}
      if(e.dataTransfer){ e.dataTransfer.setData('text/plain', t.id); }
    });
    block.addEventListener('dragend', () => {
      block.classList.remove('drag-active');
      hideGhost();
      if(dragImageEl){ dragImageEl.remove(); dragImageEl = null; }
    });
    return block;
  }

  /** ---------- DnD from Lists ---------- */
  function makeListDraggable(li){
    interact(li).draggable({
      listeners: {
        start (event) {
          event.target.classList.add('drag-active');
        },
        move (event) {
          const target = event.target;
          const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
          const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
          target.style.transform = `translate(${x}px, ${y}px)`;
          target.setAttribute('data-x', x);
          target.setAttribute('data-y', y);
        },
        end (event) {
          const target = event.target;
          target.style.transform = '';
          target.removeAttribute('data-x');
          target.removeAttribute('data-y');
          target.classList.remove('drag-active');
          hideGhost();
        }
      },
      inertia: true
    });
  }

  // Schedule section dropzones
  els('.section-body').forEach(body => {
    interact(body).dropzone({
      ondragenter (event){
        const tId = event.relatedTarget?.dataset?.id;
        if(!tId) return;
        showGhostAt(event, body);
      },
      ondragleave (event){ hideGhost(); },
      ondropmove (event){ showGhostAt(event, body); },
      ondrop (event){
        hideGhost();
        const tId = event.relatedTarget?.dataset?.id;
        if(!tId) return;
        const secStart = parseInt(body.dataset.rangeStart);
        const rect = body.getBoundingClientRect();
        const y = event.dragEvent.clientY - rect.top + body.scrollTop;
        const idxInSection = clamp(Math.round(y / SLOT_HEIGHT), 0, 24); // 0..24
        const startIndex = clamp(secStart + idxInSection, secStart, secStart + 24 - 1);
        // schedule it
        updateTask(tId, { list: null, startIndex, durationSlots: Math.max(tasks.find(x=>x.id===tId)?.durationSlots || 4, 1) });
        resolveCollisions();
      }
    });
  });

  // Today / Week dropzones (for returning or moving between lists)
  interact('#todayList').dropzone({
    ondrop (event){
      const id = event.relatedTarget?.dataset?.id; if(!id) return;
      updateTask(id, { list: 'today', startIndex: null, durationSlots: 4 });
    }
  });
  interact('#weekList').dropzone({
    ondrop (event){
      const id = event.relatedTarget?.dataset?.id; if(!id) return;
      updateTask(id, { list: 'week', startIndex: null, durationSlots: 4 });
    }
  });

  // Delete zone
  interact('#deleteZone').dropzone({
    ondrop (event){
      const id = event.relatedTarget?.dataset?.id; if(!id) return;
      removeTask(id);
    }
  });

  /** ---------- Drag & Resize scheduled blocks ---------- */
  function activateBlockDnD(){
    // Only enable resizing on event-blocks; reposition handled via HTML drag & drop

    interact('.event-block').resizable({
      edges: { bottom: true },
      listeners: {
        move (e){
          const target = e.target;
          let newH = e.rect.height;
          // snap to slot height
          const snapped = Math.max(SLOT_HEIGHT, Math.round(newH / SLOT_HEIGHT) * SLOT_HEIGHT);
          target.style.height = snapped + 'px';
        },
        end (e){
          const target = e.target;
          const body = target.parentElement;
          const tId = target.dataset.id;
          const sStart = parseInt(body.dataset.rangeStart);
          const t = tasks.find(x => x.id === tId);
          if(!t) return;
          const dur = Math.max(1, Math.round(parseInt(target.style.height)/SLOT_HEIGHT));
          // keep within section
          const maxDur = (sStart + 24) - (t.startIndex ?? sStart);
          const durationSlots = clamp(dur, 1, maxDur);
          updateTask(tId, { durationSlots });
          resolveCollisions();
        }
      }
    });
  }

  /** ---------- Collision resolution ---------- */
  function resolveCollisions(){
    // For each section, sort by startIndex, then push down on overlaps.
    for(const s of sections){
      const inS = tasks.filter(t => t.list===null && t.startIndex !== null && t.startIndex >= s.start && t.startIndex < s.end)
                       .sort((a,b)=> (a.startIndex - b.startIndex) || a.title.localeCompare(b.title));
      let cursor = s.start;
      for(const t of inS){
        if(t.startIndex < cursor){
          t.startIndex = cursor;
        }
        cursor = t.startIndex + t.durationSlots;
        // clamp to end
        if(cursor > s.end){
          t.durationSlots = Math.max(1, t.durationSlots - (cursor - s.end));
          cursor = s.end;
        }
      }
    }
    save(); renderSchedule();
  }

  /** ---------- Ghost preview ---------- */
  const ghost = el('#ghost');
  function showGhostAt(event, body){
    const rect = body.getBoundingClientRect();
    const y = event.dragEvent.clientY - rect.top + body.scrollTop;
    const idxInSection = clamp(Math.round(y / SLOT_HEIGHT), 0, 24-1);
    const top = rect.top + window.scrollY + idxInSection * SLOT_HEIGHT;
    // Show ghost overlay sized according to current drag slots
    ghost.style.display = 'block';
    ghost.style.top = top + 'px';
    ghost.style.left = (rect.left + 8) + 'px';
    ghost.style.width = (rect.width - 16) + 'px';
    // Use currentDragSlots (number of 15‑min slots) to determine preview height
    const slots = currentDragSlots || 4;
    ghost.style.height = (SLOT_HEIGHT * slots) + 'px';
  }
  function hideGhost(){ ghost.style.display='none'; }

  /** ---------- Collapsible controls ---------- */
  els('.section-toggle').forEach(btn => {
    const targetSel = btn.dataset.target;
    const target = el(targetSel);
    // initial collapsed
    target.hidden = true;
    btn.setAttribute('aria-expanded','false');
    btn.addEventListener('click', () => {
      const now = target.hidden;
      target.hidden = !now;
      btn.setAttribute('aria-expanded', String(now));
    });
  });

  els('.panel-header.collapsible .toggle').forEach(btn => {
    const target = el(btn.parentElement.dataset.target);
    // show collapsible sections initially
    target.hidden = false;
    btn.textContent = 'zuklappen';
    btn.setAttribute('aria-expanded', 'true');
    btn.addEventListener('click', () => {
      const willShow = target.hidden;
      target.hidden = !target.hidden;
      btn.textContent = willShow ? 'zuklappen' : 'aufklappen';
      btn.setAttribute('aria-expanded', String(willShow));
    });
  });

  /** ---------- Export ---------- */
  el('#exportButton').addEventListener('click', () => {
    const fmt = el('#exportFormat').value;
    const scheduled = tasks.filter(t => t.list===null && t.startIndex !== null);
    if(scheduled.length === 0){ alert('Keine geplanten Tasks zum Export.'); return; }

    if(fmt === 'csv' || fmt === 'xlsx'){
      const csv = exportCSV(scheduled);
      download(csv, fmt === 'csv' ? 'mindframe_schedule.csv' : 'mindframe_schedule.xlsx', 'text/csv;charset=utf-8');
    }else if(fmt === 'md'){
      const md = exportMarkdown(scheduled);
      download(md, 'mindframe_schedule.md', 'text/markdown;charset=utf-8');
    }else if(fmt === 'ics'){
      const ics = exportICS(scheduled);
      download(ics, 'mindframe_schedule.ics', 'text/calendar;charset=utf-8');
    }else if(fmt === 'pdf'){
      exportPDF(scheduled);
    }
  });

  function exportCSV(items){
    const lines = [['Titel','Priorität','Start','Ende','Dauer (min)']];
    for(const t of items){
      const start = fmtTime(t.startIndex);
      const end = fmtTime(t.startIndex + t.durationSlots);
      const dur = t.durationSlots * 15;
      lines.push([t.title, String(t.priority), start, end, String(dur)]);
    }
    return lines.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(';')).join('\n');
  }

  function exportMarkdown(items){
    const rows = items.map(t => `- **${escapeMd(t.title)}** — P${t.priority} — ${fmtTime(t.startIndex)}–${fmtTime(t.startIndex + t.durationSlots)} (${t.durationSlots*15} min)`);
    return `# MindFrame — Tages-Schedule\n\n${new Date().toLocaleDateString('de-DE')}\n\n` + rows.join('\n');
  }

  function exportICS(items){
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth()+1).padStart(2,'0');
    const d = String(today.getDate()).padStart(2,'0');
    const date = `${y}${m}${d}`;
    const nowStamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z/,'Z');

    const lines = [
      'BEGIN:VCALENDAR',
      'PRODID:-//MindFrame//DE',
      'VERSION:2.0',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-TIMEZONE:Europe/Berlin'
    ];

    for(const t of items){
      const sMin = t.startIndex * 15;
      const eMin = (t.startIndex + t.durationSlots) * 15;
      const start = `${String(Math.floor(sMin/60)).padStart(2,'0')}${String(sMin%60).padStart(2,'0')}00`;
      const end   = `${String(Math.floor(eMin/60)).padStart(2,'0')}${String(eMin%60).padStart(2,'0')}00`;

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${t.id}-${date}@mindframe`);
      lines.push(`DTSTAMP:${nowStamp}`);
      lines.push(`DTSTART;TZID=Europe/Berlin:${date}T${start}`);
      lines.push(`DTEND;TZID=Europe/Berlin:${date}T${end}`);
      lines.push(`SUMMARY:${escapeIcs(t.title)}`);
      lines.push(`DESCRIPTION:Priorität ${t.priority}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  async function exportPDF(items){
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'pt', format:'a4' });
    const margin = 48;
    let y = margin;

    doc.setFontSize(16);
    doc.text('MindFrame — Tages-Schedule', margin, y); y += 18;
    doc.setFontSize(11);
    doc.setTextColor(120);
    doc.text(new Date().toLocaleDateString('de-DE'), margin, y); y += 24;
    doc.setTextColor(0);

    // Header
    doc.setFont(undefined,'bold');
    doc.text('Start', margin, y);
    doc.text('Ende', margin+80, y);
    doc.text('Dauer', margin+160, y);
    doc.text('Priorität', margin+220, y);
    doc.text('Task', margin+300, y);
    y += 12;
    doc.setFont(undefined,'normal');
    doc.setLineWidth(0.5);
    doc.line(margin, y, 595-margin, y); y += 10;

    items.forEach(t => {
      const start = fmtTime(t.startIndex);
      const end = fmtTime(t.startIndex + t.durationSlots);
      const dur = (t.durationSlots*15) + ' min';
      doc.text(start, margin, y);
      doc.text(end, margin+80, y);
      doc.text(dur, margin+160, y);
      doc.text(String(t.priority), margin+220, y);
      // wrap title
      const txt = doc.splitTextToSize(t.title, 595 - margin - (margin+300));
      doc.text(txt, margin+300, y);
      y += 16 + (txt.length-1)*12;
      if(y > 770){
        doc.addPage(); y = margin;
      }
    });

    doc.save('mindframe_schedule.pdf');
  }

  function download(content, filename, mime){
    const blob = new Blob([content], { type:mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  }

  // Escaping helpers
  function escapeHtml(s){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function escapeHtmlAttr(s){ return escapeHtml(s); }
  function escapeMd(s){ return s.replace(/([*_`[\]])/g,'\\$1'); }
  function escapeIcs(s){ return s.replace(/([,;])/g, '\\$1'); }

  /**
   * Setup native HTML5 drag & drop zones for list and schedule areas.
   * This complements interact.js to allow dragging tasks between lists, schedule and delete zone.
   */
  function setupHtmlDnD(){
    // Today list
    todayList.addEventListener('dragover', e => { e.preventDefault(); });
    todayList.addEventListener('drop', e => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      if(!id) return;
      updateTask(id, { list: 'today', startIndex: null, durationSlots: tasks.find(x=>x.id===id)?.durationSlots || 4 });
    });
    // Week list
    weekList.addEventListener('dragover', e => { e.preventDefault(); });
    weekList.addEventListener('drop', e => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      if(!id) return;
      updateTask(id, { list: 'week', startIndex: null, durationSlots: tasks.find(x=>x.id===id)?.durationSlots || 4 });
    });
    // Delete zone
    const delZone = el('#deleteZone');
    delZone.addEventListener('dragover', e => { e.preventDefault(); });
    delZone.addEventListener('drop', e => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      if(!id) return;
      removeTask(id);
      delZone.classList.remove('drop-hover');
    });

    // Highlight lists and delete zone on dragenter/leave to provide visual guidance
    [todayList, weekList, delZone].forEach(zone => {
      zone.addEventListener('dragenter', e => {
        // Only highlight if dragging a task
        if(e.dataTransfer && e.dataTransfer.types.includes('text/plain')){
          zone.classList.add('drop-hover');
        }
      });
      zone.addEventListener('dragleave', () => {
        zone.classList.remove('drop-hover');
      });
      zone.addEventListener('drop', () => {
        zone.classList.remove('drop-hover');
      });
    });
    // Schedule sections
    els('.section-body').forEach(body => {
      body.addEventListener('dragover', e => { e.preventDefault(); });
      body.addEventListener('drop', e => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        if(!id) return;
        // compute slot index within section
        const rect = body.getBoundingClientRect();
        const y = e.clientY - rect.top + body.scrollTop;
        const secStart = parseInt(body.dataset.rangeStart);
        const idxInSection = clamp(Math.round(y / SLOT_HEIGHT), 0, 24 - 1);
        const startIndex = clamp(secStart + idxInSection, secStart, secStart + 24 - 1);
        const existing = tasks.find(x => x.id === id);
        const dur = existing ? existing.durationSlots : 4;
        updateTask(id, { list: null, startIndex, durationSlots: dur });
        resolveCollisions();
      });
    });
  }

  /** ---------- Init ---------- */
  function init(){
    load();
    addCaptureRow();
    setupHtmlDnD();
    render();
  }

  function render(){
    renderLists();
    renderSchedule();
  }

  // Page wiring
  init();
})();