(function initMeshCoreSerialLifecycle(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MeshCoreSerialLifecycle = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMeshCoreSerialLifecycle() {
  "use strict";

  async function waitForSettlement(operation, timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error("Settlement timeout must be a non-negative number");
    let timerId;
    const settlement = Promise.resolve(operation).then(
      () => ({ settled: true, outcome: "resolved" }),
      () => ({ settled: true, outcome: "rejected" })
    );
    const timeout = new Promise((resolve) => {
      timerId = setTimeout(() => resolve({ settled: false, outcome: "timeout" }), timeoutMs);
    });

    try {
      return await Promise.race([settlement, timeout]);
    } finally {
      clearTimeout(timerId);
    }
  }

  return { waitForSettlement };
});
