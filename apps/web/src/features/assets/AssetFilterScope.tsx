"use client";

import { createParts } from "@ui-sdk/react/primitive";
import { assetFilters } from "./filter-primitive";

export const { Root: AssetFilterScope } = createParts(assetFilters, { root: "div" });
