import { fromJSON, toJSON } from './timing.js';
import { DEFAULT_THEME, themeLayout } from './themes.js';

const time = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const id = value => typeof value === 'string' && value.trim().length > 0;
export const mediaPathValid = path => typeof path === 'string' && path.trim().length > 0 &&
  !/^(?:[/\\]|[a-z][a-z\d+.-]*:)/i.test(path) && !/[\\\0\r\n]/.test(path);

export function projectFPS(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*\/[1-9]\d*$/.test(value)) throw new Error('Output FPS must be a fraction such as 25/1');
  const [n, d] = value.split('/').map(Number), fps = n / d;
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || fps < 1 || fps > 120) {
    throw new Error('Output FPS must be between 1 and 120');
  }
  return fps;
}

export function validateProject(project) {
  if (!project || project.project_version !== 1) throw new Error('Expected a version 1 project JSON');
  const fps = projectFPS(project.output?.fps);
  themeLayout(project.output.theme);
  if (!Array.isArray(project.media) || !Array.isArray(project.clips)) throw new Error('Project needs media and clips arrays');
  const media = new Set(), clips = new Set();
  for (const item of project.media) {
    if (!item || !id(item.id) || media.has(item.id) || !mediaPathValid(item.path)) {
      throw new Error('Media needs unique IDs and relative file paths using forward slashes');
    }
    media.add(item.id);
  }
  let end = 0;
  for (const clip of project.clips.slice().sort((a, b) => a?.start - b?.start)) {
    if (!clip || !id(clip.id) || clips.has(clip.id) || !media.has(clip.media_id) ||
        !time(clip.start) || !time(clip.source_in) || !time(clip.source_out) || clip.source_out <= clip.source_in) {
      throw new Error('Clips need unique IDs, existing media, non-negative times and source out after source in');
    }
    if (clip.transition_in != null) throw new Error('Transitions are not supported yet; use hard cuts');
    if (clip.start < end - 1e-6) throw new Error('Clips overlap; move or trim them to use hard cuts');
    clips.add(clip.id);
    end = clip.start + clip.source_out - clip.source_in;
    if (!Number.isSafeInteger(Math.ceil(end * fps - 1e-7))) throw new Error('Clip timeline is too large');
    if (Math.ceil(end * fps - 1e-7) <= Math.ceil(clip.start * fps - 1e-7)) {
      throw new Error('Clip has no frames at the output frame rate');
    }
  }
  if (project.timing?.schema_version !== 2) throw new Error('Project timing must use schema version 2');
}

export function createProject(timing) {
  return { ...fromJSON(timing), output: { fps: '25/1', theme: DEFAULT_THEME }, media: [], clips: [] };
}

export function fromProject(project) {
  validateProject(project);
  return {
    ...fromJSON(project.timing),
    output: { fps: project.output.fps, ...(project.output.theme === undefined ? {} : { theme: project.output.theme }) },
    media: project.media.map(({ id, path }) => ({ id, path })),
    clips: project.clips.map(({ id, media_id, start, source_in, source_out }) =>
      ({ id, media_id, start, source_in, source_out })).sort((a, b) => a.start - b.start),
  };
}

export function toProjectJSON(state) {
  const project = {
    project_version: 1, output: state.output, media: state.media, clips: state.clips,
    timing: JSON.parse(toJSON(state)),
  };
  fromProject(project);
  return JSON.stringify(project, null, 2) + '\n';
}

export const projectClipEnd = clip => clip.start + clip.source_out - clip.source_in;
