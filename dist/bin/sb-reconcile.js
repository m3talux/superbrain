#!/usr/bin/env node
import { reconcile } from "../src/indexer.js";
import { writeFailure } from "../src/sentinel.js";
reconcile().catch((e) => writeFailure(`reconcile failed: ${e?.message || e}`)).finally(() => process.exit(0));
