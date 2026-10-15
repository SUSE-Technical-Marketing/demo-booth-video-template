function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('timing-editor', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function rememberedHandle() {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('kv').objectStore('kv').get('handle');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function rememberHandle(handle) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(handle, 'handle');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Remembering the file was aborted'));
    });
  } finally {
    db.close();
  }
}

export const pickerOptions = {
  types: [{ description: 'Video project JSON', accept: { 'application/json': ['.json'] } }],
};

export function downloadJSON(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'project.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
