/** Metrics the editor exposes for the spike (apps/editor/src/store/editor.ts). */
interface Window {
  __builderMetrics?: () => {
    patchToRendered: number[];
    dropTargetCompute: number[];
    dragFrames: number[];
    drops: number;
    noopDrops: number;
  };
}
