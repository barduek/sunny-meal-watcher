import type { ZonedDateTime } from '../sun/time';
import type { SnapshotView } from './format';

/** Paso del slider de hora, en minutos. */
export const SLIDER_STEP_MINUTES = 5;
const SLIDER_MAX_MINUTES = 24 * 60 - SLIDER_STEP_MINUTES;

export interface TimeControlElements {
  area: HTMLElement;
  date: HTMLInputElement;
  time: HTMLInputElement;
  clock: HTMLElement;
  sunInfo: HTMLElement;
  sunTimes: HTMLElement;
  dataNote: HTMLElement;
  status: HTMLElement;
}

function byId<T extends HTMLElement>(id: string, type: { new (): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Falta el elemento #${id} en index.html`);
  return element;
}

export function findTimeControls(): TimeControlElements {
  return {
    area: byId('area-name', HTMLElement),
    date: byId('date-input', HTMLInputElement),
    time: byId('time-input', HTMLInputElement),
    clock: byId('clock', HTMLElement),
    sunInfo: byId('sun-info', HTMLElement),
    sunTimes: byId('sun-times', HTMLElement),
    dataNote: byId('data-note', HTMLElement),
    status: byId('status', HTMLElement),
  };
}

/** Mensaje de estado (carga o error) en una región `role="status"`; `null` lo oculta. */
export function setStatus(elements: TimeControlElements, message: string | null, tone: 'info' | 'error' = 'info'): void {
  elements.status.textContent = message ?? '';
  elements.status.hidden = message === null;
  elements.status.classList.toggle('status--error', tone === 'error');
}

/** Ajusta la hora al paso del slider (por ejemplo 16:47 → 16:45). */
export function snapToSlider({ date, minutes }: ZonedDateTime): ZonedDateTime {
  const snapped = Math.round(minutes / SLIDER_STEP_MINUTES) * SLIDER_STEP_MINUTES;
  return { date, minutes: Math.min(Math.max(snapped, 0), SLIDER_MAX_MINUTES) };
}

/**
 * Conecta el selector de fecha y el slider de hora. `onChange` se llama con
 * cada movimiento; mientras la fecha esté incompleta, no se llama.
 */
export function bindTimeControls(
  elements: TimeControlElements,
  initial: ZonedDateTime,
  onChange: (local: ZonedDateTime) => void,
): void {
  elements.date.value = initial.date;
  elements.time.max = String(SLIDER_MAX_MINUTES);
  elements.time.step = String(SLIDER_STEP_MINUTES);
  elements.time.value = String(initial.minutes);

  const handle = () => {
    const date = elements.date.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    onChange({ date, minutes: Number(elements.time.value) });
  };
  elements.date.addEventListener('input', handle);
  elements.time.addEventListener('input', handle);

  elements.date.disabled = false;
  elements.time.disabled = false;
}

export function renderSnapshot(elements: TimeControlElements, view: SnapshotView): void {
  elements.clock.textContent = view.time;
  // Los lectores de pantalla anuncian "16:45" en lugar de "1005".
  elements.time.setAttribute('aria-valuetext', view.time);
  elements.sunInfo.textContent = view.sun;
  elements.sunTimes.textContent = view.times;
}
