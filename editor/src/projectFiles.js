import { mediaPathValid } from './project.js';

export function projectMediaPath(path) {
  if (!mediaPathValid(path)) throw new Error('Expected a relative media path');
  const parts = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('Media is outside the selected project folder; relink it manually');
      parts.pop();
    } else parts.push(part);
  }
  if (!parts.length) throw new Error('Media path must name a file');
  return parts.join('/');
}

export function directoryProjectSource(directory) {
  return {
    directory,
    async projects() {
      const projects = [];
      for await (const entry of directory.values()) {
        if (entry.kind === 'file' && /\.json$/i.test(entry.name)) {
          projects.push({ name: entry.name, handle: entry, getFile: () => entry.getFile() });
        }
      }
      return projects.sort((a, b) => a.name.localeCompare(b.name));
    },
    async media(path) {
      const parts = projectMediaPath(path).split('/');
      let parent = directory;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
      return (await parent.getFileHandle(parts.at(-1))).getFile();
    },
  };
}

export function uploadedProjectSource(files) {
  const entries = new Map();
  for (const file of files) {
    const path = file.webkitRelativePath.split('/').slice(1).join('/');
    if (!path) throw new Error('Select the folder containing the project JSON and its media');
    entries.set(projectMediaPath(path), file);
  }
  return {
    directory: null,
    async projects() {
      return [...entries].filter(([path]) => !path.includes('/') && /\.json$/i.test(path))
        .map(([name, file]) => ({ name, handle: null, getFile: async () => file }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async media(path) {
      const file = entries.get(projectMediaPath(path));
      if (!file) throw new Error('File was not found in the selected project folder');
      return file;
    },
  };
}
