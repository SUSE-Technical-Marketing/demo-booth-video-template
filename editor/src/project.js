import { fromJSON, toJSON } from './timing.js';
import { DEFAULT_THEME, themeLayout } from './themes.js';

const time = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const id = value => typeof value === 'string' && value.trim().length > 0;
export const mediaPathValid = path => typeof path === 'string' && path.trim().length > 0 &&
  !/^(?:[/\\]|[a-z][a-z\d+.-]*:)/i.test(path) && !/[\\\0\r\n]/.test(path);

export function normalizeMediaFolder(folder = '') {
  if (folder === '' || mediaPathValid(folder)) {
    const normalized = folder.split('/').filter(part => part && part !== '.').join('/');
    if (normalized === '' || mediaPathValid(normalized)) return normalized;
  }
  throw new Error('Media folder must be a relative path using forward slashes, or empty for the project folder');
}

export function resolveMediaPath(path, folder) {
  const prefix = normalizeMediaFolder(folder);
  if (!mediaPathValid(path)) throw new Error('Media path must be a relative path using forward slashes');
  return prefix ? `${prefix}/${path}` : path;
}

export function mediaPathForFile(file) {
  const path = file.name;
  if (!mediaPathValid(path)) throw new Error('Video filename must be a relative path using forward slashes');
  return path;
}

export function projectFPS(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*\/[1-9]\d*$/.test(value)) throw new Error('Output FPS must be a fraction such as 25/1');
  const [n, d] = value.split('/').map(Number), fps = n / d;
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || fps < 1 || fps > 120) {
    throw new Error('Output FPS must be between 1 and 120');
  }
  return fps;
}

export const DEFAULT_FPS = '25/1';
export const DEFAULT_RESOLUTION = '1920x1080';
export const MAX_RESOLUTION = [7680, 4320];
export const RESOLUTIONS = [
  ['3840x2160', '3840 × 2160 (4K UHD)'], ['2560x1440', '2560 × 1440 (QHD)'], ['1920x1080', '1920 × 1080 (Full HD)'],
  ['1280x720', '1280 × 720 (HD)'], ['960x540', '960 × 540'], ['640x360', '640 × 360'],
];

/** Output frame size as [width, height]; undefined or null keeps the 1920 × 1080 design size. */
export function projectResolution(value) {
  if (value == null) return DEFAULT_RESOLUTION.split('x').map(Number);
  if (typeof value !== 'string' || !/^[1-9]\d*x[1-9]\d*$/.test(value)) {
    throw new Error('Output resolution must be WIDTHxHEIGHT such as 1280x720');
  }
  const [width, height] = value.split('x').map(Number);
  if (width % 2 || height % 2 || width < 16 || height < 16 || width > MAX_RESOLUTION[0] || height > MAX_RESOLUTION[1]) {
    throw new Error(`Output resolution must use even sizes between 16x16 and ${MAX_RESOLUTION.join('x')}`);
  }
  return [width, height];
}

export function validateProject(project) {
  if (!project || project.project_version !== 1) throw new Error('Expected a version 1 project JSON');
  if (!project.output || typeof project.output !== 'object') throw new Error('Project needs output settings');
  const fps = projectFPS(project.output.fps ?? DEFAULT_FPS);
  themeLayout(project.output.theme);
  projectResolution(project.output.resolution);
  normalizeMediaFolder(project.media_folder);
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
    output: {
      fps: project.output.fps ?? DEFAULT_FPS,
      ...(project.output.theme === undefined ? {} : { theme: project.output.theme }),
      ...(project.output.resolution == null ? {} : { resolution: project.output.resolution }),
    },
    ...(project.media_folder === undefined ? {} : { media_folder: project.media_folder }),
    media: project.media.map(({ id, path }) => ({ id, path })),
    clips: project.clips.map(({ id, media_id, start, source_in, source_out }) =>
      ({ id, media_id, start, source_in, source_out })).sort((a, b) => a.start - b.start),
  };
}

export function toProjectJSON(state) {
  const project = {
    project_version: 1, output: state.output, media_folder: state.media_folder, media: state.media, clips: state.clips,
    timing: JSON.parse(toJSON(state)),
  };
  fromProject(project);
  return JSON.stringify(project, null, 2) + '\n';
}

export const projectClipEnd = clip => clip.start + clip.source_out - clip.source_in;
