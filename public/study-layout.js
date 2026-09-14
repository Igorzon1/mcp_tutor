export const DEFAULT_STUDY_WIDTH = 420;
export const STUDY_WIDTH_KEY = 'mcp-tutor:study-width';

export function studyBounds(layoutWidth) {
  const max = Math.max(320, Math.min(900, Math.floor(layoutWidth - 380 - 12)));
  return { min: 320, max };
}

export function clampStudyWidth(value, layoutWidth) {
  const { min, max } = studyBounds(layoutWidth);
  const width = Number(value);
  return Math.round(Math.min(max, Math.max(min, Number.isFinite(width) && width > 0 ? width : DEFAULT_STUDY_WIDTH)));
}

export function installStudyResize(document, window) {
  const layout = document.querySelector('.lesson-layout');
  const handle = document.querySelector('#study-resizer');
  let preferred = DEFAULT_STUDY_WIDTH;
  let drag;
  try { preferred = Number(window.localStorage.getItem(STUDY_WIDTH_KEY)) || DEFAULT_STUDY_WIDTH; } catch { /* Layout remains usable without storage. */ }
  const availableWidth = () => layout.getBoundingClientRect().width || window.innerWidth - 216;
  const refresh = () => {
    const width = clampStudyWidth(preferred, availableWidth());
    const { min, max } = studyBounds(availableWidth());
    layout.style.setProperty('--study-width', `${width}px`);
    handle.setAttribute('aria-valuemin', String(min));
    handle.setAttribute('aria-valuemax', String(max));
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuetext', `${width} pixels para o painel de estudo`);
    return width;
  };
  const save = () => {
    try { window.localStorage.setItem(STUDY_WIDTH_KEY, String(preferred)); } catch { /* Optional preference. */ }
  };
  const setWidth = value => { preferred = clampStudyWidth(value, availableWidth()); refresh(); };
  const stop = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const pointerId = drag.pointerId;
    drag = undefined;
    document.body.classList.remove('resizing-study');
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    save();
  };
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || window.innerWidth <= 1190) return;
    event.preventDefault();
    drag = { pointerId: event.pointerId, x: event.clientX, width: refresh() };
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
    document.body.classList.add('resizing-study');
  });
  handle.addEventListener('pointermove', event => {
    if (drag && event.pointerId === drag.pointerId) setWidth(drag.width + drag.x - event.clientX);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(name, stop);
  handle.addEventListener('keydown', event => {
    const { min, max } = studyBounds(availableWidth());
    const actions = { ArrowLeft: refresh() + 32, ArrowRight: refresh() - 32, Home: min, End: max };
    if (!(event.key in actions)) return;
    event.preventDefault();
    setWidth(actions[event.key]);
    save();
  });
  handle.addEventListener('dblclick', () => { setWidth(DEFAULT_STUDY_WIDTH); save(); });
  window.addEventListener('resize', refresh);
  refresh();
  return { refresh };
}
