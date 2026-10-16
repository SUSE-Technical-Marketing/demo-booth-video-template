import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/project.json';
import { DEFAULT_RESOLUTION, RESOLUTIONS, createProject, fromProject, mediaPathForFile, normalizeMediaFolder,
  projectFPS, projectResolution, resolveMediaPath, toProjectJSON } from './project.js';
import { DEFAULT } from './timing.js';
import { THEMES, themeLayout } from './themes.js';

const copy = () => structuredClone(fixture);

describe('project documents', () => {
  it('round-trips the shared renderer fixture without runtime URLs', () => {
    const state = fromProject(fixture);
    expect(JSON.parse(toProjectJSON(state))).toEqual(fixture);
    expect(state.clips.map(c => c.source_out - c.source_in)).toEqual([expect.closeTo(1), 0.8]);
    expect(toProjectJSON(state)).not.toContain('blob:');
  });
  it('creates editable empty projects and rejects old top-level timing files', () => {
    const state = createProject(DEFAULT);
    expect(state.output.theme).toBe('dark-rail');
    expect(fromProject(JSON.parse(toProjectJSON(state))).clips).toEqual([]);
    expect(() => fromProject(DEFAULT)).toThrow('project JSON');
  });
  it.each(['', '.', './', 'media', 'media/', './media//demos/', '../shared videos', 'media/\u89c6\u9891'])(
    'round-trips the media folder %j without baking it into relative paths', folder => {
      const project = copy();
      project.media_folder = folder;
      project.media = project.media.map(media => ({ ...media, path: media.path.split('/').at(-1) }));
      const state = fromProject(project);
      expect(state.media_folder).toBe(folder);
      expect(state.media).toEqual(project.media);
      expect(JSON.parse(toProjectJSON(state))).toEqual(project);
    });
  it.each([null, false, 42, {}, [], ' ', '/media', '//server/media', 'C:/media', 'https://example.com/media',
    './C:/media', './https://example.com', 'media\\videos', 'media\0', 'media\n', 'media\r'])('rejects the invalid media folder %j', folder => {
    const project = copy();
    project.media_folder = folder;
    expect(() => fromProject(project)).toThrow('Media folder must be a relative path');
  });
  it.each([
    ['demo clip.mp4', 'media', 'media/demo clip.mp4'],
    ['demo clip.mp4', './media//nested/', 'media/nested/demo clip.mp4'],
    ['demo clip.mp4', '../shared videos/', '../shared videos/demo clip.mp4'],
    ['demo clip.mp4', 'media/\u89c6\u9891', 'media/\u89c6\u9891/demo clip.mp4'],
    ['demo clip.mp4', '', 'demo clip.mp4'],
    ['demo clip.mp4', '.', 'demo clip.mp4'],
    ['nested/demo.mp4', 'media', 'media/nested/demo.mp4'],
    ['media/demo.mp4', 'media', 'media/media/demo.mp4'],
    ['../shared/demo.mp4', 'media', 'media/../shared/demo.mp4'],
    ['media/demo.mp4', undefined, 'media/demo.mp4'],
  ])('resolves %s relative to the media folder %j', (path, folder, expected) => {
    expect(resolveMediaPath(path, folder)).toBe(expected);
  });
  it('stores only the selected filename, never a baked-in directory-upload prefix', () => {
    const file = { name: 'demo.mp4', webkitRelativePath: 'project/media/demo.mp4' };
    expect(mediaPathForFile(file)).toBe('demo.mp4');
    expect(resolveMediaPath(mediaPathForFile(file), 'media/')).toBe('media/demo.mp4');
    expect(normalizeMediaFolder('./')).toBe('');
  });
  it.each(['', '/absolute.mp4', 'C:/video.mp4', 'video\\file.mp4'])(
    'rejects invalid filenames and relative media paths: %j', name => {
      expect(() => mediaPathForFile({ name })).toThrow('Video filename');
      expect(() => resolveMediaPath(name, 'media')).toThrow('Media path must be a relative path');
    });
  it.each(Object.keys(THEMES))('persists the %s theme without changing timing or clips', theme => {
    const project = copy();
    project.output.theme = theme;
    expect(JSON.parse(toProjectJSON(fromProject(project)))).toEqual(project);
  });
  it('keeps unthemed projects in Classic without rewriting their document', () => {
    const state = fromProject(fixture);
    expect(themeLayout(state.output.theme)).toBe(THEMES.classic);
    expect(JSON.parse(toProjectJSON(state))).toEqual(fixture);
  });
  it.each([null, '', 'unknown', '__proto__', 'constructor', 42, {}])('rejects the invalid theme %j', theme => {
    const project = copy();
    project.output.theme = theme;
    expect(() => fromProject(project)).toThrow('Unknown video theme');
  });
  it.each([
    project => { project.output = null; },
    project => { project.output.fps = '0/1'; },
    project => { project.output.fps = 'Infinity'; },
    project => { project.media[0].path = 'blob:local'; },
    project => { project.media[0].path = '/absolute/file.mp4'; },
    project => { project.media[0].path = 'C:\\video.mp4'; },
    project => { project.media[0].path = 'file\n.mp4'; },
    project => { project.media[1].id = project.media[0].id; },
    project => { project.clips[0].media_id = 'missing'; },
    project => { project.clips[1].id = project.clips[0].id; },
    project => { project.clips[1].start = 1; },
    project => { project.clips[0].source_out = project.clips[0].source_in; },
    project => { project.clips[0].start = NaN; },
    project => { project.clips[0].start = 0.201; project.clips[0].source_out = project.clips[0].source_in + 0.001; },
    project => { project.clips[0].transition_in = { type: 'crossfade', duration: 0.5 }; },
  ])('rejects malformed project data', change => {
    const project = copy();
    change(project);
    expect(() => fromProject(project)).toThrow();
  });
  it('persists the output resolution and keeps Full HD implicit when it is absent', () => {
    expect(projectResolution(undefined)).toEqual([1920, 1080]);
    expect(projectResolution(DEFAULT_RESOLUTION)).toEqual([1920, 1080]);
    expect(RESOLUTIONS.map(([size]) => size)).toContain(DEFAULT_RESOLUTION);
    expect(createProject(DEFAULT).output.resolution).toBeUndefined();
    const project = copy();
    expect(fromProject(project).output).not.toHaveProperty('resolution');
    project.output.resolution = '1280x720';
    expect(fromProject(project).output.resolution).toBe('1280x720');
    expect(JSON.parse(toProjectJSON(fromProject(project)))).toEqual(project);
  });
  it('fills in the default frame rate when a project has none', () => {
    const project = copy();
    delete project.output.fps;
    expect(fromProject(project).output.fps).toBe('25/1');
  });
  it('persists output settings and the shared media-folder base together', () => {
    const project = copy();
    project.output = { fps: '30000/1001', resolution: '1280x720', theme: 'minimal-stage' };
    project.media_folder = 'recordings';
    project.media = project.media.map(media => ({ ...media, path: media.path.split('/').at(-1) }));
    const state = fromProject(project);
    expect(JSON.parse(toProjectJSON(state))).toEqual(project);
    state.media_folder = 'relocated';
    state.output.resolution = '640x360';
    const saved = JSON.parse(toProjectJSON(state));
    expect(saved.output).toEqual({ ...project.output, resolution: '640x360' });
    expect(saved.media).toEqual(project.media);
    expect(resolveMediaPath(saved.media[0].path, saved.media_folder)).toBe('relocated/one.mp4');
  });
  it.each(['1920x1081', '0x0', '7682x4320', '1280 x 720', '1280×720', '', 1080, [1280, 720], {}])(
    'rejects the invalid resolution %j', resolution => {
      const project = copy();
      project.output.resolution = resolution;
      expect(() => fromProject(project)).toThrow('Output resolution');
    });
  it('supports rational frame rates and multiple clips referencing one source', () => {
    expect(projectFPS('30000/1001')).toBeCloseTo(29.97);
    const project = copy();
    project.clips[1].media_id = 'red';
    expect(fromProject(project).clips[1].media_id).toBe('red');
  });
  it('round-trips a cross-dissolve without changing trims or timeline positions', () => {
    const project = copy();
    project.clips[1].start = 0.8;
    project.clips[1].transition_in = { type: 'crossfade', duration: 0.4 };
    expect(JSON.parse(toProjectJSON(fromProject(project)))).toEqual(project);
  });
  it.each([
    project => { project.clips[1].transition_in.type = 'wipe'; },
    project => { project.clips[1].transition_in.duration = 0; },
    project => { project.clips[1].transition_in.duration = 0.01; },
    project => { project.clips[1].transition_in.duration = '0.4'; },
    project => { project.clips[1].transition_in.duration = Infinity; },
    project => { project.clips[1].start = 0.9; },
    project => { project.clips[1].start = 2; },
    project => { project.clips[1].source_out = project.clips[1].source_in + 0.4; },
    project => { project.clips.push({ id: 'third', media_id: 'red', start: 1, source_in: 0, source_out: 2,
      transition_in: { type: 'crossfade', duration: 0.6 } }); },
  ])('rejects invalid dissolve duration, placement and intersecting dissolves', change => {
    const project = copy();
    project.clips[1].start = 0.8;
    project.clips[1].transition_in = { type: 'crossfade', duration: 0.4 };
    change(project);
    expect(() => fromProject(project)).toThrow();
  });
});
