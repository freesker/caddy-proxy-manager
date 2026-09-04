type SettingsUpdateLockState = {
  waiters: Array<() => void>;
  locked: boolean;
};

const lockGlobal = globalThis as typeof globalThis & {
  __cpmSettingsUpdateLock?: SettingsUpdateLockState;
};
const state = lockGlobal.__cpmSettingsUpdateLock ??= {
  waiters: [],
  locked: false,
};

/**
 * Caddy configuration is generated from all settings at once. Serialize the
 * save/apply/rollback transaction so a failed request cannot restore stale
 * state over a concurrent successful update.
 */
export async function withSettingsUpdateLock<T>(
  operation: () => Promise<T>
): Promise<T> {
  if (state.locked) {
    await new Promise<void>((resolve) => state.waiters.push(resolve));
  } else {
    state.locked = true;
  }

  try {
    return await operation();
  } finally {
    const next = state.waiters.shift();
    if (next) next();
    else state.locked = false;
  }
}
