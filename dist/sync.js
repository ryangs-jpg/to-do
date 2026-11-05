'use strict';
(function (root) {
  const TABLE = 'one_step_sync';
  const DEFAULT_SETTINGS = { timer: true, notify: false };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const millis = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const stamp = (task) => millis(task && (task.updated || task.created));
  const withoutStamp = (task) => {
    const copy = { ...task };
    delete copy.updated;
    return JSON.stringify(copy);
  };

  function normalize(value) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const sourceTasks = Array.isArray(input.tasks) ? input.tasks : [];
    const tasks = sourceTasks.filter((t) => t && typeof t === 'object'
      && typeof t.id === 'string' && t.id.length > 0 && t.id.length < 150
      && typeof t.title === 'string' && Array.isArray(t.steps)).slice(0, 10000).map(clone);
    tasks.sort((a, b) => millis(a.created) - millis(b.created) || a.id.localeCompare(b.id));
    const sourceDeleted = input.deleted && typeof input.deleted === 'object' && !Array.isArray(input.deleted) ? input.deleted : {};
    const deleted = {};
    for (const id of Object.keys(sourceDeleted).sort()) {
      if (id.length > 0 && id.length < 150 && millis(sourceDeleted[id]) > 0) {
        deleted[id] = millis(sourceDeleted[id]);
      }
    }
    const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
    return {
      tasks,
      settings: { timer: settings.timer !== false, notify: settings.notify === true },
      deleted,
      settingsUpdated: millis(input.settingsUpdated)
    };
  }

  function canonical(value) {
    return JSON.stringify(normalize(value));
  }

  function merge(localValue, remoteValue) {
    const local = normalize(localValue);
    const remote = normalize(remoteValue);
    const combined = new Map(remote.tasks.map((task) => [task.id, task]));
    for (const task of local.tasks) {
      const current = combined.get(task.id);
      if (!current || stamp(task) > stamp(current)) combined.set(task.id, task);
    }
    const deleted = {};
    for (const id of new Set([...Object.keys(remote.deleted), ...Object.keys(local.deleted)])) {
      deleted[id] = Math.max(millis(remote.deleted[id]), millis(local.deleted[id]));
    }
    const tasks = [...combined.values()].filter((task) => millis(deleted[task.id]) < stamp(task));
    for (const task of tasks) {
      if (deleted[task.id]) delete deleted[task.id];
    }
    const localSettingsWins = local.settingsUpdated > remote.settingsUpdated
      || (local.settingsUpdated === 0 && remote.settingsUpdated === 0
        && canonical({ settings: local.settings }) !== canonical({ settings: DEFAULT_SETTINGS })
        && canonical({ settings: remote.settings }) === canonical({ settings: DEFAULT_SETTINGS }));
    return normalize({
      tasks,
      deleted,
      settings: localSettingsWins ? local.settings : remote.settings,
      settingsUpdated: Math.max(local.settingsUpdated, remote.settingsUpdated)
    });
  }

  function create(options) {
    const { client, userId, getState, applyState, onStatus } = options;
    if (!client || !userId || typeof getState !== 'function') throw Error('Sync prerequisites missing');
    let tracked = normalize(getState());
    let inFlight = null;
    let scheduled = null;
    let interval = null;
    let pending = true;
    let stopped = false;
    let lastError = null;

    function status(kind) {
      if (typeof onStatus === 'function') onStatus(kind);
    }

    function localSave(value) {
      const fresh = normalize(value);
      const oldById = new Map(tracked.tasks.map((task) => [task.id, task]));
      const currentIds = new Set();
      const now = Date.now();
      let changed = false;
      for (const task of fresh.tasks) {
        currentIds.add(task.id);
        const previous = oldById.get(task.id);
        if (!previous || withoutStamp(previous) !== withoutStamp(task)) {
          task.updated = Math.max(now, stamp(task), stamp(previous) + 1, millis(fresh.deleted[task.id]) + 1);
          delete fresh.deleted[task.id];
          changed = true;
        }
      }
      for (const task of tracked.tasks) {
        if (!currentIds.has(task.id)) {
          fresh.deleted[task.id] = Math.max(now, millis(fresh.deleted[task.id]) + 1, stamp(task) + 1);
          changed = true;
        }
      }
      if (JSON.stringify(fresh.settings) !== JSON.stringify(tracked.settings)) {
        fresh.settingsUpdated = Math.max(now, tracked.settingsUpdated + 1);
        changed = true;
      }
      tracked = normalize(fresh);
      if (changed) {
        pending = true;
        status('saving');
      }
      return fresh;
    }

    function applyIfChanged(next) {
      const normalized = normalize(next);
      if (canonical(getState()) !== canonical(normalized)) {
        applyState(normalized);
      }
      tracked = normalize(normalized);
    }

    function schedule(delay = 450) {
      if (stopped) return;
      if (scheduled !== null) clearTimeout(scheduled);
      scheduled = setTimeout(() => {
        scheduled = null;
        syncNow();
      }, delay);
    }

    async function attempt() {
      status('saving');
      for (let retry = 0; retry < 6; retry++) {
        const { data: remote, error: readError } = await client.from(TABLE)
          .select('revision,payload').eq('user_id', userId).maybeSingle();
        if (readError) throw readError;

        const local = normalize(getState());
        const target = remote ? merge(local, remote.payload) : local;
        if (!remote && target.settingsUpdated === 0) target.settingsUpdated = Date.now();

        if (remote && canonical(target) === canonical(remote.payload)) {
          const latest = merge(getState(), target);
          applyIfChanged(latest);
          pending = canonical(latest) !== canonical(target);
          status(pending ? 'saving' : 'synced');
          return;
        }

        if (!remote) {
          const { error: insertError } = await client.from(TABLE)
            .insert({ user_id: userId, revision: 1, payload: target });
          if (insertError && insertError.code === '23505') continue;
          if (insertError) throw insertError;
        } else {
          const { data: updated, error: updateError } = await client.from(TABLE)
            .update({
              payload: target,
              revision: Number(remote.revision) + 1,
              updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .eq('revision', remote.revision)
            .select('revision').maybeSingle();
          if (updateError) throw updateError;
          if (!updated) continue;
        }

        const latest = merge(getState(), target);
        applyIfChanged(latest);
        pending = canonical(latest) !== canonical(target);
        status(pending ? 'saving' : 'synced');
        return;
      }
      throw Error('Concurrent sync conflict');
    }

    async function syncNow() {
      if (stopped) return false;
      if (inFlight) return inFlight;
      if (scheduled !== null) {
        clearTimeout(scheduled);
        scheduled = null;
      }
      inFlight = (async () => {
        try {
          await attempt();
          lastError = null;
          return true;
        } catch (error) {
          lastError = error;
          pending = true;
          status('offline');
          return false;
        } finally {
          inFlight = null;
          if (pending && !stopped) schedule(lastError ? 15000 : 250);
        }
      })();
      return inFlight;
    }

    async function flush() {
      for (let attemptNumber = 0; attemptNumber < 6; attemptNumber++) {
        const ok = await syncNow();
        if (!ok) throw lastError || Error('Sync unavailable');
        if (!pending) return;
      }
      throw Error('Could not flush changes');
    }

    function start() {
      if (stopped) return;
      status('saving');
      schedule(0);
      interval = setInterval(() => {
        if (!document.hidden) syncNow();
      }, 12000);
      root.addEventListener('online', syncNow);
      root.addEventListener('focus', syncNow);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) syncNow();
      });
    }

    function stop() {
      stopped = true;
      if (scheduled !== null) clearTimeout(scheduled);
      if (interval !== null) clearInterval(interval);
      root.removeEventListener('online', syncNow);
      root.removeEventListener('focus', syncNow);
    }

    return { localSave, schedule, start, stop, flush, syncNow };
  }

  root.OneStepSync = { create, merge, normalize };
})(globalThis);
