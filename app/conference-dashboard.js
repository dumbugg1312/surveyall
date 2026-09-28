/**
 * SurveyAll — the dashboard's conference section.
 *
 * Its own module rather than more of dashboard-page.js: a conference
 * board shares nothing with a deck but the join-code box, and the one
 * thing this section has to say that the rest of the dashboard never does
 * is that students give their NAME here, and where that name goes.
 *
 * Only live boards are listed. An ended board has nothing left to show:
 * its students were erased and its log is on the instructor's computer.
 */

import { listBoards, createBoard } from './db.js';
import { DEFAULT_STAGES, DEFAULT_TOPICS, DEFAULT_TARGET_MIN } from './conference-logic.js';
import { el, linkBtn, openModal, toast } from './ui.js';

const area = document.getElementById('confArea');
const startBtn = document.getElementById('newBoard');
let boards = [];

startBtn?.addEventListener('click', onStart);
load();

async function load() {
  try {
    boards = await listBoards();
  } catch {
    boards = [];
  }
  render();
}

function render() {
  if (!area) return;
  const live = boards.filter((b) => b.state === 'live');
  area.replaceChildren();
  if (!live.length) return;
  const list = el('div', 'conf-list');
  for (const b of live) {
    const row = el('div', 'conf-row');
    const flag = el('span', 'live-flag');
    flag.append(el('span', 'dot-live'), document.createTextNode('Live'));
    const erase = new Date(b.expires_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const info = el('div', 'stack-sm');
    info.append(
      el('span', 'conf-row-title', b.title),
      el('span', 'note muted', `Code ${b.join_code} · erases at ${erase} if not ended`),
    );
    const spacer = el('span', 'spacer');
    row.append(flag, info, spacer, linkBtn('Open board', 'btn-primary', `board.html?id=${b.id}`));
    list.append(row);
  }
  area.append(list);
}

function lines(textarea) {
  return textarea.value.split('\n').map((s) => s.trim()).filter(Boolean);
}

async function onStart() {
  // The last board's lists are the best guess at the next one's: the
  // same course runs conferences more than once a term.
  const last = boards[0];
  const fields = {};
  const value = await openModal({
    title: 'Start a conference board',
    blurb: 'Students open it on their phone and leave it open all class: name, topic, where they are in the process, and a button to ask for a conference. Names live only on this board. They are erased when you end it (you get the log as a download) or 12 hours after you start, whichever comes first.',
    confirmLabel: 'Start board',
    build(form) {
      const titleField = el('div', 'field');
      const tl = el('label', null, 'Title');
      tl.htmlFor = 'confTitle';
      fields.title = Object.assign(document.createElement('input'), {
        id: 'confTitle', type: 'text', maxLength: 80,
        value: last?.title || 'Research essay conferences',
      });
      titleField.append(tl, fields.title);

      const listsRow = el('div', 'conf-lists');
      const listField = (id, label, hint, items) => {
        const f = el('div', 'field');
        const l = el('label', null, label);
        l.htmlFor = id;
        const t = document.createElement('textarea');
        t.id = id;
        t.value = items.join('\n');
        f.append(l, t, el('span', 'field-hint', hint));
        listsRow.append(f);
        return t;
      };
      fields.stages = listField('confStages', 'Writing stages', 'One per line, in order.',
        last?.settings?.stages || DEFAULT_STAGES);
      fields.topics = listField('confTopics', 'Students can ask about', 'One per line.',
        last?.settings?.topics || DEFAULT_TOPICS);

      const targetField = el('div', 'field');
      const gl = el('label', null, 'Conference length to aim for (minutes)');
      gl.htmlFor = 'confTarget';
      fields.target = Object.assign(document.createElement('input'), {
        id: 'confTarget', type: 'number', min: 1, max: 30,
        value: last?.settings?.target || DEFAULT_TARGET_MIN,
      });
      targetField.append(gl, fields.target,
        el('span', 'field-hint', 'The timer turns amber after this. It never cuts anyone off.'));

      form.append(titleField, listsRow, targetField);
      return () => ({
        title: fields.title.value.trim(),
        stages: lines(fields.stages),
        topics: lines(fields.topics),
        target: Number(fields.target.value),
      });
    },
  });
  if (!value) return;
  startBtn.disabled = true;
  try {
    const board = await createBoard(value);
    window.location.href = `board.html?id=${board.id}`;
  } catch (err) {
    toast(err.message);
    startBtn.disabled = false;
  }
}
