import { createDb } from "@optimax-starter/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
