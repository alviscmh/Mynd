'use strict';

(() => {
  const host = window.chrome?.webview;
  if (!host) return;

  let sequence = 0;
  const pending = new Map();
  const listeners = new Set();
  host.addEventListener('message', ({ data }) => {
    if (data.id !== undefined) {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      clearTimeout(request.timer);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data.result);
      return;
    }
    for (const listener of listeners) listener(data);
  });

  window.desktop = Object.freeze({
    request(method, data = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Mynd did not respond to this action.'));
        }, method === 'addRoot' ? 600000 : 90000);
        pending.set(id, { resolve, reject, timer });
        host.postMessage({ id, method, data });
      });
    },
    onMessage(listener) { listeners.add(listener); },
  });
})();
