export interface SignalTarget {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
}

export interface ShutdownHandlersOptions {
  readonly close: () => Promise<void>;
  readonly target?: SignalTarget;
  readonly signals?: readonly NodeJS.Signals[];
  readonly setExitCode?: (code: number) => void;
}

/** Installs idempotent process shutdown handling without calling process.exit. */
export function installShutdownHandlers(options: ShutdownHandlersOptions): {
  shutdown(): Promise<void>;
  dispose(): void;
} {
  const target = options.target ?? process;
  const signals = options.signals ?? ["SIGINT", "SIGTERM"];
  const setExitCode =
    options.setExitCode ?? ((code) => (process.exitCode = code));
  let stopping = false;
  const dispose = () => {
    for (const signal of signals) target.removeListener(signal, onSignal);
  };
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    dispose();
    try {
      await options.close();
    } finally {
      setExitCode(4);
    }
  };
  const onSignal = () => void shutdown();
  for (const signal of signals) target.once(signal, onSignal);
  return { shutdown, dispose };
}
