import { describe, expect, it, vi } from 'vitest';
import { directoryProjectSource, projectMediaPath, uploadedProjectSource } from './projectFiles.js';

const upload = path => ({ name: path.split('/').at(-1), webkitRelativePath: `demo/${path}` });

describe('project folder files', () => {
  it('normalizes relative paths without changing spaces or Unicode filenames', () => {
    expect(projectMediaPath('./media/sub/../two with spaces.mp4')).toBe('media/two with spaces.mp4');
    expect(projectMediaPath('media//demo.mp4')).toBe('media/demo.mp4');
    expect(projectMediaPath('media/d\u00e9mo.mp4')).toBe('media/d\u00e9mo.mp4');
  });
  it.each(['../outside.mp4', 'media/../../outside.mp4', '/absolute.mp4', 'blob:source', 'C:\\video.mp4', '.'])(
    'rejects paths that cannot be resolved inside the chosen folder: %s', path => {
      expect(() => projectMediaPath(path)).toThrow();
    });
  it('lists only root JSON files and resolves native media through the correct directories', async () => {
    const file = upload('media/sub/two with spaces.mp4');
    const nested = { getFileHandle: vi.fn().mockResolvedValue({ getFile: async () => file }) };
    const media = { getDirectoryHandle: vi.fn().mockResolvedValue(nested) };
    const manifest = { kind: 'file', name: 'project.json', getFile: vi.fn() };
    const directory = {
      async *values() {
        yield { kind: 'directory', name: 'nested.json' };
        yield { kind: 'file', name: 'notes.txt' };
        yield manifest;
      },
      getDirectoryHandle: vi.fn().mockResolvedValue(media),
    };
    const source = directoryProjectSource(directory);
    expect((await source.projects()).map(project => project.name)).toEqual(['project.json']);
    expect(await source.media('media/sub/two with spaces.mp4')).toBe(file);
    expect(directory.getDirectoryHandle).toHaveBeenCalledWith('media');
    expect(media.getDirectoryHandle).toHaveBeenCalledWith('sub');
    expect(nested.getFileHandle).toHaveBeenCalledWith('two with spaces.mp4');
    await expect(source.media('../outside.mp4')).rejects.toThrow('outside');
    expect(directory.getDirectoryHandle).toHaveBeenCalledTimes(1);
  });
  it('matches directory uploads by full relative path, not ambiguous basenames', async () => {
    const files = ['other.json', 'project.json', 'media/sub/nested.json', 'media/demo.mp4', 'other/demo.mp4'].map(upload);
    const source = uploadedProjectSource(files);
    expect((await source.projects()).map(project => project.name)).toEqual(['other.json', 'project.json']);
    expect(await source.media('./media/demo.mp4')).toBe(files[3]);
    expect(await source.media('other/demo.mp4')).toBe(files[4]);
    await expect(source.media('demo.mp4')).rejects.toThrow('not found');
    await expect(source.media('../demo.mp4')).rejects.toThrow('outside');
  });
  it('rejects ordinary file uploads without directory-relative paths', () => {
    expect(() => uploadedProjectSource([{ name: 'project.json', webkitRelativePath: '' }])).toThrow('Select the folder');
  });
});
