import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/project.json';
import { createProject, fromProject, projectFPS, toProjectJSON } from './project.js';
import { DEFAULT } from './timing.js';

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
    expect(fromProject(JSON.parse(toProjectJSON(state))).clips).toEqual([]);
    expect(() => fromProject(DEFAULT)).toThrow('project JSON');
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
