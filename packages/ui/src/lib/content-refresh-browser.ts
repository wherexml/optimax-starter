import { createContentRefresh, createRefreshVisual } from "./content-refresh";

// Build this entry for hosts that do not use React. No global network interception.
Object.assign(globalThis, { OptiMaxRefresh: { createContentRefresh, createRefreshVisual } });
