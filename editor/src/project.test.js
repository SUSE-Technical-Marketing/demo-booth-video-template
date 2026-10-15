import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/project.json';
import { createProject, fromProject, mediaPathForFile, normalizeMediaFolder, projectFPS, resolveMediaPath, toProjectJSON } from './project.js';
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
  it('supports rational frame rates and multiple clips referencing one source', () => {
    expect(projectFPS('30000/1001')).toBeCloseTo(29.97);
    const project = copy();
    project.clips[1].media_id = 'red';
    expect(fromProject(project).clips[1].media_id).toBe('red');
  });
});
