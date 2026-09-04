export declare const PUBLIC_DIR: string;
export declare const WORKER_ENTRY: string;
/** URL the browser loads the worker from — keep in sync with WorldMapInner.tsx. */
export declare const WORKER_PUBLIC_PATH: string;

/**
 * Stage maplibre-gl's tile worker and its relative imports into
 * `<projectRoot>/public/maplibre/`.
 *
 * @returns names of the files that were copied (empty when already up to date)
 */
export declare function copyMaplibreWorker(projectRoot: string): string[];
