/**
 * @module core/store
 * Reactive state store + event bus for cross-module communication.
 *
 * Modules write: store.set('activeStateId', '3')
 * Modules read:  store.get('activeStateId')
 * Modules react: store.on('state:selected', (id) => { ... })
 * Modules fire:  store.emit('state:selected', id)
 */

const state = new Map();
const listeners = new Map();

export const store = {
  get(key) {
    return state.get(key);
  },

  set(key, value) {
    state.set(key, value);
  },

  delete(key) {
    state.delete(key);
  },

  on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(handler);
    return () => {
      const handlers = listeners.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx !== -1) handlers.splice(idx, 1);
      }
    };
  },

  emit(event, ...args) {
    const handlers = listeners.get(event);
    if (handlers) handlers.forEach((fn) => fn(...args));
  },
};
